#!/usr/bin/env python3
"""Legge a turni gli uffici scolastici (USR/UST/ATP) di tutta Italia: homepage + pagine 'interpelli' collegate.
Uso: python scraper/uffici.py <k> <n>  (turno k di n, in parallelo). Avvisi in data/scuole/uffici<k>_trovati.json"""
from __future__ import annotations
import json, sys, time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin
from bs4 import BeautifulSoup
sys.path.insert(0, str(Path(__file__).resolve().parent))
import scrape as S  # noqa: E402

D = S.ROOT / "data"


def pagine_interpelli(f, url: str, html: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for a in soup.find_all("a", href=True):
        t = (a.get_text(" ", strip=True) + " " + a["href"]).lower()
        if any(k in t for k in ("interpell", "supplenz", "disponibilit", "convocazion")) and not a["href"].lower().split("?")[0].endswith((".pdf", ".doc", ".docx", ".zip")):
            u = urljoin(url, a["href"])
            if u not in out and u != url:
                out.append(u)
    return out[:6]


def uno(f, off: dict, since: date) -> list[dict]:
    html = f.get(off["url"])
    if not html:
        return []
    src = {"nome": off["nome"], "url": off["url"], "provincia": off.get("provincia")}
    res = S.scan_html(f, src, since, html)
    for u in pagine_interpelli(f, off["url"], html):
        h2 = f.get(u)
        if h2:
            res += S.scan_html(f, dict(src, url=u), since, h2, undated=True)
    return res


def main() -> int:
    k, n = int(sys.argv[1]), int(sys.argv[2])
    uff = json.loads((D / "uffici_ipa.json").read_text("utf-8"))
    fissi = json.loads(S.SOURCES.read_text("utf-8"))["uffici"]
    try:
        uff += json.loads((D / "uffici_scoperti.json").read_text("utf-8"))
    except (OSError, ValueError):
        pass
    visti = {u["url"] for u in uff}
    uff += [u for u in fissi if u["url"] not in visti]
    uff = [u for i, u in enumerate(sorted(uff, key=lambda x: x["url"])) if i % n == k]
    f = S.Fetcher()
    since = date.today() - timedelta(days=10)
    t0 = time.time()
    trovati = []
    with ThreadPoolExecutor(8) as ex:
        for r in ex.map(lambda o: uno(f, o, since), uff):
            trovati += r
    tp = D / "scuole" / f"uffici{k}_trovati.json"
    try:
        vecchi = json.loads(tp.read_text("utf-8"))
    except (OSError, ValueError):
        vecchi = []
    limite = (date.today() - timedelta(days=4)).isoformat()
    per = {(i["link"], tuple(i["classi"])): i for i in vecchi if (i.get("_visto") or "") >= limite}
    ora = datetime.now().isoformat(timespec="seconds")
    for it in trovati:
        it["_visto"] = ora
        per[(it["link"], tuple(it["classi"]))] = it
    tp.parent.mkdir(parents=True, exist_ok=True)
    tp.write_text(json.dumps(list(per.values()), ensure_ascii=False, indent=0) + "\n", "utf-8")
    print(f"turno {k}/{n}: uffici {len(uff)} · avvisi {len(trovati)} · in attesa {len(per)} · {int(time.time()-t0)}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
