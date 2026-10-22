#!/usr/bin/env python3
"""Diagnosi degli uffici che non rispondono: per ogni sito prova, con lo stesso bot dichiarato,
pagina, robots.txt, feed RSS e API pubblica di WordPress; registra codice, server, tipo di blocco,
errore TLS e risoluzione DNS. Non modifica i dati: scrive data/diagnosi_uffici.json e .md."""
from __future__ import annotations
import json, socket, ssl, sys, time
from pathlib import Path
from urllib.parse import urlparse

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import scrape as S  # noqa: E402

SITI = {
    "Benevento": ["https://www.uspbenevento.it/", "https://www.uspbenevento.it/uat/category/interpelli-e-varie/"],
    "Livorno": ["https://www.ustli.it/", "https://www.ustli.it/usp_livorno/index.php/docenti/interpelli"],
    "Foggia": ["https://www.ustfoggia.it/", "https://www.ustfoggia.it/category/docenti/interpelli/"],
    "Salerno": ["https://uat-salerno.it/", "https://uat-salerno.it/Documenti/CIRCOLARI/Interpelli-per-reclutamento-personale-docente"],
    "Milano": ["https://milano.istruzionelombardia.gov.it/"],
    "Brescia": ["https://brescia.istruzionelombardia.gov.it/"],
    "Monza e Brianza": ["https://monza.istruzionelombardia.gov.it/"],
    "Macerata": ["http://www.uspmc.sinp.net/", "https://www.uspmc.sinp.net/"],
    "Oristano": ["https://lnx.csaoristano.it/", "https://www.csaoristano.it/"],
    "Verona": ["https://win.istruzioneverona.it/", "https://www.istruzioneverona.it/", "https://verona.istruzioneveneto.gov.it/"],
    "Firenze": ["https://www.csa.fi.it/", "https://www.ust.fi.it/"],
    "Udine": ["https://usrfvg.gov.it/it/home/menu/uffici/ufficio-territoriale-di-udine/", "https://www.usrfvg.gov.it/"],
    "Pordenone": ["https://www.usrfvg.gov.it/it/home/menu/uffici/ufficio-territoriale-di-pordenone/"],
    "Frosinone": ["https://uspistruzione.fr.it/wp2/", "https://lnx.uspistruzione.fr.it/"],
    "Perugia": ["https://istruzione.umbria.it/", "https://www.istruzione.umbria.it/"],
    "Pisa": ["https://www.toscana-istruzione.it/atpisa/", "https://pisa.toscana-istruzione.it/"],
    "Rieti": ["https://www.usp-rieti.it/"],
    "Parma": ["https://pr.istruzioneer.gov.it/"],
    "Rimini": ["https://rn.istruzioneer.gov.it/"],
    "Sud Sardegna": ["https://www.mim.gov.it/web/sud-sardegna/", "https://www.mim.gov.it/web/carbonia-iglesias/", "https://www.mim.gov.it/web/medio-campidano/"],
    "Sicilia USR": ["https://www.usr.sicilia.it/"],
    "Piemonte interpelli": ["https://servizi.istruzionepiemonte.it/interpello2024/", "https://servizi.istruzionepiemonte.it/"],
}

BLOCCHI = {"cloudflare": "Cloudflare", "cf-ray": "Cloudflare", "sucuri": "Sucuri", "wordfence": "Wordfence",
           "imunify": "Imunify360", "mod_security": "ModSecurity", "incapsula": "Imperva", "akamai": "Akamai",
           "access denied": "accesso negato", "forbidden": "vietato", "captcha": "captcha", "aruba": "Aruba"}


def dns(host: str) -> str:
    try:
        return ",".join(sorted({a[4][0] for a in socket.getaddrinfo(host, 443)})[:3])
    except OSError as e:
        return "DNS: " + type(e).__name__


def tls(host: str) -> str:
    """Esito della verifica del certificato con i certificati di sistema (nessuna eccezione disattivata)."""
    ctx = ssl.create_default_context()
    try:
        with socket.create_connection((host, 443), timeout=15) as s, ctx.wrap_socket(s, server_hostname=host) as t:
            c = t.getpeercert()
            return "ok fino al " + c.get("notAfter", "?")
    except ssl.SSLCertVerificationError as e:
        return "certificato non valido: " + (e.verify_message or str(e))[:120]
    except Exception as e:  # noqa: BLE001
        return type(e).__name__ + ": " + str(e)[:100]


def prova(f: S.Fetcher, url: str) -> dict:
    out = {"url": url}
    try:
        if not f.allowed(url):
            out.update(stato="robots vieta")
            return out
        r = f.s.get(url, timeout=25, allow_redirects=True)
        corpo = r.text[:3000].lower()
        intest = " ".join(f"{k}:{v}" for k, v in r.headers.items()).lower()
        out.update(stato=r.status_code, finale=r.url, server=r.headers.get("server", ""),
                   blocco=sorted({v for k, v in BLOCCHI.items() if k in corpo or k in intest}),
                   titolo=(corpo.split("<title>")[1].split("</title>")[0][:90] if "<title>" in corpo else ""))
    except requests.exceptions.SSLError as e:
        out.update(stato="SSL", errore=str(e)[:200])
    except Exception as e:  # noqa: BLE001
        out.update(stato=type(e).__name__, errore=str(e)[:160])
    return out


def main() -> int:
    f = S.Fetcher()
    ris = {}
    for prov, urls in SITI.items():
        righe = []
        for u in urls:
            host = urlparse(u).hostname
            base = f"{urlparse(u).scheme}://{host}"
            d = {"host": host, "dns": dns(host), "tls": tls(host) if u.startswith("https") else "http", "robots": None}
            try:
                rb = f.s.get(base + "/robots.txt", timeout=20)
                d["robots"] = f"{rb.status_code} " + " | ".join(l.strip() for l in rb.text.splitlines() if l.lower().startswith(("user-agent", "disallow")))[:300]
            except Exception as e:  # noqa: BLE001
                d["robots"] = type(e).__name__
            d["pagina"] = prova(f, u)
            for extra in ("/feed/", "/wp-json/wp/v2/posts?per_page=3&_fields=date,link,title"):
                d[extra] = prova(f, base + extra)
                time.sleep(1.5)
            righe.append(d)
            time.sleep(1.5)
        ris[prov] = righe
        print(prov, [(r["host"], r["pagina"].get("stato"), r["/feed/"].get("stato"), r["/wp-json/wp/v2/posts?per_page=3&_fields=date,link,title"].get("stato"), r["tls"][:40]) for r in righe], flush=True)
    (ROOT / "data" / "diagnosi_uffici.json").write_text(json.dumps(ris, ensure_ascii=False, indent=1) + "\n", "utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
