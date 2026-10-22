#!/usr/bin/env python3
"""Prova di un ufficio: mostra per ogni link trovato classi, data, forma e se passa i filtri.
Uso: python scraper/prova_ufficio.py URL [URL...]  -> data/prova_ufficio.json"""
from __future__ import annotations
import json, sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scrape as S  # noqa: E402
import uffici as U  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    f = S.Fetcher()
    since = date.today() - timedelta(days=10)
    out = {}
    for url in sys.argv[1:]:
        righe = []
        try:
            grezzi = U.uno(f, {"nome": "prova", "url": url, "provincia": None}, since)
        except Exception as e:  # noqa: BLE001
            out[url] = {"errore": repr(e)}
            continue
        cache = {}
        for i in grezzi[:40]:
            dp = U.data_pagina(f, i["link"], cache) if U.forma_ok(i) and not i.get("pubblicato") else ""
            righe.append({"link": i["link"][:160], "classi": i["classi"], "pubblicato": i.get("pubblicato"),
                          "forma_ok": U.forma_ok(i), "data_pagina": dp, "titolo": i.get("scuola", "")[:90]})
        out[url] = {"grezzi": len(grezzi), "errore_fetch": f.errs.get(url), "righe": righe}
        print(url, len(grezzi), flush=True)
    (ROOT / "data" / "prova_ufficio.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", "utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
