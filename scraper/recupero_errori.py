#!/usr/bin/env python3
"""Perche' una parte dei siti scolastici non viene letta? Rilegge, col bot dichiarato e con calma (3 tentativi a distanza,
robots rispettato, nessuna verifica TLS disattivata), tutte le scuole in errore e registra codice, intestazioni del server,
indirizzo IP/gestore e inizio del messaggio. Scrive data/diagnosi_errori.json: serve a capire se e' un limite temporaneo
(509/503), un blocco dell'ospite o un sito davvero spento. Non modifica i dati degli avvisi."""
from __future__ import annotations
import json, random, socket, sys, time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scrape as S  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "data" / "scuole"
PAUSA = 25


def tentativo(f, url):
    try:
        r = f.s.get(url, timeout=25, allow_redirects=True)
        return {"st": r.status_code, "server": r.headers.get("server", "")[:40], "ra": r.headers.get("retry-after", ""),
                "via": (r.headers.get("via") or r.headers.get("x-served-by") or "")[:40], "len": len(r.content),
                "testo": r.text[:160].replace("\n", " ") if r.status_code != 200 else ""}
    except Exception as e:  # noqa: BLE001
        return {"st": type(e).__name__, "testo": str(e)[:120]}


def host_job(arg):
    cod, url = arg
    f = S.Fetcher()
    host = urlparse(url).netloc
    try:
        ip = socket.gethostbyname(host)
    except OSError:
        ip = ""
    out = {"url": url, "ip": ip, "t": []}
    if not f.allowed(url):
        out["t"].append({"st": "robots vieta"})
        return cod, out
    for i in range(3):
        a = tentativo(f, url)
        out["t"].append(a)
        if a["st"] == 200:
            break
        time.sleep(PAUSA + random.randint(0, 10))
    return cod, out


def main() -> int:
    lavori = []
    for fp in sorted(D.glob("*_report.json")):
        if "priorita" in fp.name:
            continue
        for cod, v in json.loads(fp.read_text("utf-8")).get("scuole", {}).items():
            if not v.get("ok") and v.get("sito"):
                lavori.append((cod, v["sito"]))
    random.shuffle(lavori)
    lavori = lavori[:int(__import__("os").environ.get("MAX", "1500"))]
    S.log(f"scuole in errore da riprovare: {len(lavori)}")
    with ThreadPoolExecutor(48) as ex:
        ris = dict(ex.map(host_job, lavori))
    esiti = Counter()
    per_ip = defaultdict(list)
    for c, r in ris.items():
        ultimo = r["t"][-1]["st"]
        esiti["recuperata al riprovo" if any(t["st"] == 200 for t in r["t"]) else f"sempre in errore ({ultimo})"] += 1
        per_ip[r["ip"]].append(c)
    top = sorted(((len(v), k) for k, v in per_ip.items() if k), reverse=True)[:15]
    (ROOT / "data" / "diagnosi_errori.json").write_text(json.dumps({"esiti": esiti.most_common(), "ip_piu_comuni": top, "scuole": ris}, ensure_ascii=False, indent=0) + "\n", "utf-8")
    for k, n in esiti.most_common():
        S.log(f"{n:5d} {k}")
    S.log("IP condivisi da piu scuole:", top[:8])
    return 0


if __name__ == "__main__":
    sys.exit(main())
