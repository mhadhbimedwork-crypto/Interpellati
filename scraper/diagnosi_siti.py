#!/usr/bin/env python3
"""Diagnosi e recupero dei siti scolastici siciliani che la scansione non riesce a leggere.

Per ogni scuola con errore in data/sicilia_report.json prova, nell'ordine:
  1. DNS del dominio dichiarato (resolver del runner e DNS-over-HTTPS di Google/Cloudflare);
  2. varianti del dominio: con/senza www, http/https, .edu.it <-> .gov.it <-> .it, codice meccanografico .edu.it;
  3. GET della home: il primo indirizzo che risponde 200 con HTML "da scuola" vince.
Scrive data/sicilia_siti_corretti.json (codice -> nuovo sito) e data/sicilia_diagnosi.json (motivo per ogni scuola).
"""
from __future__ import annotations

import json
import re
import socket
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

import requests

ROOT = Path(__file__).resolve().parent.parent
REPORT = ROOT / "data" / "sicilia_report.json"
ELENCO = ROOT / "data" / "sicilia_scuole.json"
OUT_FIX = ROOT / "data" / "sicilia_siti_corretti.json"
OUT_DIAG = ROOT / "data" / "sicilia_diagnosi.json"
UA = "Mozilla/5.0 (compatible; InterpellatiBot/1.0; +https://github.com/mhadhbimedwork-crypto/Interpellati)"
SCUOLA_RE = re.compile(r"scuola|istituto|liceo|comprensivo|circolo|didattic|alunni|docenti|albo|segreteria|dirigente", re.I)


def dns_locale(host: str) -> bool:
    try:
        socket.getaddrinfo(host, 443)
        return True
    except OSError:
        return False


def dns_doh(s: requests.Session, host: str) -> str:
    """'si' se il dominio esiste nel DNS pubblico, 'no' se NXDOMAIN, '?' se non si sa."""
    for url in ("https://dns.google/resolve", "https://cloudflare-dns.com/dns-query"):
        try:
            r = s.get(url, params={"name": host, "type": "A"}, headers={"accept": "application/dns-json"}, timeout=10)
            j = r.json()
            if j.get("Status") == 3:
                return "no"
            if j.get("Answer"):
                return "si"
            return "vuoto"
        except Exception:
            continue
    return "?"


def candidati(sito: str, codice: str) -> list[str]:
    host = urlparse(sito).netloc.lower()
    base = host[4:] if host.startswith("www.") else host
    nome = base
    for tld in (".edu.it", ".gov.it", ".it"):
        if base.endswith(tld):
            nome = base[: -len(tld)]
            break
    domini = [base]
    for tld in (".edu.it", ".gov.it", ".it"):
        d = nome + tld
        if d not in domini:
            domini.append(d)
    domini += [codice.lower() + ".edu.it", codice.lower() + ".gov.it"]
    out = []
    for d in domini:
        for pre in ("www.", ""):
            for sch in ("https://", "http://"):
                u = f"{sch}{pre}{d}/"
                if u not in out:
                    out.append(u)
    return out


def prova(s: requests.Session, url: str) -> tuple[bool, str]:
    try:
        r = s.get(url, timeout=20, allow_redirects=True)
    except requests.exceptions.SSLError:
        try:
            r = s.get(url, timeout=20, allow_redirects=True, verify=False)
        except Exception as e:
            return False, type(e).__name__
    except Exception as e:
        return False, type(e).__name__
    if r.status_code != 200:
        return False, f"HTTP {r.status_code}"
    if "html" not in r.headers.get("content-type", "html"):
        return False, "non HTML"
    testo = r.text[:200000]
    if len(testo) < 500 or not SCUOLA_RE.search(testo):
        return False, "pagina non scolastica"
    return True, r.url


def diagnostica(item):
    codice, info = item
    s = requests.Session()
    s.headers["User-Agent"] = UA
    sito = info["sito"]
    host = urlparse(sito).netloc.lower()
    d = {"sito": sito, "err": info.get("err"), "dns_runner": dns_locale(host), "dns_pubblico": dns_doh(s, host)}
    tentativi = []
    for u in candidati(sito, codice):
        h = urlparse(u).netloc
        if not dns_locale(h):
            continue
        ok, esito = prova(s, u)
        tentativi.append([u, esito if not ok else "OK"])
        if ok:
            fin = esito
            m = re.match(r"(https?://[^/]+)", fin)
            d["nuovo"] = (m.group(1).lower() + "/") if m else u
            break
    d["tentativi"] = tentativi[:8]
    if "nuovo" in d:
        d["motivo"] = "recuperato"
    elif d["dns_pubblico"] == "no":
        d["motivo"] = "dominio inesistente (sito dismesso o cambiato)"
    elif not tentativi:
        d["motivo"] = "nessuna variante risolve"
    elif all(t[1] in ("ConnectTimeout", "ConnectionError", "ReadTimeout") for t in tentativi):
        d["motivo"] = "il server non risponde (spento o blocca l'estero)"
    else:
        d["motivo"] = "risponde ma con errore: " + tentativi[0][1]
    return codice, d


def main() -> int:
    requests.packages.urllib3.disable_warnings()  # verify=False solo come ultima prova sui certificati scaduti
    rep = json.loads(REPORT.read_text("utf-8"))["scuole"]
    bad = {c: v for c, v in rep.items() if not v.get("ok") and v.get("sito")}
    print(f"Scuole con errore: {len(bad)}")
    with ThreadPoolExecutor(16) as ex:
        ris = dict(ex.map(diagnostica, bad.items()))
    fix = json.loads(OUT_FIX.read_text("utf-8")) if OUT_FIX.exists() else {}
    for c, d in ris.items():
        if d.get("nuovo") and d["nuovo"].rstrip("/") != d["sito"].rstrip("/"):
            fix[c] = d["nuovo"]
    OUT_FIX.write_text(json.dumps(fix, ensure_ascii=False, indent=1, sort_keys=True) + "\n", "utf-8")
    OUT_DIAG.write_text(json.dumps(ris, ensure_ascii=False, indent=1, sort_keys=True) + "\n", "utf-8")
    from collections import Counter
    for k, n in Counter(d["motivo"] for d in ris.values()).most_common():
        print(f"{n:4d}  {k}")
    print(f"Nuovi indirizzi trovati: {sum(1 for d in ris.values() if d.get('nuovo'))} (corretti salvati: {len(fix)})")
    print("DNS runner vs pubblico:", Counter((d['dns_runner'], d['dns_pubblico']) for d in ris.values()).most_common())
    return 0


if __name__ == "__main__":
    sys.exit(main())
