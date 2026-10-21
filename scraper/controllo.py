#!/usr/bin/env python3
"""Controllo quotidiano di completezza: confronta i nostri avvisi con gli articoli di riferimento (Orizzonte Scuola)
e registra i 'buchi'. Scrive data/controllo.json (storico) e data/controllo_buchi.txt."""
from __future__ import annotations
import json, re, sys
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin
from bs4 import BeautifulSoup
sys.path.insert(0, str(Path(__file__).resolve().parent))
import scrape as S  # noqa: E402

D = S.ROOT / "data"
TAG = "https://www.orizzontescuola.it/tag/interpelli/"


def articoli(f) -> list[tuple[str, str]]:
    html = f.get(TAG)
    out = []
    if html:
        for a in BeautifulSoup(html, "html.parser").find_all("a", href=True):
            t = a.get_text(" ", strip=True)
            h = urljoin(TAG, a["href"])
            if "orizzontescuola.it" in h and re.search(r"interpell", t + h, re.I) and "/tag/" not in h and (t, h) not in out:
                out.append((t, h))
    return out[:12]


def riferimento(f, url: str) -> list[dict]:
    html = f.get(url)
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    main = soup.find("article") or soup.find("main") or soup
    out = []
    for blk in main.find_all(["li", "tr", "p"]):
        text = " ".join(blk.get_text(" ", strip=True).split())
        cls = S.classes_in(text, True)
        links = [urljoin(url, a["href"]) for a in blk.find_all("a", href=True) if "orizzontescuola.it" not in a["href"]]
        if not cls or not links:
            continue
        prov = S.find_province(text) or S.find_province(links[0].replace("_", " ").replace("/", " ").replace("-", " "))
        out.append({"classi": cls, "provincia": prov, "link": links[0], "testo": text[:160]})
    return out


def norm(u: str) -> str:
    return re.sub(r"^https?://(www\.)?", "", u).rstrip("/").lower()


def main() -> int:
    f = S.Fetcher()
    store = json.loads((D / "interpelli.json").read_text("utf-8"))["interpelli"]
    link_n = {norm(i["link"]) for i in store if i.get("link")}
    cp = {(c, S.PROVINCE[p][0] if p in S.PROVINCE else None) for i in store for c in i.get("classi", []) for p in [None]}
    cp = {(c, i.get("provincia")) for i in store for c in i.get("classi", [])}
    ref = []
    for t, u in articoli(f)[:6]:
        r = riferimento(f, u)
        S.log(f"articolo {t[:70]} -> {len(r)} voci")
        ref += r
    tot = len(ref)
    esatti, per_cp, buchi = 0, 0, []
    for r in ref:
        prov = S.PROVINCE[r["provincia"]][0] if r["provincia"] in S.PROVINCE else None
        if norm(r["link"]) in link_n:
            esatti += 1; per_cp += 1
        elif any((c, prov) in cp for c in r["classi"]):
            per_cp += 1
        else:
            buchi.append(r)
    oggi = datetime.now(S.TZ).date().isoformat()
    voce = {"data": oggi, "riferimento": tot, "esatti": esatti, "classe_provincia": per_cp, "mancanti": len(buchi),
            "percentuale": round(100 * per_cp / tot, 1) if tot else None,
            "percentuale_esatta": round(100 * esatti / tot, 1) if tot else None}
    p = D / "controllo.json"
    try:
        st = json.loads(p.read_text("utf-8"))
    except (OSError, ValueError):
        st = []
    st = [x for x in st if x["data"] != oggi] + [voce]
    p.write_text(json.dumps(st[-90:], ensure_ascii=False, indent=1) + "\n", "utf-8")
    (D / "controllo_buchi.txt").write_text(
        f"{oggi}: {voce}\n\nAVVISI CHE MANCANO:\n" + "\n".join(f"- {b['classi']} {b['provincia']} {b['link']}\n    {b['testo']}" for b in buchi) + "\n", "utf-8")
    print(voce)
    return 0


if __name__ == "__main__":
    sys.exit(main())
