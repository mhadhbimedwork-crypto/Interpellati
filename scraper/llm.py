"""Lettura con modello multimodale degli avvisi che il lettore a regole non capisce:
PDF scansionati (immagini), ZIP e file firmati .p7m.

Regole di sicurezza dei dati:
  * si usa SOLO se esiste la chiave ANTHROPIC_API_KEY (Secret di GitHub);
  * ogni campo viene validato: se non e' coerente resta vuoto (mai indovinare);
  * il risultato e' messo in cache per hash del file: lo stesso avviso non si paga due volte;
  * un tetto di chiamate per esecuzione (MAX_LLM) limita la spesa.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import subprocess
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

import requests

API = "https://api.anthropic.com/v1/messages"
MODEL = os.environ.get("LLM_MODEL", "claude-haiku-5-5")
MAX_BYTES = 8 * 1024 * 1024
CACHE = Path(__file__).resolve().parent.parent / "data" / "llm_cache.json"

# Parole usate nel linguaggio comune -> codice. Il modello le conosce, ma qui le
# fissiamo noi: il risultato non dipende dall'umore del modello.
GERGO = {
    r"lettere\s+(?:alle\s+)?medie|italiano,?\s+storia\s+e\s+geografia": "A022",
    r"matematica\s+e\s+scienze": "A028",
    r"arte\s+e\s+immagine": "A001",
    r"tecnologia\s+(?:alle\s+)?medie": "A060",
    r"musica\s+(?:alle\s+)?medie": "A030",
    r"scienze\s+motorie\s+(?:alle\s+)?medie": "A049",
    r"inglese\s+(?:alle\s+)?medie": "AB25",
    r"sostegno\s+(?:scuola\s+)?primaria": "ADEE",
    r"sostegno\s+(?:scuola\s+)?(?:secondaria\s+di\s+)?(?:i\s+grado|medie)": "ADMM",
    r"sostegno\s+(?:scuola\s+)?(?:secondaria\s+di\s+)?(?:ii\s+grado|superiori)": "ADSS",
    r"sostegno\s+(?:scuola\s+)?infanzia": "ADAA",
}
CODE_OK = re.compile(r"^(A\d{3}|B\d{3}|A[A-Z]\d{2}|ADEE|ADMM|ADSS|ADAA|EEEE|AAAA)$")

PROMPT = """Sei un lettore di avvisi di interpello/convocazione per supplenze della scuola italiana.
Leggi il documento (anche se e' una scansione) e rispondi SOLO con un oggetto JSON, senza altro testo:
{"posti":[{"istituto":"nome scuola o null","provincia":"sigla 2 lettere o null",
"classe_di_concorso":"codice standard es. A022, B017, ADSS oppure null",
"scadenza":"YYYY-MM-DD HH:MM oppure null","ore_settimanali":numero oppure null,
"tipo_posto":"comune" | "sostegno" | null,"link_candidatura":"URL del modulo, indirizzo email/PEC oppure null"}]}
Regole: un elemento per ogni posto/classe del documento. Se un dato non e' scritto in modo chiaro metti null:
NON indovinare e NON calcolare. Se il testo usa nomi comuni, converti cosi': lettere/italiano alle medie=A022,
matematica e scienze=A028, arte e immagine=A001, tecnologia=A060, musica=A030, inglese medie=AB25,
sostegno primaria=ADEE, sostegno medie=ADMM, sostegno superiori=ADSS, sostegno infanzia=ADAA.
Le ore sono quelle settimanali della cattedra/spezzone (18 = cattedra completa solo se lo dice il testo)."""


def _cache() -> dict:
    try:
        return json.loads(CACHE.read_text("utf-8"))
    except (OSError, ValueError):
        return {}


def _save_cache(c: dict):
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    # teniamo solo le ultime 600 voci
    if len(c) > 600:
        for k in list(c)[: len(c) - 600]:
            c.pop(k)
    CACHE.write_text(json.dumps(c, ensure_ascii=False, indent=0) + "\n", "utf-8")


# ---- scarico e apertura dei contenitori -------------------------------------

def pdfs_from(content: bytes, url: str = "") -> list[bytes]:
    """Da PDF / ZIP / P7M restituisce i PDF contenuti (al massimo 3)."""
    if content[:4] == b"%PDF":
        return [content]
    if content[:2] == b"PK":
        out = []
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as z:
                for n in z.namelist():
                    if n.lower().endswith(".pdf") and len(out) < 3:
                        out.append(z.read(n))
                    elif n.lower().endswith(".p7m") and len(out) < 3:
                        out += pdfs_from(z.read(n), n)
        except zipfile.BadZipFile:
            pass
        return out[:3]
    if url.lower().split("?")[0].endswith(".p7m") or content[:1] == b"\x30":
        return [p for p in [_unwrap_p7m(content)] if p]
    return []


def _unwrap_p7m(content: bytes) -> bytes | None:
    """Estrae il documento dalla busta firmata CAdES (.p7m), senza verificare la firma
    (ci serve solo il contenuto)."""
    with tempfile.TemporaryDirectory() as td:
        src, dst = Path(td, "a.p7m"), Path(td, "a.out")
        src.write_bytes(content)
        for form in ("DER", "PEM"):
            try:
                subprocess.run(["openssl", "smime", "-verify", "-noverify", "-inform", form,
                                "-in", str(src), "-out", str(dst)],
                               capture_output=True, timeout=30, check=True)
                data = dst.read_bytes()
                if data[:4] == b"%PDF":
                    return data
            except (subprocess.SubprocessError, OSError):
                continue
    # ripiego: il PDF spesso e' incluso in chiaro nella busta
    i = content.find(b"%PDF")
    j = content.rfind(b"%%EOF")
    if i >= 0 and j > i:
        return content[i: j + 5]
    return None


# ---- chiamata al modello e validazione ---------------------------------------

def _validate(p: dict) -> dict:
    out: dict = {}
    c = (p.get("classe_di_concorso") or "").strip().upper().replace(" ", "")
    if CODE_OK.match(c):
        out["classe_di_concorso"] = c
    s = p.get("scadenza")
    if isinstance(s, str):
        for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d"):
            try:
                out["scadenza"] = datetime.strptime(s.strip(), fmt).strftime("%Y-%m-%d %H:%M" if " " in s.strip() else "%Y-%m-%d")
                break
            except ValueError:
                continue
    o = p.get("ore_settimanali")
    if isinstance(o, (int, float)) and not isinstance(o, bool) and 1 <= o <= 25:
        out["ore_settimanali"] = int(o) if o == int(o) else round(float(o), 2)
    if p.get("tipo_posto") in ("comune", "sostegno"):
        out["tipo_posto"] = p["tipo_posto"]
    lk = p.get("link_candidatura")
    if isinstance(lk, str) and (re.match(r"https?://\S+$", lk.strip()) or re.match(r"[\w.+-]+@[\w-]+(\.[\w-]+)+$", lk.strip())):
        out["link_candidatura"] = lk.strip()
    if isinstance(p.get("istituto"), str) and 3 <= len(p["istituto"]) <= 120:
        out["istituto"] = p["istituto"].strip()
    pr = p.get("provincia")
    if isinstance(pr, str) and re.fullmatch(r"[A-Za-z]{2}", pr.strip()):
        out["provincia"] = pr.strip().upper()
    return out


def parse_response(text: str) -> list[dict]:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return []
    try:
        posti = json.loads(m.group(0)).get("posti", [])
    except ValueError:
        return []
    return [v for v in (_validate(p) for p in posti if isinstance(p, dict)) if v]


def ask(pdf: bytes, session=requests) -> list[dict]:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return []
    body = {
        "model": MODEL, "max_tokens": 1500,
        "messages": [{"role": "user", "content": [
            {"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                            "data": base64.b64encode(pdf).decode()}},
            {"type": "text", "text": PROMPT}]}],
    }
    r = session.post(API, json=body, timeout=120, headers={
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    if r.status_code != 200:
        return []
    txt = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")
    return parse_response(txt)


def leggi(content: bytes, url: str, budget: list[int], session=requests) -> list[dict]:
    """Punto d'ingresso: contenuto scaricato -> lista di posti validati.
    budget = [chiamate_rimanenti]; decrementato a ogni chiamata a pagamento."""
    out: list[dict] = []
    cache = _cache()
    for pdf in pdfs_from(content, url):
        if len(pdf) > MAX_BYTES:
            continue
        h = hashlib.sha256(pdf).hexdigest()[:24]
        if h in cache:
            out += cache[h]
            continue
        if budget[0] <= 0:
            break
        budget[0] -= 1
        try:
            res = ask(pdf, session)
        except requests.RequestException:
            continue
        cache[h] = res
        out += res
    _save_cache(cache)
    return out
