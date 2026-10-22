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
    except Exception:  # anche UnicodeError per nomi di dominio malformati
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


IPA_XLSX = "https://indicepa.gov.it/ipa-dati/dataset/5baa3eb8-266e-455a-8de8-b1f434c279b2/resource/d09adf99-dc10-4349-8c53-27b1e5aa97b6/download/enti.xlsx"
IPA: dict[str, str] = {}  # codice meccanografico -> sito istituzionale dichiarato all'Indice PA


def carica_ipa() -> None:
    """Indice dei domicili digitali della PA (fonte ufficiale AgID): ogni scuola dichiara il proprio sito."""
    import io
    from openpyxl import load_workbook
    try:
        r = requests.get(IPA_XLSX, timeout=120, headers={"User-Agent": UA})
        r.raise_for_status()
        wb = load_workbook(io.BytesIO(r.content), read_only=True)
        ws = wb.active
        righe = ws.iter_rows(values_only=True)
        testa = [str(x or "") for x in next(righe)]
        i_m, i_s = testa.index("Codice_MIUR"), testa.index("Sito_istituzionale")
        for row in righe:
            m, sito = (row[i_m] or ""), (row[i_s] or "")
            if m and sito:
                for cod in str(m).replace(";", ",").split(","):
                    cod = cod.strip().upper()
                    if len(cod) == 10:
                        IPA[cod] = str(sito).strip()
    except Exception as e:  # noqa: BLE001
        print("Indice PA non disponibile:", type(e).__name__, str(e)[:120])
    print(f"Indice PA: {len(IPA)} scuole con sito istituzionale")


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
    ipa = IPA.get(codice.upper())
    if ipa:
        h = urlparse(ipa if "://" in ipa else "https://" + ipa).netloc.lower().removeprefix("www.")
        if h and h not in domini:
            domini.insert(0, h)  # il sito dichiarato all'Indice PA e' il piu' affidabile
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
    if "a breve on line" in testo[:3000].lower() or "inpubblicazione" in testo[:3000].lower():
        return False, "sito non ancora pubblicato"
    if len(testo) < 500 or not SCUOLA_RE.search(testo):
        return False, "pagina non scolastica"
    return True, r.url


def diagnostica(item):
    try:
        return _diagnostica(item)
    except Exception as e:  # una scuola con indirizzo strano non deve fermare le altre
        return item[0], {"sito": item[1].get("sito"), "err": item[1].get("err"), "motivo": "indirizzo non valido: " + type(e).__name__, "tentativi": []}


def _diagnostica(item):
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


def _rapida(item):
    try:
        return _rapida_(item)
    except Exception:
        return diagnostica(item)


def _rapida_(item):
    """Prima verifica di una scuola mai letta: il sito dichiarato risponde come sito scolastico?"""
    codice, info = item
    s = requests.Session()
    s.headers["User-Agent"] = UA
    sito = info["sito"]
    host = urlparse(sito).netloc
    alt = host[4:] if host.startswith("www.") else "www." + host
    for u in (sito, sito.replace(host, alt, 1)):
        ok, esito = prova(s, u)
        if ok:
            m = re.match(r"(https?://[^/]+)", esito)
            return codice, {"sito": (m.group(1).lower() + "/") if m else u, "ok": True, "verificato": "raggiungibile"}
    return diagnostica(item)


def esegui(report: Path, elenco_p: Path, fix_p: Path, diag_p: Path, tutte: bool = False, ipa: bool = True) -> dict:
    """tutte=True: verifica anche le scuole mai lette (prima mappatura di un'area)."""
    requests.packages.urllib3.disable_warnings()  # verify=False solo come ultima prova sui certificati scaduti
    if ipa and not IPA:
        carica_ipa()
    try:
        dati_rep = json.loads(report.read_text("utf-8"))
    except (OSError, ValueError):
        dati_rep = {"scuole": {}}
    rep = dati_rep.get("scuole", {})
    try:
        elenco = json.loads(elenco_p.read_text("utf-8"))["scuole"]
    except (OSError, ValueError, KeyError):
        elenco = {}
    bad = {c: v for c, v in rep.items() if not v.get("ok") and v.get("sito")}
    nuove = {}
    if tutte:
        nuove = {c: {"sito": v["sito"]} for c, v in elenco.items() if v.get("sito") and c not in rep}
    # scuole senza sito nell'anagrafica MIM, se l'Indice PA ne dichiara uno
    for c, v in elenco.items():
        if not v.get("sito") and c.upper() in IPA and c not in bad:
            bad[c] = {"sito": "https://" + urlparse(IPA[c.upper()] if "://" in IPA[c.upper()] else "https://" + IPA[c.upper()]).netloc + "/", "err": "senza sito MIM"}
    print(f"Scuole con errore: {len(bad)} · scuole da verificare per la prima volta: {len(nuove)}")
    with ThreadPoolExecutor(24) as ex:
        ris = dict(ex.map(diagnostica, bad.items()))
        prime = dict(ex.map(_rapida, nuove.items()))
    fix = json.loads(fix_p.read_text("utf-8")) if fix_p.exists() else {}
    for c, d in list(ris.items()) + [(c, d) for c, d in prime.items() if "motivo" in d]:
        if d.get("nuovo") and d["nuovo"].rstrip("/") != d["sito"].rstrip("/"):
            fix[c] = d["nuovo"]
    # la prima mappatura entra nel report: sito raggiungibile o no (la lettura degli avvisi lo aggiorna poi)
    for c, d in prime.items():
        nome = (elenco.get(c) or {}).get("nome", "")
        if d.get("ok"):
            rep[c] = {"sito": d["sito"], "ok": True, "pagine": 1, "trovati": 0, "nome": nome, "verificato": "raggiungibile"}
        elif d.get("nuovo"):
            rep[c] = {"sito": d["nuovo"], "ok": True, "pagine": 1, "trovati": 0, "nome": nome, "verificato": "recuperato"}
        else:
            rep[c] = {"sito": d["sito"], "ok": False, "err": d.get("motivo"), "nome": nome}
    if prime:
        ok = sum(1 for v in rep.values() if v.get("ok"))
        dati_rep.update({"scuole": rep, "siti_letti_ok": ok, "siti_con_errore": len(rep) - ok})
        report.write_text(json.dumps(dati_rep, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")
    fix_p.write_text(json.dumps(fix, ensure_ascii=False, indent=1, sort_keys=True) + "\n", "utf-8")
    tutto = {**ris, **{c: d for c, d in prime.items() if "motivo" in d}}
    diag_p.write_text(json.dumps(tutto, ensure_ascii=False, indent=1, sort_keys=True) + "\n", "utf-8")
    from collections import Counter
    for k, n in Counter(d["motivo"] for d in tutto.values()).most_common():
        print(f"{n:5d}  {k}")
    print(f"Raggiungibili al primo controllo: {sum(1 for d in prime.values() if d.get('ok'))} · nuovi indirizzi: {sum(1 for d in tutto.values() if d.get('nuovo'))} (corretti salvati: {len(fix)})")
    return {"errori": len(bad), "nuove": len(nuove), "corretti": len(fix)}


def main() -> int:
    esegui(REPORT, ELENCO, OUT_FIX, OUT_DIAG)
    return 0


if __name__ == "__main__":
    sys.exit(main())
