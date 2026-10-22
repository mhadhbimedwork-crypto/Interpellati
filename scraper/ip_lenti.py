#!/usr/bin/env python3
"""Individua i server condivisi da molte scuole (stesso indirizzo IP, >= 25 siti): il gestore limita le richieste ravvicinate
(HTTP 509/429). Scrive data/ip_lenti.json {"ips": {ip: n_scuole}, "scuole": {codice: ip}}. Nessun accesso ai siti: solo DNS."""
from __future__ import annotations
import json, socket, sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "data" / "scuole"


def main() -> int:
    siti = {}
    for ep in [ROOT / "data" / "sicilia_scuole.json"] + sorted(D.glob("*_elenco.json")):
        if "priorita" in ep.name:
            continue
        for cod, v in json.loads(ep.read_text("utf-8")).get("scuole", {}).items():
            if v.get("sito"):
                siti[cod] = v["sito"]
    for fp in sorted(D.glob("*_corretti.json")) + [ROOT / "data" / "sicilia_siti_corretti.json"]:
        try:
            for c, u in json.loads(fp.read_text("utf-8")).items():
                if u:
                    siti[c] = u
        except (OSError, ValueError):
            pass

    def ris(item):
        cod, u = item
        try:
            return cod, socket.gethostbyname(urlparse(u).netloc)
        except (OSError, UnicodeError):
            return cod, ""
    with ThreadPoolExecutor(64) as ex:
        ip = dict(ex.map(ris, siti.items()))
    n = Counter(v for v in ip.values() if v and v != "0.0.0.0")
    # solo gli IP dove e' stato osservato davvero un limite (509/429) nella diagnosi dei siti in errore
    limitati = set()
    try:
        for r in json.loads((ROOT / "data" / "diagnosi_errori.json").read_text("utf-8"))["scuole"].values():
            if any(t.get("st") in (509, 429) for t in r["t"]):
                limitati.add(r["ip"])
    except (OSError, ValueError, KeyError):
        pass
    lenti = {k: c for k, c in n.items() if c >= 10 and k in limitati}
    out = {"ips": lenti, "scuole": {c: v for c, v in ip.items() if v in lenti}}
    (ROOT / "data" / "ip_lenti.json").write_text(json.dumps(out, ensure_ascii=False, indent=0) + "\n", "utf-8")
    print("IP condivisi:", lenti, "· scuole interessate:", len(out["scuole"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
