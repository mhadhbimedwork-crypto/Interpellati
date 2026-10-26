#!/usr/bin/env python3
"""Sonda leggera: per ogni scuola chiede UNA sola pagina, il feed RSS (/feed/), per sapere quali siti si possono leggere
con 1-2 richieste invece di 60 (feed WordPress/RSS) e quali supportano le richieste condizionali (ETag/Last-Modified:
se nulla e' cambiato il server risponde 304 senza inviare la pagina). Bot dichiarato, robots.txt rispettato, ritmo adattivo per IP.
Scrive data/cms_report.json (solo dati tecnici pubblici dei siti)."""
from __future__ import annotations
import json, os, sys, time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scrape as S  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "cms_report.json"
BUDGET = int(os.environ.get("BUDGET_S", "2400"))
MAX = int(os.environ.get("MAX", "9000"))


def sonda(f, cod, sito):
    base = sito.rstrip("/")
    url = base + "/feed/"
    r = {"ts": datetime.now().isoformat(timespec="seconds")}
    try:
        if not f.allowed(url):
            return cod, {**r, "robots": True}
        resp = f._richiesta(url, urlparse(url).netloc)
        h = resp.headers
        t = resp.text[:3000].lower() if resp.status_code == 200 else ""
        r.update(st=resp.status_code, rss="<rss" in t or "<feed" in t, wp="wordpress" in t or "wp-json" in t,
                 etag="etag" in h, lm="last-modified" in h, server=(h.get("server") or "")[:30])
    except Exception as e:  # noqa: BLE001
        r["err"] = type(e).__name__
    return cod, r


def main() -> int:
    mem = json.loads((ROOT / "data" / "memoria_scuole.json").read_text("utf-8"))["scuole"]
    prec = json.loads(OUT.read_text("utf-8")) if OUT.exists() else {}
    coda = sorted([c for c, e in mem.items() if e.get("sito") and e["stato"] != "rosso"], key=lambda c: prec.get(c, {}).get("ts", ""))[:MAX]
    f = S.Fetcher()
    t0 = time.time()
    res = dict(prec)
    def lavora(c):
        if time.time() - t0 > BUDGET:
            return None
        return sonda(f, c, mem[c]["sito"])
    with ThreadPoolExecutor(24) as ex:
        for x in ex.map(lavora, coda):
            if x:
                res[x[0]] = x[1]
    OUT.write_text(json.dumps(res, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")
    ok = [v for v in res.values() if v.get("rss")]
    S.log(f"cms: {len(res)} siti sondati · feed RSS {len(ok)} · WordPress {sum(1 for v in res.values() if v.get('wp'))} · ETag {sum(1 for v in res.values() if v.get('etag'))} · Last-Modified {sum(1 for v in res.values() if v.get('lm'))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
