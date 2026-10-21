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


FEED = "https://www.orizzontescuola.it/tag/interpelli/feed/"


def voci_feed(blocco_html: str, base: str) -> list[dict]:
    soup = BeautifulSoup(blocco_html, "html.parser")
    out = []
    for blk in soup.find_all(["li", "tr", "p"]):
        text = " ".join(blk.get_text(" ", strip=True).split())
        cls = S.classes_in(text, True)
        links = [urljoin(base, a["href"]) for a in blk.find_all("a", href=True) if "orizzontescuola.it" not in a["href"]]
        if not cls or not links:
            continue
        prov = S.find_province(text) or S.find_province(links[0].replace("_", " ").replace("/", " ").replace("-", " "))
        out.append({"classi": cls, "provincia": prov, "link": links[0], "testo": text[:160]})
    return out


def riferimento_feed() -> list[dict]:
    """Legge il feed RSS pubblico (pensato per le macchine) con il nostro User-Agent dichiarato."""
    import requests
    r = requests.get(FEED, timeout=30, headers={"User-Agent": S.UA})
    S.log(f"feed {FEED}: HTTP {r.status_code} {len(r.text)}")
    if r.status_code != 200:
        return []
    soup = BeautifulSoup(r.text, "xml")
    oggi = datetime.now(S.TZ).date()
    out = []
    for item in soup.find_all("item")[:10]:
        titolo = item.find("title").get_text(" ", strip=True) if item.find("title") else ""
        cont = item.find("content:encoded") or item.find("description")
        d = S.find_date(titolo)
        if d and (oggi - d).days > 3:
            continue
        v = voci_feed(cont.get_text() if cont else "", FEED)
        S.log(f"  {titolo[:70]} -> {len(v)} voci")
        out += v
    return out


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
        links = [urljoin(url, a["href"]) for a in blk.find_all("a", href=True) if "orizzontescuola.it" not in a["href"] and "scuolainterpelli.it" not in a["href"]]
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
    try:
        ref = riferimento_feed()  # Orizzonte Scuola blocca i bot dichiarati: se risponde 403 si passa oltre, senza aggirare il blocco
    except Exception as e:  # noqa: BLE001
        S.log("feed Orizzonte Scuola non disponibile:", type(e).__name__)
    if not ref:
        for back in range(3):
            d = datetime.now(S.TZ).date() - timedelta(days=back)
            url = f"https://www.scuolainterpelli.it/interpelli-scuola-{d.day}-{S.MESI[d.month - 1]}-{d.year}/"
            v = riferimento(f, url)
            S.log(f"riferimento scuolainterpelli {d}: {len(v)} voci")
            ref += v
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
        f"{oggi}: {voce}\n\nAVVISI CHE MANCANO:\n" + "\n".join(f"- {b['classi']} {b['provincia']} {b['link']}\n    {b['testo']}" for b in buchi) + "\n\nDIAGNOSTICA:\n" + "\n".join(S.REPORT[-60:]) + "\n" + str(f.errs) + "\n", "utf-8")
    print(voce)
    print("\n".join(S.REPORT[-40:]))
    print(f.errs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
