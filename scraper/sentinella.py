#!/usr/bin/env python3
"""Sentinella: controllo di salute 24/24 del sistema Interpellati.

Ogni esecuzione verifica (solo in lettura, salvo le due riparazioni sicure sotto):
  1. workflow: ultimo esito, serie di fallimenti, workflow fermi da troppo tempo
  2. dati: freschezza e validita' dei file chiave, calo anomalo degli interpelli
  3. copertura scuole: percentuale verdi e calo rispetto all'ultima volta
  4. APK: release `apk` con Interpellati.apk di dimensione plausibile
  5. sicurezza: chiavi/token/keystore o file personali finiti nel repository

Riparazioni automatiche consentite (reversibili, mai sul codice): rilanciare un workflow fallito (max 1 volta
ogni 6 ore, mai build-apk e mai se stessa). Gli allarmi aprono/aggiornano un'issue su GitHub (arriva l'email al
proprietario) e si chiudono da soli quando tutto rientra. Scrive data/salute.json."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "salute.json"
REPO = os.environ.get("GITHUB_REPOSITORY", "mhadhbimedwork-crypto/Interpellati")
ADESSO = datetime.now(timezone.utc)
PROVA = bool(os.environ.get("SENTINELLA_PROVA"))
TITOLO_ISSUE = "Sentinella: allarmi aperti"

# file chiave -> ore massime senza aggiornamenti
FRESCHEZZA = {"data/interpelli.json": 8, "data/memoria_scuole.json": 30, "data/scuole_stato.json": 30,
              "data/priorita_lettura.json": 48}
# workflow -> ore massime dall'ultimo successo (default 48)
SOGLIA_FERMO = {"Scansione interpelli": 6, "Ricerca B015-B017": 12, "Miglioramento giornaliero e memoria": 30,
                "Controllo completezza": 12, "Sentinella": 3}
NON_RILANCIARE = {"build-apk.yml", "sentinella.yml"}

PATTERN_SEGRETI = {
    "chiave privata": re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----"),
    "token GitHub": re.compile(r"\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{36,}\b|github_pat_[A-Za-z0-9_]{50,}"),
    "chiave AWS": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "chiave Google API": re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b"),
    "chiave API sk-": re.compile(r"\bsk-(?:ant-)?[A-Za-z0-9_\-]{40,}\b"),
}
FILE_VIETATI = re.compile(r"(\.jks|\.keystore|\.p12|\.pfx|\.pem|(^|/)\.env(\..*)?|PERSONALE)", re.I)


def sh(*a: str, ok_fail: bool = True) -> str:
    try:
        return subprocess.run(a, capture_output=True, text=True, timeout=120, cwd=ROOT).stdout
    except Exception:  # noqa: BLE001
        return ""


def gh_json(path: str):
    try:
        return json.loads(sh("gh", "api", path) or "null")
    except ValueError:
        return None


def parse_t(s: str | None):
    try:
        return datetime.fromisoformat((s or "").replace("Z", "+00:00"))
    except ValueError:
        return None


def ore_da(t) -> float | None:
    return None if t is None else (ADESSO - t).total_seconds() / 3600


def main() -> int:
    controlli: list[dict] = []
    interventi: list[str] = []
    precedente = {}
    try:
        precedente = json.loads(OUT.read_text("utf-8"))
    except (OSError, ValueError):
        pass

    def c(nome: str, ok: bool | None, dettaglio: str, grave: bool = True):
        controlli.append({"nome": nome, "esito": "ok" if ok else ("attenzione" if not grave else "allarme"), "dettaglio": dettaglio})

    # 1. workflow
    wfs = (gh_json(f"repos/{REPO}/actions/workflows?per_page=100") or {}).get("workflows", [])
    rilanci = precedente.get("rilanci", {})
    for wf in wfs:
        if wf.get("state") != "active" or wf["path"].endswith("sentinella.yml"):
            continue
        runs = (gh_json(f"repos/{REPO}/actions/workflows/{wf['id']}/runs?per_page=8&status=completed") or {}).get("workflow_runs", [])
        if not runs:
            continue
        serie = 0
        for r in runs:
            if r["conclusion"] in ("failure", "timed_out"):
                serie += 1
            elif r["conclusion"] in ("success",):
                break
        ultimo_ok = next((parse_t(r["updated_at"]) for r in runs if r["conclusion"] == "success"), None)
        h = ore_da(ultimo_ok)
        soglia = SOGLIA_FERMO.get(wf["name"], 48)
        programmato = "schedule" in {r["event"] for r in runs}
        nome = f"workflow «{wf['name']}»"
        if serie >= 3:
            c(nome, False, f"{serie} fallimenti di fila")
        elif programmato and (h is None or h > soglia) and serie >= 1:
            c(nome, False, f"nessun successo da {'sempre' if h is None else f'{h:.0f} h'} (soglia {soglia} h)")
        elif serie >= 1:
            c(nome, False, f"ultimo run fallito ({serie} di fila)", grave=False)
        else:
            c(nome, True, "ok" if h is None else f"ultimo successo {h:.1f} h fa")
        if serie >= 1 and os.path.basename(wf["path"]) not in NON_RILANCIARE:
            ult = parse_t(rilanci.get(wf["path"]))
            if not ult or ore_da(ult) > 6:
                r = subprocess.run(["true"] if PROVA else ["gh", "api", "-X", "POST", f"repos/{REPO}/actions/workflows/{wf['id']}/dispatches", "-f", "ref=main"],
                                   capture_output=True, text=True, cwd=ROOT)
                if r.returncode == 0:
                    rilanci[wf["path"]] = ADESSO.isoformat(timespec="seconds")
                    interventi.append(f"rilanciato «{wf['name']}» dopo {serie} fallimento/i")

    # 2. dati
    for rel, soglia in FRESCHEZZA.items():
        p = ROOT / rel
        try:
            json.loads(p.read_text("utf-8"))
            valido = True
        except (OSError, ValueError):
            valido = False
        t = parse_t(sh("git", "log", "-1", "--format=%cI", "--", rel).strip())
        h = ore_da(t)
        if not valido:
            c(f"dati {rel}", False, "file mancante o JSON non valido")
        elif h is None or h > soglia:
            c(f"dati {rel}", False, f"non aggiornato da {'sempre' if h is None else f'{h:.0f} h'} (soglia {soglia} h)")
        else:
            c(f"dati {rel}", True, f"aggiornato {h:.1f} h fa")
    try:
        n = len(json.loads((ROOT / "data/interpelli.json").read_text("utf-8")).get("interpelli", []))
    except (OSError, ValueError):
        n = 0
    prec_n = precedente.get("interpelli", 0)
    c("interpelli presenti", not (prec_n >= 20 and n < 0.7 * prec_n), f"{n} (prima {prec_n})")

    # 3. copertura
    cop = {}
    try:
        sc = json.loads((ROOT / "data/scuole_stato.json").read_text("utf-8"))["scuole"]
        tot = len(sc)
        v = sum(1 for s in sc if s[5] == "v")
        cop = {"scuole": tot, "verdi": v, "arancioni": sum(1 for s in sc if s[5] == "a"), "rossi": sum(1 for s in sc if s[5] == "r"),
               "percentuale_verdi": round(100 * v / max(1, tot), 1)}
        prec = precedente.get("copertura", {}).get("percentuale_verdi")
        c("copertura scuole", not (prec and cop["percentuale_verdi"] < prec - 2),
          f"{cop['percentuale_verdi']}% verdi ({v}/{tot}), arancioni {cop['arancioni']}, rossi {cop['rossi']}")
    except (OSError, ValueError, KeyError):
        c("copertura scuole", False, "elenco scuole non leggibile")

    # 4. APK
    rel = gh_json(f"repos/{REPO}/releases/tags/apk") or {}
    apk = next((a for a in rel.get("assets", []) if a["name"] == "Interpellati.apk"), None)
    c("APK pubblicato", bool(apk and apk["size"] > 10_000_000), f"{apk['size'] // 1_000_000} MB" if apk else "Interpellati.apk assente")

    # 5. sicurezza
    trovati = []
    for rel_f in sh("git", "ls-files").splitlines():
        if FILE_VIETATI.search(rel_f):
            trovati.append(f"file vietato nel repository: {rel_f}")
            continue
        if rel_f.startswith(("data/", "memoria/stato/")) or rel_f.endswith((".png", ".jpg", ".apk", ".xlsx", ".lock", ".svg", ".webp")):
            continue
        p = ROOT / rel_f
        try:
            if p.stat().st_size > 1_500_000:
                continue
            txt = p.read_text("utf-8", errors="ignore")
        except OSError:
            continue
        for nome, rx in PATTERN_SEGRETI.items():
            if rx.search(txt):
                trovati.append(f"{nome} in {rel_f}")
    c("sicurezza (segreti e dati personali)", not trovati, "; ".join(trovati[:5]) if trovati else "nessun segreto o file personale nel repository")

    # esito e issue
    allarmi = [x for x in controlli if x["esito"] == "allarme"]
    attenzioni = [x for x in controlli if x["esito"] == "attenzione"]
    stato = "allarme" if allarmi else ("attenzione" if attenzioni else "ok")
    nuovo = {"aggiornato": ADESSO.isoformat(timespec="seconds"), "stato": stato, "interpelli": n, "copertura": cop,
             "rilanci": rilanci, "interventi": interventi, "controlli": controlli}
    stabile = {k: v for k, v in nuovo.items() if k != "aggiornato"} == {k: v for k, v in precedente.items() if k != "aggiornato"}
    h_prec = ore_da(parse_t(precedente.get("aggiornato")))
    if not PROVA and (not stabile or h_prec is None or h_prec > 6):
        OUT.write_text(json.dumps(nuovo, ensure_ascii=False, indent=1) + "\n", "utf-8")

    if PROVA:
        print(json.dumps(nuovo, ensure_ascii=False, indent=1)[:200]); print("PROVA: nessuna scrittura"); [print(" ", x) for x in controlli]; return 0
    aperte = json.loads(sh("gh", "issue", "list", "--repo", REPO, "--state", "open", "--limit", "50", "--json", "number,title") or "[]")
    num = next((i["number"] for i in aperte if i["title"] == TITOLO_ISSUE), None)
    if allarmi:
        corpo = f"Controllo del {ADESSO:%d/%m/%Y %H:%M} UTC\n\n" + "\n".join(f"- **{x['nome']}**: {x['dettaglio']}" for x in allarmi)
        if interventi:
            corpo += "\n\nInterventi automatici fatti:\n" + "\n".join(f"- {i}" for i in interventi)
        corpo += "\n\n_Si chiude da sola quando tutti i controlli tornano a posto._"
        if num:
            sh("gh", "issue", "edit", str(num), "--repo", REPO, "--body", corpo)
        else:
            sh("gh", "issue", "create", "--repo", REPO, "--title", TITOLO_ISSUE, "--body", corpo)
    elif num:
        sh("gh", "issue", "close", str(num), "--repo", REPO, "--comment", "Tutti i controlli sono tornati a posto.")

    print(f"sentinella: {stato} · {len(controlli)} controlli · {len(interventi)} interventi")
    for x in allarmi + attenzioni:
        print(f"  [{x['esito']}] {x['nome']}: {x['dettaglio']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
