#!/usr/bin/env python3
"""Campioni di pagine mancate: le legge col bot dichiarato (robots rispettato) e salva testo iniziale,
date dichiarate e link trovati, per capire perche' un avviso non e' entrato. Scrive data/campioni.json."""
from __future__ import annotations
import json, sys
from pathlib import Path
from urllib.parse import urljoin

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import scrape as S  # noqa: E402

URLS = [
    "https://interpelloweb.it/interpelli-supplenze/",
    "https://interpelloweb.it/wp-sitemap-posts-page-1.xml",
]


def main() -> int:
    f = S.Fetcher()
    out = {}
    for u in URLS:
        if u.endswith("robots.txt"):
            try:
                r = f.s.get(u, timeout=20)
                out[u] = {"stato": r.status_code, "testo": r.text[:1500]}
            except Exception as e:  # noqa: BLE001
                out[u] = {"errore": type(e).__name__}
            continue
        html = f.get(u)
        if html and ("<urlset" in html[:500] or "<sitemapindex" in html[:500]):
            out[u] = {"sitemap": html[:6000]}
            continue
        if not html:
            out[u] = {"errore": f.errs.get(u) or "nessuna risposta / robots"}
            continue
        soup = BeautifulSoup(html, "html.parser")
        meta = {(m.get("property") or m.get("name") or m.get("itemprop")): m.get("content") for m in soup.find_all("meta")
                if (m.get("property") or m.get("name") or m.get("itemprop") or "").lower().find("date") >= 0
                or (m.get("property") or "").startswith("article:")}
        tempi = [(t.get("datetime"), t.get_text(" ", strip=True)[:40]) for t in soup.find_all("time")][:10]
        date_cls = [(el.name, " ".join(el.get("class") or []), el.get_text(" ", strip=True)[:60])
                    for el in soup.select("[class*=date],[class*=data],[class*=publish],[class*=time]")][:15]
        links = []
        for a in soup.find_all("a", href=True):
            t = a.get_text(" ", strip=True)
            if len(t) > 25:
                links.append([t[:110], urljoin(u, a["href"])[:200]])
        testo = soup.get_text(" ", strip=True)
        out[u] = {"html": html[:60000] if "interpelloweb" in u else "", "meta": meta, "time": tempi, "classi_data": date_cls, "testo": testo[:3500], "link": links[:60],
                  "codici_nel_testo": sorted(set(S.CODE_RE.findall(testo)))[:40]}
        print(u, "ok", len(testo), flush=True)
    (ROOT / "data" / "campioni.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", "utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
