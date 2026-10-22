#!/usr/bin/env python3
"""Recupero dei siti scolastici non raggiungibili o 'non ancora pubblicati' dal dominio della mail istituzionale.
Molte scuole usano per la posta lo stesso dominio del sito (segreteria@icxxx.edu.it -> www.icxxx.edu.it). Per le scuole in errore
si prova quel dominio (https/http, con e senza www): se risponde 200 con una pagina davvero scolastica (non il segnaposto
'A breve on line'), l'indirizzo entra nei siti corretti dell'area. Dati pubblici dell'anagrafica MIM; bot dichiarato."""
from __future__ import annotations
import csv, io, json, re, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import geo  # noqa: E402
import diagnosi_siti as DS  # noqa: E402
import scuole_italia as SI  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "data" / "scuole"
GENERICI = ("istruzione.it", "pec.istruzione.it", "gmail.", "libero.", "yahoo.", "hotmail.", "outlook.", "pec.it", "legalmail", "tiscali", "virgilio", "alice.", "tin.it", "scuola.alto-adige.it", "regione.", "provincia.")


def area_di(cod: str) -> str | None:
    for a, (_, sigle) in SI.AREE.items():
        if cod[:2] in sigle.split():
            return a
    return "sicilia" if cod[:2] in ("AG", "CL", "CT", "EN", "ME", "PA", "RG", "SR", "TP") else None


def main() -> int:
    s = requests.Session()
    s.headers["User-Agent"] = DS.UA
    mail = {}
    for nome in geo.ANAG[:2]:
        testo = None
        for anno in geo.ANNI:
            r = s.get(f"{geo.BASE}{nome}{anno}.csv", timeout=180)
            if r.status_code == 200 and len(r.content) > 5000:
                for enc in ("utf-8-sig", "latin-1"):
                    try:
                        testo = r.content.decode(enc)
                        break
                    except UnicodeDecodeError:
                        pass
                break
        if not testo:
            continue
        for row in csv.DictReader(io.StringIO(testo)):
            rif = (row.get("CODICEISTITUTORIFERIMENTO") or row.get("CODICESCUOLA") or "").strip().upper()
            em = (row.get("INDIRIZZOEMAILSCUOLA") or "").strip().lower()
            if rif and "@" in em and rif not in mail:
                dom = em.split("@")[1]
                if not any(g in dom for g in GENERICI):
                    mail[rif] = dom
    print("scuole con dominio email proprio:", len(mail))
    # scuole non lette
    letta, sito_att = {}, {}
    for fp in sorted(D.glob("*_report.json")) + [ROOT / "data" / "sicilia_report.json"]:
        if "priorita" in fp.name:
            continue
        try:
            for c, v in json.loads(fp.read_text("utf-8")).get("scuole", {}).items():
                letta[c] = letta.get(c, False) or bool(v.get("ok"))
                sito_att[c] = v.get("sito") or sito_att.get(c)
        except (OSError, ValueError):
            pass
    da_provare = [(c, mail[c]) for c, ok in letta.items() if not ok and c in mail]
    print("scuole in errore con dominio email:", len(da_provare))

    def prova(item):
        c, dom = item
        base = dom[4:] if dom.startswith("www.") else dom
        attuale = urlparse(sito_att.get(c) or "").netloc.lower().removeprefix("www.")
        if base == attuale:
            return c, None  # stesso dominio gia' provato
        for u in (f"https://www.{base}/", f"https://{base}/", f"http://www.{base}/"):
            ok, esito = DS.prova(s, u)
            if ok:
                m = re.match(r"(https?://[^/]+)", esito)
                return c, (m.group(1).lower() + "/") if m else u
        return c, None
    with ThreadPoolExecutor(24) as ex:
        ris = [r for r in ex.map(prova, da_provare) if r[1]]
    print("siti recuperati dal dominio email:", len(ris))
    per_area: dict[str, dict] = {}
    for c, u in ris:
        a = area_di(c)
        if a:
            per_area.setdefault(a, {})[c] = u
    for a, nuovi in per_area.items():
        fp = ROOT / "data" / "sicilia_siti_corretti.json" if a == "sicilia" else D / f"{a}_corretti.json"
        try:
            fix = json.loads(fp.read_text("utf-8"))
        except (OSError, ValueError):
            fix = {}
        fix.update(nuovi)
        fp.write_text(json.dumps(fix, ensure_ascii=False, indent=1, sort_keys=True) + "\n", "utf-8")
        print(a, len(nuovi))
    return 0


if __name__ == "__main__":
    sys.exit(main())
