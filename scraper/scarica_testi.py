#!/usr/bin/env python3
"""Scarica da fonti ufficiali/ripubblicate il testo delle tabelle delle classi di concorso (DM 259/2017) e lo salva come testo
in data/fonti_classi/ per l'analisi. Solo documenti pubblici."""
import io, sys
from pathlib import Path
import requests
from pypdf import PdfReader

OUT = Path(__file__).resolve().parent.parent / "data" / "fonti_classi"
OUT.mkdir(parents=True, exist_ok=True)
URLS = {
    "dm259_unisalento": "https://www.unisalento.it/documents/20143/2013912/DM259_2017.pdf/27e5b60d-d1c0-4601-2b1b-72f8e9dd68f5",
    "dm259_unicas": "https://www.unicas.it/media/ej0dfmcs/dm-259-del-2017.pdf",
    "allegato5_venezia": "https://venezia.istruzioneveneto.gov.it/wp-content/uploads/2019/04/Allegato-5-Classi-di-concorso-esprimibili-D.P.R.-19_2016.pdf",
}
for k, u in URLS.items():
    try:
        r = requests.get(u, timeout=120, headers={"User-Agent": "Mozilla/5.0 (compatible; InterpellatiBot/1.0; +https://github.com/mhadhbimedwork-crypto/Interpellati)"})
        print(k, r.status_code, len(r.content))
        if r.status_code != 200:
            continue
        rd = PdfReader(io.BytesIO(r.content))
        txt = "\n".join((p.extract_text() or "") for p in rd.pages)
        (OUT / f"{k}.txt").write_text(txt, "utf-8")
        print("  pagine", len(rd.pages), "caratteri", len(txt))
    except Exception as e:  # noqa: BLE001
        print(k, "errore", type(e).__name__, str(e)[:100])
