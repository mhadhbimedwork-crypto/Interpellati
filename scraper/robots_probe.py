#!/usr/bin/env python3
"""Legge SOLO i robots.txt di alcuni siti per capire cosa consentono davvero (nessuna pagina scolastica)."""
import json, sys, urllib.robotparser
from pathlib import Path
import requests
sys.path.insert(0, str(Path(__file__).resolve().parent))
import scrape as S
ROOT = Path(__file__).resolve().parent.parent
d = json.loads((ROOT / "data/diagnosi_errori.json").read_text("utf-8"))["scuole"]
rv = [(k, v) for k, v in d.items() if v.get("t") and v["t"][-1].get("st") == "robots vieta"]
out = {}
for k, v in rv[:400:40] + [x for x in rv if x[1].get("ip") != "217.27.72.228"][:6]:
    host = "/".join(v["url"].split("/")[:3])
    try:
        r = requests.get(host + "/robots.txt", timeout=15, headers={"User-Agent": S.UA})
        rp = urllib.robotparser.RobotFileParser(); rp.parse(r.text.splitlines())
        out[k] = {"host": host, "status": r.status_code, "ip": v.get("ip"), "home_ok": rp.can_fetch(S.UA, host + "/"),
                  "ct": r.headers.get("content-type", ""), "testo": r.text[:700]}
    except Exception as e:  # noqa: BLE001
        out[k] = {"host": host, "errore": str(e)[:120]}
(ROOT / "data" / "robots_probe.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", "utf-8")
print(len(out), "robots letti")
