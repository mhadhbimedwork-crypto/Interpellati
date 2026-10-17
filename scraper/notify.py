"""Invia su Telegram i NUOVI interpelli che corrispondono a classi e province scelte.
Configurazione (GitHub): Secrets TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID;
Variables NOTIFY_CLASSI (es. "B015,B017") e NOTIFY_PROVINCE (sigle, vuoto = tutte).
Senza token non fa nulla. Ogni interpello viene notificato una sola volta."""
from __future__ import annotations

import json
import os
import sys
from datetime import date
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "interpelli.json"
SENT = ROOT / "data" / "notificati.json"


def lista(v: str | None) -> set[str]:
    return {x.strip().upper() for x in (v or "").split(",") if x.strip()}


def messaggio(i: dict) -> str:
    righe = [f"Nuovo interpello {', '.join(i.get('classi', []))}"]
    righe.append(" · ".join(x for x in (i.get("scuola"), i.get("comune"), i.get("provincia")) if x))
    det = []
    if i.get("ore"):
        det.append(f"{i['ore']} ore")
    if i.get("scadenza"):
        det.append("scade " + i["scadenza"] + (" " + i["oraScadenza"] if i.get("oraScadenza") else ""))
    if i.get("tipoPosto"):
        det.append(i["tipoPosto"])
    if det:
        righe.append(" · ".join(det))
    righe.append(i.get("candidatura") or i.get("link", ""))
    return "\n".join(r for r in righe if r)


def seleziona(store: dict, classi: set[str], prov: set[str], gia: set[str], oggi: date) -> list[dict]:
    out = []
    for i in store.get("interpelli", []):
        if i["id"] not in set(store.get("nuovi", [])) or i["id"] in gia:
            continue
        if classi and not classi & {c.upper() for c in i.get("classi", [])}:
            continue
        if prov and (i.get("provincia") or "").upper() not in prov:
            continue
        sc = i.get("scadenza")
        if sc and sc < oggi.isoformat():
            continue
        out.append(i)
    return out


ABIL = ROOT / "data" / "abilitazioni.json"


def abilitazioni_nuove(gia: set[str]) -> list[dict]:
    try:
        d = json.loads(ABIL.read_text("utf-8"))
    except (OSError, ValueError):
        return []
    nuovi = set(d.get("nuovi", []))
    return [v for v in d.get("voci", []) if v["id"] in nuovi and v["id"] not in gia]


def msg_abil(v: dict) -> str:
    tag = "ITP" if v.get("itp") else "da verificare se riguarda gli ITP"
    return f"Percorso abilitante ({v.get('fonte')}): {v.get('titolo')}\n[{tag}] Controlla requisiti e scadenza.\n{v.get('link')}"


def main(post=requests.post) -> int:
    tok, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not tok or not chat:
        print("Telegram non configurato: nessuna notifica.")
        return 0
    store = json.loads(DATA.read_text("utf-8"))
    gia = set(json.loads(SENT.read_text("utf-8"))) if SENT.exists() else set()
    da_inviare = seleziona(store, lista(os.environ.get("NOTIFY_CLASSI")), lista(os.environ.get("NOTIFY_PROVINCE")), gia, date.today())
    for i in da_inviare[:20]:
        r = post(f"https://api.telegram.org/bot{tok}/sendMessage",
                 json={"chat_id": chat, "text": messaggio(i), "disable_web_page_preview": True}, timeout=20)
        if r.status_code == 200:
            gia.add(i["id"])
        else:
            print("Telegram: errore", r.status_code)  # il token non viene mai stampato
    for v in abilitazioni_nuove(gia)[:10]:
        r = post(f"https://api.telegram.org/bot{tok}/sendMessage",
                 json={"chat_id": chat, "text": msg_abil(v), "disable_web_page_preview": True}, timeout=20)
        if r.status_code == 200:
            gia.add(v["id"])
    SENT.write_text(json.dumps(sorted(gia)[-3000:]) + "\n", "utf-8")
    print(f"Notifiche inviate: {len(da_inviare[:20])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
