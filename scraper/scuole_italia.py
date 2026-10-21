#!/usr/bin/env python3
"""Copertura nazionale: tutte le scuole statali d'Italia, sito per sito, a gruppi di regioni.

Uso: python scraper/scuole_italia.py <area>
Ogni area ha i suoi file in data/scuole/<area>_*.json (elenco, rotazione, report, siti corretti, avvisi trovati).
Per un'area nuova: prima mappatura (quali siti rispondono, recupero dei siti cambiati via Indice PA), poi lettura
a rotazione degli avvisi. Gli avvisi trovati vanno in <area>_trovati.json e la scansione principale li importa.
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import diagnosi_siti  # noqa: E402
import scrape as S  # noqa: E402
import sicilia  # noqa: E402

AREE = {
    "nordovest": ("Nord-Ovest (Piemonte, Valle d'Aosta, Liguria, Lombardia)",
                  "AL AT BI CN NO TO VB VC AO GE IM SP SV BG BS CO CR LC LO MB MI MN PV SO VA"),
    "nordest": ("Nord-Est (Trentino-Alto Adige, Veneto, Friuli-Venezia Giulia, Emilia-Romagna)",
                "BZ TN BL PD RO TV VE VI VR GO PN TS UD BO FC FE MO PC PR RA RE RN"),
    "centro": ("Centro (Toscana, Umbria, Marche, Lazio)",
               "AR FI GR LI LU MS PI PO PT SI PG TR AN AP FM MC PU FR LT RI RM VT"),
    "sud": ("Sud (Abruzzo, Molise, Campania)", "AQ CH PE TE CB IS AV BN CE NA SA"),
    "sud2": ("Sud (Puglia, Basilicata, Calabria)", "BA BR BT FG LE TA MT PZ CS CZ KR RC VV"),
    "sardegna": ("Sardegna", "CA CI NU OG OR OT SS SU VS"),
}
DATI = Path(__file__).resolve().parent.parent / "data"


def main() -> int:
    area = sys.argv[1] if len(sys.argv) > 1 else ""
    if area not in AREE:
        print("Aree:", ", ".join(AREE))
        return 2
    nome, sigle = AREE[area]
    sicilia.configura(area, tuple(sigle.split()), nome)
    sicilia.MAX_PER_RUN = int(os.environ.get("SCUOLE_PER_ESECUZIONE", "450"))
    sicilia.THREADS = 16
    budget = int(os.environ.get("BUDGET_S", "1500"))
    t0 = time.time()

    elenco = sicilia.carica_elenco(S.log)
    if not elenco:
        S.log(f"{nome}: anagrafica non disponibile")
        return 1
    # 1. prima mappatura / recupero siti (una volta al giorno o quando l'area e' nuova)
    d = DATI / "scuole"
    mappa_fatta = d / f"{area}_mappa.txt"
    oggi = date.today().isoformat()
    if not mappa_fatta.exists() or mappa_fatta.read_text().strip() != oggi:
        diagnosi_siti.esegui(sicilia.REPORT, sicilia.ELENCO, sicilia.CORRETTI, d / f"{area}_diagnosi.json", tutte=True)
        mappa_fatta.write_text(oggi + "\n")
        elenco = sicilia.carica_elenco(S.log)  # rilegge con i siti corretti

    # 2. lettura degli avvisi a rotazione, nel tempo che resta
    resta = max(120, budget - int(time.time() - t0))
    try:
        store = json.loads((DATI / "interpelli.json").read_text("utf-8"))
        sicilia.KNOWN = {i.get("link") for i in store.get("interpelli", [])}
    except (OSError, ValueError):
        sicilia.KNOWN = set()
    f = S.Fetcher()
    since = date.today() - timedelta(days=10)
    trovati = sicilia.scansiona_sicilia(S, f, since, budget_s=resta)

    # 3. avvisi trovati: tenuti 4 giorni, la scansione principale li importa (dettagli, ore, durata, notifiche)
    tp = d / f"{area}_trovati.json"
    try:
        vecchi = json.loads(tp.read_text("utf-8"))
    except (OSError, ValueError):
        vecchi = []
    limite = (date.today() - timedelta(days=4)).isoformat()
    per_link = {(i["link"], tuple(i["classi"])): i for i in vecchi if (i.get("_visto") or "") >= limite}
    ora = datetime.now().isoformat(timespec="seconds")
    for it in trovati:
        it["_visto"] = ora
        per_link[(it["link"], tuple(it["classi"]))] = it
    tp.write_text(json.dumps(list(per_link.values()), ensure_ascii=False, indent=0) + "\n", "utf-8")
    S.log(f"{nome}: avvisi nuovi in questa esecuzione {len(trovati)} · in attesa di importazione {len(per_link)} · {int(time.time()-t0)}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
