"""Cerca bandi e avvisi per i percorsi abilitanti (30/36/60 CFU) sulle pagine ufficiali elencate in
abilitazioni_sources.json e li salva in data/abilitazioni.json.
Non decide chi ha diritto di iscriversi: segnala e mette il link. Chi legge verifica i requisiti."""
from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin

from bs4 import BeautifulSoup

import scrape

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "abilitazioni.json"
SRC = Path(__file__).resolve().parent / "abilitazioni_sources.json"
MAX_VOCI = 200


def trova(html: str, base: str, cfg: dict) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    pagina = " ".join(soup.get_text(" ", strip=True).split()).lower()
    pagina_itp = any(k in pagina for k in cfg["itp"])
    out, visti = [], set()
    for a in soup.find_all("a", href=True):
        testo = " ".join(a.get_text(" ", strip=True).split())
        href = urljoin(base, a["href"])
        ctx = scrape.block_of(a)
        hay = (testo + " " + href + " " + ctx[:300]).lower()
        if not any(k in hay for k in cfg["parole"]) or href in visti or not href.startswith("http"):
            continue
        visti.add(href)
        out.append({
            "titolo": (testo or ctx)[:160] or href,
            "link": href,
            "itp": any(k in hay for k in cfg["itp"]),
            "paginaItp": pagina_itp,
        })
    return out[:40]


def main() -> int:
    cfg = json.loads(SRC.read_text("utf-8"))
    vecchio = json.loads(OUT.read_text("utf-8")) if OUT.exists() else {"voci": []}
    voci = {v["id"]: v for v in vecchio.get("voci", [])}
    f = scrape.Fetcher()
    ora = datetime.now(scrape.TZ).isoformat(timespec="seconds")
    nuovi = []
    for src in cfg["fonti"]:
        html = f.get(src["url"])
        if not html:
            scrape.log(f"  [abilitazioni] non letta: {src['nome']}")
            continue
        for v in trova(html, src["url"], cfg):
            vid = "ab-" + hashlib.sha1(v["link"].encode()).hexdigest()[:10]
            if vid in voci:
                voci[vid]["ultimaVolta"] = ora
                continue
            voci[vid] = {"id": vid, **v, "fonte": src["nome"], "visto": ora, "ultimaVolta": ora}
            nuovi.append(vid)
    elenco = sorted(voci.values(), key=lambda x: x["visto"], reverse=True)[:MAX_VOCI]
    OUT.write_text(json.dumps({"aggiornato": ora, "nuovi": nuovi, "voci": elenco}, ensure_ascii=False, indent=1) + "\n", "utf-8")
    scrape.log(f"[abilitazioni] voci {len(elenco)} · nuove {len(nuovi)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
