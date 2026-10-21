#!/usr/bin/env python3
"""Scopre i siti degli uffici scolastici provinciali (UST/ATP/USP) provando i modelli di indirizzo piu' diffusi
e tenendo solo le pagine che nominano davvero la provincia e l'ufficio scolastico. Scrive data/uffici_scoperti.json."""
from __future__ import annotations
import json, re, sys, unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import requests
sys.path.insert(0, str(Path(__file__).resolve().parent))
import scrape as S  # noqa: E402

OUT = S.ROOT / "data" / "uffici_scoperti.json"
REG = {"Piemonte": "istruzionepiemonte.it", "Lombardia": "istruzione.lombardia.gov.it", "Veneto": "istruzioneveneto.gov.it",
       "Emilia-Romagna": "istruzioneer.gov.it", "Liguria": "istruzioneliguria.it", "Sicilia": "usr.sicilia.it",
       "Toscana": "toscana.istruzione.it", "Campania": "campania.istruzione.it", "Puglia": "puglia.istruzione.it",
       "Calabria": "istruzione.calabria.it", "Lazio": "usrlazio.it", "Marche": "marche.istruzione.it",
       "Abruzzo": "abruzzo.istruzione.it", "Umbria": "istruzione.umbria.it", "Sardegna": "sardegna.istruzione.it",
       "Basilicata": "basilicata.istruzione.it", "Molise": "molise.istruzione.it", "Friuli Venezia Giulia": "scuola.fvg.it"}


def slug(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z]", "", s)


def candidati(prov: str, sigla: str, reg: str) -> list[str]:
    p, sg = slug(prov), sigla.lower()
    c = [f"{p}.istruzioneveneto.gov.it", f"{sg}.istruzioneer.gov.it", f"{p}.istruzionepiemonte.it",
         f"{p}.istruzione.lombardia.gov.it", f"{sg}.usr.sicilia.it", f"{sg}.usr.istruzione.calabria.it",
         f"{p}.istruzioneliguria.it", f"{p}.toscana.istruzione.it", f"{p}.campania.istruzione.it", f"{p}.puglia.istruzione.it",
         f"www.ust{p}.it", f"ust{p}.it", f"www.usp{p}.it", f"usp{p}.it", f"www.atp{p}.it", f"atp{p}.it", f"www.csa{p}.it",
         f"www.ufficioscolastico{p}.it", f"www.ufficioscolasticoprovinciale.{p}.it", f"www.ust.{p}.it", f"www.istruzione{p}.it",
         f"{p}.istruzione.it", f"www.uspu{p}.it", f"www.usr{sg}.it", f"www.usp-{p}.it", f"www.ust-{p}.it", f"{sg}.istruzione.it",
         f"www.atp{sg}.it", f"www.ust{sg}.it", f"www.usp{sg}.it"]
    c += [f"www.mim.gov.it/web/{p}/interpelli-ricerca-supplenti", f"www.mim.gov.it/web/{p}/interpelli", f"www.mim.gov.it/web/{p}",
          f"www.mim.gov.it/web/{sg}/interpelli-ricerca-supplenti"]
    return c


def prova(args):
    prov, host = args
    for sch in ("https://",):
        try:
            r = requests.get(sch + host + "/", timeout=8, headers={"User-Agent": S.UA}, allow_redirects=True)
        except requests.RequestException:
            continue
        if r.status_code != 200 or len(r.text) < 1500:
            continue
        t = r.text.lower()
        if slug(prov)[:6] in slug(t[:60000]) and re.search(r"ufficio scolastico|ambito territoriale|ust |atp |usp |provveditorato|interpell|ricerca supplenti", t):
            return {"nome": f"Ufficio scolastico {prov}", "provincia": prov, "regione": S.PROVINCE[prov][1], "url": r.url}
    return None


def sonda_lombardia() -> None:
    for p in ("bergamo", "milano", "brescia", "como", "varese", "pavia"):
        for h in (f"{p}.istruzione.lombardia.gov.it", f"{p}.usr.istruzione.lombardia.gov.it", f"www.istruzione.lombardia.gov.it/{p}",
                  f"usr.istruzione.lombardia.gov.it", f"www.ust{p}.it", f"ust{p}.it", f"{p}.istruzionelombardia.it", f"www.istruzione{p}.it",
                  f"www.lombardia.istruzione.it/{p}", f"istruzione.lombardia.gov.it/{p}", f"{p}.lombardia.istruzione.it"):
            try:
                r = requests.get("https://" + h + "/", timeout=8, headers={"User-Agent": S.UA})
                print("SONDA", h, r.status_code, r.url, len(r.text), re.findall(r"<title>(.*?)</title>", r.text[:5000], re.S)[:1])
            except requests.RequestException as e:
                print("SONDA", h, type(e).__name__)


def main() -> int:
    lavori = [(p, h) for p, (sg, rg) in S.PROVINCE.items() for h in candidati(p, sg, rg)]
    trovati: dict[str, dict] = {}
    with ThreadPoolExecutor(48) as ex:
        for r in ex.map(prova, lavori):
            if r:
                trovati.setdefault(r["url"], r)
    out = sorted(trovati.values(), key=lambda x: (x["regione"], x["provincia"]))
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=0) + "\n", "utf-8")
    coperte = {o["provincia"] for o in out}
    print(f"uffici trovati: {len(out)} · province coperte: {len(coperte)}/{len(S.PROVINCE)}")
    print("senza ufficio:", ", ".join(sorted(set(S.PROVINCE) - coperte)))
    for o in out:
        print(" ", o["provincia"], o["url"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
