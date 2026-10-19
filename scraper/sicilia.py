"""Copertura massima della Sicilia: sito per sito, scuola per scuola.

1. Elenco di tutte le scuole siciliane (statali) dall'anagrafica ufficiale MIM, con il sito web dichiarato.
2. Per ogni scuola: home page + sotto-pagine pertinenti (interpelli, supplenze, MAD, albo, bandi, avvisi).
3. Rotazione a lotti con budget di tempo; report per sito in data/sicilia_report.json.
Rispetta robots.txt e la pausa per host del Fetcher; un solo accesso alla volta per ogni sito.
"""
from __future__ import annotations

import csv
import io
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

import geo

ROOT = Path(__file__).resolve().parent.parent
ELENCO = ROOT / "data" / "sicilia_scuole.json"
STATO = ROOT / "data" / "sicilia_stato.json"
REPORT = ROOT / "data" / "sicilia_report.json"
PREFISSI = ("AG", "CL", "CT", "EN", "ME", "PA", "RG", "SR", "TP")
SOTTO_RE = re.compile(r"interpell|supplenz|messa\s+a\s+disposizione|\bmad\b|albo|bandi|avvis|graduatori|reclutament|personale", re.I)
MAX_SOTTO = 4
THREADS = 12
KNOWN: set[str] = set()  # link gia' in archivio: non vanno riletti per scoprirne la data
MAX_PER_RUN = 220  # scuole per esecuzione: giro completo della Sicilia in poche ore, senza martellare i siti


def _sito(v: str) -> str | None:
    v = (v or "").strip()
    if not v or v.upper().startswith(("NON", "N.D", "ND", "-")) or " " in v or "." not in v:
        return None
    v = re.sub(r"^(https?)[:;]?/{1,3}", r"\1://", v, flags=re.I)
    if not v.lower().startswith("http"):
        v = "https://" + v
    v = v.replace("http://http", "http://").replace("https://http", "http")
    m = re.match(r"(https?://[^/]+)(/.*)?$", v, re.I)
    if not m:
        return None
    path = m.group(2) or "/"
    if re.search(r"/(index|home)\.(php|html?|aspx?)$", path, re.I):
        path = "/"
    return m.group(1).lower() + path.rstrip("/") + "/"


def scarica_elenco(log) -> dict:
    s = requests.Session()
    s.headers["User-Agent"] = geo.UA
    scuole: dict[str, dict] = {}
    colonne_loggate = False
    for nome in geo.ANAG[:2]:  # statali (istituti autonomi + sedi)
        testo = None
        for anno in geo.ANNI:
            try:
                r = s.get(f"{geo.BASE}{nome}{anno}.csv", timeout=180)
            except requests.RequestException as e:
                log(f"  elenco {nome}{anno}: {e}")
                continue
            if r.status_code == 200 and len(r.content) > 5000:
                for enc in ("utf-8-sig", "latin-1"):
                    try:
                        testo = r.content.decode(enc)
                        break
                    except UnicodeDecodeError:
                        pass
                break
        if not testo:
            continue
        rd = csv.DictReader(io.StringIO(testo))
        if not colonne_loggate:
            log("  colonne anagrafica:", ",".join(rd.fieldnames or []))
            colonne_loggate = True
        for row in rd:
            cod = (row.get("CODICESCUOLA") or "").strip().upper()
            if not cod.startswith(PREFISSI):
                continue
            rif = (row.get("CODICEISTITUTORIFERIMENTO") or cod).strip().upper()
            sito = _sito(row.get("SITOWEBSCUOLA") or "")
            nome_s = (row.get("DENOMINAZIONESCUOLA") or "").strip()
            e = scuole.setdefault(rif, {"nome": nome_s, "comune": (row.get("DESCRIZIONECOMUNE") or "").strip(),
                                        "sito": None, "sedi": []})
            if cod == rif:
                e["nome"] = nome_s or e["nome"]
                e["comune"] = (row.get("DESCRIZIONECOMUNE") or "").strip() or e["comune"]
            if sito and not e["sito"]:
                e["sito"] = sito
            if cod != rif:
                e["sedi"].append(cod)
    log(f"  scuole siciliane (istituti): {len(scuole)} · con sito: {sum(1 for v in scuole.values() if v['sito'])}")
    return scuole


def carica_elenco(log) -> dict:
    if ELENCO.exists():
        try:
            d = json.loads(ELENCO.read_text("utf-8"))
            if d.get("scuole") and (time.time() - d.get("ts", 0)) < 30 * 86400:
                for v in d["scuole"].values():
                    v["sito"] = _sito(v.get("sito") or "")  # ri-normalizza (correzioni successive)
                return d["scuole"]
        except ValueError:
            pass
    sc = scarica_elenco(log)
    if sc:
        ELENCO.write_text(json.dumps({"ts": time.time(), "scuole": sc}, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")
    return sc


def _stesso_sito(a: str, b: str) -> bool:
    ha, hb = urlparse(a).netloc.lower().removeprefix("www."), urlparse(b).netloc.lower().removeprefix("www.")
    return ha == hb


def data_pagina(S, f, url: str):
    """Data di pubblicazione di un avviso senza data nel titolo: metadati della pagina (article:published_time, <time>)."""
    html = f.get(url)
    if not html:
        return None
    soup = BeautifulSoup(html, "html.parser")
    cand = []
    for m in soup.find_all("meta", attrs={"property": re.compile("published_time|date", re.I)}):
        cand.append(m.get("content") or "")
    for t in soup.find_all("time"):
        cand.append(t.get("datetime") or t.get_text(" ", strip=True))
    body = soup.find("article") or soup.find("main") or soup
    cand.append(" ".join(body.get_text(" ", strip=True).split())[:400])
    for c in cand:
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", c.strip())
        try:
            if m:
                return date(int(m[1]), int(m[2]), int(m[3]))
        except ValueError:
            pass
        d = S.find_date(c)
        if d:
            return d
    return None


def scansiona_scuola(S, f, cod: str, sc: dict, since: date) -> tuple[list[dict], dict]:
    sito = sc["sito"]
    rep = {"sito": sito, "ok": False, "pagine": 0, "trovati": 0}
    out: list[dict] = []
    if not sito:
        return out, rep
    prima = f.pages
    html = f.get(sito)
    if not html:
        # varianti: senza/con www, poi http
        host = urlparse(sito).netloc.lower()
        alt = host[4:] if host.startswith("www.") else "www." + host
        for cand in (sito.replace(urlparse(sito).netloc, alt), "http://" + host + "/"):
            html = f.get(cand)
            if html:
                sito = cand
                break
    if not html:
        rep["err"] = f.errs.get(rep["sito"], "non raggiungibile")
        return out, rep
    rep["ok"] = True
    sigla = cod[:2]
    prov = S.SIGLA.get(sigla)
    pagine = [sito]
    soup = BeautifulSoup(html, "html.parser")
    visti = {sito}
    for a in soup.find_all("a", href=True):
        h = urljoin(sito, a["href"]).split("#")[0]
        t = " ".join(a.get_text(" ", strip=True).split())
        if h in visti or not _stesso_sito(h, sito) or re.search(r"\.(pdf|docx?|jpg|png|zip)$", h, re.I):
            continue
        if SOTTO_RE.search(t) or SOTTO_RE.search(urlparse(h).path):
            visti.add(h)
            pagine.append(h)
            if len(pagine) > MAX_SOTTO:
                break
    for url in pagine:
        src = {"nome": f"Sito scuola {sc['nome'][:40]}", "provincia": prov, "url": url}
        try:
            trovati = S.scan_html(f, src, since, html if url == sito else (f.get(url) or ""), undated=True)
        except Exception as e:  # una scuola con HTML strano non deve fermare le altre
            rep["err"] = type(e).__name__
            continue
        for it in trovati:
            if not it.get("pubblicato"):
                if it["link"] in KNOWN:
                    continue
                d = data_pagina(S, f, it["link"])
                if not d or d < since:
                    continue
                it["pubblicato"] = d.isoformat()
            it["codiceScuola"] = cod
            it["fonte"] = "Sito scuola"
            if sc.get("comune"):
                it["comune"] = sc["comune"]
            if not it.get("scuola") or len(it["scuola"]) < 6:
                it["scuola"] = sc["nome"]
            out.append(it)
    rep["pagine"] = f.pages - prima
    rep["trovati"] = len(out)
    return out, rep


def scansiona_sicilia(S, f, since: date, budget_s: int = 540) -> list[dict]:
    log = S.log
    scuole = carica_elenco(log)
    if not scuole:
        log("  Sicilia: elenco scuole non disponibile")
        return []
    codici = sorted(c for c, v in scuole.items() if v["sito"])
    try:
        stato = json.loads(STATO.read_text("utf-8"))
    except (OSError, ValueError):
        stato = {}
    cur = int(stato.get("cursore", 0)) % max(1, len(codici))
    ordine = (codici[cur:] + codici[:cur])[:MAX_PER_RUN]
    t0 = time.time()
    report: dict[str, dict] = {}
    trovati: list[dict] = []
    fatte = 0
    lotto = THREADS * 6
    for i in range(0, len(ordine), lotto):
        if time.time() - t0 > budget_s:
            break
        blocco = ordine[i:i + lotto]
        with ThreadPoolExecutor(THREADS) as ex:
            res = list(ex.map(lambda c: scansiona_scuola(S, f, c, scuole[c], since), blocco))
        for c, (it, rep) in zip(blocco, res):
            report[c] = {**rep, "nome": scuole[c]["nome"]}
            trovati += it
        fatte += len(blocco)
    STATO.write_text(json.dumps({"cursore": (cur + fatte) % max(1, len(codici)), "giri": stato.get("giri", 0) + (1 if cur + fatte >= len(codici) else 0)}) + "\n", "utf-8")
    # il report accumula: sovrascrive solo le scuole rilette in questa esecuzione
    try:
        vecchio = json.loads(REPORT.read_text("utf-8")).get("scuole", {})
    except (OSError, ValueError):
        vecchio = {}
    vecchio.update(report)
    ok = sum(1 for v in vecchio.values() if v.get("ok"))
    REPORT.write_text(json.dumps({
        "aggiornato": datetime.now().isoformat(timespec="seconds"),
        "istituti_sicilia": len(scuole), "con_sito": len(codici),
        "siti_letti_ok": ok, "siti_con_errore": len(vecchio) - ok,
        "avvisi_trovati_ultimo_giro": len(trovati), "scuole_lette_ultimo_giro": fatte,
        "scuole": vecchio}, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")
    log(f"  Sicilia: {fatte}/{len(codici)} siti scolastici letti ({ok} ok) · avvisi trovati {len(trovati)} · {int(time.time()-t0)}s")
    return trovati
