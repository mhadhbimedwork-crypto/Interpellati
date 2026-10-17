"""Coordinate per la mappa.

Fonte degli indirizzi: anagrafica ufficiale delle scuole del Ministero (open data, dati.istruzione.it).
Dall'indirizzo ricavo le coordinate con Nominatim/OpenStreetMap (max 1 richiesta al secondo, User-Agent
identificabile, ogni risultato salvato per sempre in data/geo.json: ogni scuola si cerca una volta sola).

Tre livelli di precisione, dichiarati su ogni avviso (campo "geo"):
  i = indirizzo della scuola (strada/numero civico)
  c = centro del comune della scuola
  p = capoluogo della provincia (l'avviso non dice quale scuola)

Controllo di coerenza: un indirizzo trovato a piu' di 35 km dal centro del suo comune viene scartato
(evita omonimie, es. "Via Roma" in un altro comune) e si ripiega sul comune.
"""
from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "geo.json"
UA = "InterpellatiBot/1.0 (+https://github.com/mhadhbimedwork-crypto/Interpellati; uso personale)"
BASE = "https://dati.istruzione.it/opendata/opendata/catalogo/elements1/"
ANAG = ["SCUANAGRAFESTAT", "SCUANAAUTSTAT", "SCUANAGRAFEPAR", "SCUANAAUTPAR"]
ANNI = ["20262720260901", "20252620250901"]
NOMINATIM = "https://nominatim.openstreetmap.org/search"
PAUSA = 1.1
MAX_KM_COMUNE = 35.0
ITALIA = (35.3, 47.2, 6.5, 18.8)  # lat min, lat max, lon min, lon max

# sigla -> capoluogo (livello "p")
CAPOLUOGHI = {
    "AG": "Agrigento", "AL": "Alessandria", "AN": "Ancona", "AO": "Aosta", "AP": "Ascoli Piceno", "AQ": "L'Aquila",
    "AR": "Arezzo", "AT": "Asti", "AV": "Avellino", "BA": "Bari", "BG": "Bergamo", "BI": "Biella", "BL": "Belluno",
    "BN": "Benevento", "BO": "Bologna", "BR": "Brindisi", "BS": "Brescia", "BT": "Andria", "BZ": "Bolzano",
    "CA": "Cagliari", "CB": "Campobasso", "CE": "Caserta", "CH": "Chieti", "CL": "Caltanissetta", "CN": "Cuneo",
    "CO": "Como", "CR": "Cremona", "CS": "Cosenza", "CT": "Catania", "CZ": "Catanzaro", "EN": "Enna", "FC": "Forlì",
    "FE": "Ferrara", "FG": "Foggia", "FI": "Firenze", "FM": "Fermo", "FR": "Frosinone", "GE": "Genova", "GO": "Gorizia",
    "GR": "Grosseto", "IM": "Imperia", "IS": "Isernia", "KR": "Crotone", "LC": "Lecco", "LE": "Lecce", "LI": "Livorno",
    "LO": "Lodi", "LT": "Latina", "LU": "Lucca", "MB": "Monza", "MC": "Macerata", "ME": "Messina", "MI": "Milano",
    "MN": "Mantova", "MO": "Modena", "MS": "Massa", "MT": "Matera", "NA": "Napoli", "NO": "Novara", "NU": "Nuoro",
    "OR": "Oristano", "PA": "Palermo", "PC": "Piacenza", "PD": "Padova", "PE": "Pescara", "PG": "Perugia",
    "PI": "Pisa", "PN": "Pordenone", "PO": "Prato", "PR": "Parma", "PT": "Pistoia", "PU": "Pesaro", "PV": "Pavia",
    "PZ": "Potenza", "RA": "Ravenna", "RC": "Reggio Calabria", "RE": "Reggio Emilia", "RG": "Ragusa", "RI": "Rieti",
    "RM": "Roma", "RN": "Rimini", "RO": "Rovigo", "SA": "Salerno", "SI": "Siena", "SO": "Sondrio", "SP": "La Spezia",
    "SR": "Siracusa", "SS": "Sassari", "SU": "Carbonia", "SV": "Savona", "TA": "Taranto", "TE": "Teramo", "TN": "Trento",
    "TO": "Torino", "TP": "Trapani", "TR": "Terni", "TS": "Trieste", "TV": "Treviso", "UD": "Udine", "VA": "Varese",
    "VB": "Verbania", "VC": "Vercelli", "VE": "Venezia", "VI": "Vicenza", "VR": "Verona", "VT": "Viterbo", "VV": "Vibo Valentia",
}


def km(a, b) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def in_italia(lat, lon) -> bool:
    return ITALIA[0] <= lat <= ITALIA[1] and ITALIA[2] <= lon <= ITALIA[3]


def carica() -> dict:
    if CACHE.exists():
        try:
            c = json.loads(CACHE.read_text("utf-8"))
        except ValueError:
            c = {}
    else:
        c = {}
    for k in ("scuole", "comuni", "province"):
        c.setdefault(k, {})
    c.setdefault("falliti", {})
    return c


def salva(c: dict):
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(c, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n", "utf-8")


# ---------------------------------------------------------------- anagrafica ufficiale
def scarica_anagrafica(codici: set[str]) -> dict[str, dict]:
    """Restituisce {codice: {nome, indirizzo, cap, comune, provincia}} solo per i codici richiesti."""
    out: dict[str, dict] = {}
    istituti: dict[str, dict] = {}
    s = requests.Session()
    s.headers["User-Agent"] = UA
    for nome in ANAG:
        testo = None
        for anno in ANNI:
            try:
                r = s.get(f"{BASE}{nome}{anno}.csv", timeout=180)
            except requests.RequestException as e:
                print(f"  anagrafica {nome}{anno}: {e}")
                continue
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
            cod = (row.get("CODICESCUOLA") or "").strip().upper()
            riga = {
                "nome": (row.get("DENOMINAZIONESCUOLA") or "").strip(),
                "indirizzo": (row.get("INDIRIZZOSCUOLA") or "").strip(),
                "cap": (row.get("CAPSCUOLA") or "").strip(),
                "comune": (row.get("DESCRIZIONECOMUNE") or "").strip(),
                "provincia": (row.get("PROVINCIA") or "").strip(),
            }
            if cod in codici:
                out[cod] = riga
            ref = (row.get("CODICEISTITUTORIFERIMENTO") or "").strip().upper()
            if ref in codici and ref not in out and (ref not in istituti or row.get("INDICAZIONESEDEDIRETTIVO") == "SI"):
                istituti[ref] = riga  # sede diversa dall'istituto: meglio di niente
    for k, v in istituti.items():
        out.setdefault(k, v)
    return out


# ---------------------------------------------------------------- Nominatim
_ultimo = [0.0]


def nom(**params):
    """Una ricerca Nominatim (rispetta 1 richiesta/secondo). Ritorna il primo risultato o None."""
    attesa = PAUSA - (time.time() - _ultimo[0])
    if attesa > 0:
        time.sleep(attesa)
    q = {"format": "jsonv2", "limit": 1, "countrycodes": "it", "addressdetails": 1, **params}
    for tentativo in range(3):
        try:
            r = requests.get(NOMINATIM, params=q, headers={"User-Agent": UA, "Accept-Language": "it"}, timeout=30)
            _ultimo[0] = time.time()
            if r.status_code == 200:
                j = r.json()
                return j[0] if j else None
            if r.status_code in (429, 503):
                time.sleep(20 * (tentativo + 1))
                continue
            return None
        except (requests.RequestException, ValueError):
            time.sleep(5)
    return None


def pulisci_via(v: str) -> str:
    v = re.sub(r"\s+", " ", v.replace(".", ". ").replace(",", " ")).strip()
    v = re.sub(r"\b(N|N°|NR|N\.)\s*(?=\d)", "", v, flags=re.I)
    v = re.sub(r"\bS\.\s*S\.\s*(\d+)", r"SS \1", v)
    return re.sub(r"\s+", " ", v).strip(" ,.-")


def nome_comune(v: str) -> str:
    return re.split(r"\s*[*/]\s*", v)[0].strip()


def coord(r):
    try:
        return float(r["lat"]), float(r["lon"])
    except (TypeError, KeyError, ValueError):
        return None


def preciso(r) -> bool:
    """Il risultato e' una strada/edificio (non solo una localita')?"""
    a = r.get("address") or {}
    return bool(a.get("road") or a.get("house_number") or a.get("amenity") or a.get("building")
                or r.get("category") in ("highway", "building", "amenity", "office", "shop"))


def centro_comune(c: dict, comune: str, provincia: str):
    chiave = f"{comune.upper()}|{provincia.upper()}"
    if chiave in c["comuni"]:
        v = c["comuni"][chiave]
        return (v["lat"], v["lon"]) if v else None
    r = nom(q=f"{comune}, provincia di {provincia}, Italia") or nom(q=f"{comune}, Italia")
    p = coord(r) if r else None
    if p and not in_italia(*p):
        p = None
    c["comuni"][chiave] = {"lat": round(p[0], 5), "lon": round(p[1], 5)} if p else None
    return p


def localizza(c: dict, cod: str, riga: dict) -> dict | None:
    comune = nome_comune(riga["comune"])
    centro = centro_comune(c, comune, riga["provincia"]) if comune else None
    via = pulisci_via(riga["indirizzo"])
    trovato = None
    if via and comune:
        tentativi = [
            dict(street=via, city=comune, postalcode=riga["cap"]),
            dict(street=via, city=comune),
            dict(q=f"{via}, {comune}, {riga['provincia']}, Italia"),
        ]
        # tolgo il civico per l'ultimo tentativo: la via giusta vale piu' del numero sbagliato
        senza_civico = re.sub(r"\s*\d+[\w/-]*\s*$", "", via).strip()
        if senza_civico and senza_civico != via:
            tentativi.append(dict(street=senza_civico, city=comune))
        for t in tentativi:
            r = nom(**t)
            p = coord(r) if r else None
            if not p or not in_italia(*p) or not preciso(r):
                continue
            if centro and km(p, centro) > MAX_KM_COMUNE:
                continue
            trovato = p
            break
    if trovato:
        return {"lat": round(trovato[0], 5), "lon": round(trovato[1], 5), "g": "i", "via": riga["indirizzo"], "comune": comune, "nome": riga["nome"]}
    if centro:
        return {"lat": round(centro[0], 5), "lon": round(centro[1], 5), "g": "c", "via": riga["indirizzo"], "comune": comune, "nome": riga["nome"]}
    return None


def centro_provincia(c: dict, sigla: str):
    if sigla in c["province"]:
        return c["province"][sigla]
    nome = CAPOLUOGHI.get(sigla)
    if not nome:
        return None
    r = nom(q=f"{nome}, Italia")
    p = coord(r) if r else None
    if p and in_italia(*p):
        c["province"][sigla] = {"lat": round(p[0], 5), "lon": round(p[1], 5)}
        return c["province"][sigla]
    return None


# ---------------------------------------------------------------- applicazione agli avvisi
def applica(items: list[dict], c: dict | None = None) -> int:
    """Aggiunge lat/lon/geo (e via/comune) agli avvisi usando solo la cache (nessuna rete)."""
    c = c or carica()
    n = 0
    for it in items:
        cod = (it.get("codiceScuola") or "").upper()
        g = c["scuole"].get(cod) if cod else None
        if g:
            it["lat"], it["lon"], it["geo"] = g["lat"], g["lon"], g["g"]
            if g.get("via"):
                it["indirizzo"] = f"{g['via']}, {g['comune']}".strip(", ")
            if g.get("comune"):
                it["comune"] = g["comune"]
            n += 1
            continue
        p = c["province"].get((it.get("provincia") or "").upper())
        if p:
            it["lat"], it["lon"], it["geo"] = p["lat"], p["lon"], "p"
            for k in ("indirizzo", "comune"):
                it.pop(k, None)
            n += 1
        else:
            for k in ("lat", "lon", "geo"):
                it.pop(k, None)
    return n


def main() -> int:
    budget = int(os.environ.get("GEO_BUDGET", "400"))
    c = carica()
    dati = json.loads((ROOT / "data" / "interpelli.json").read_text("utf-8"))
    items = dati["interpelli"]
    ora = time.strftime("%Y-%m-%d")

    mancano = {(i.get("codiceScuola") or "").upper() for i in items if i.get("codiceScuola")}
    mancano = {x for x in mancano if x and x not in c["scuole"] and c["falliti"].get(x, "") < ora}
    print(f"[geo] codici da localizzare: {len(mancano)} (budget {budget} scuole)")
    if mancano:
        anag = scarica_anagrafica(mancano)
        print(f"[geo] trovati in anagrafica: {len(anag)} / {len(mancano)}")
        fatti = 0
        for cod in sorted(mancano):
            if fatti >= budget:
                break
            riga = anag.get(cod)
            if not riga:
                c["falliti"][cod] = ora
                continue
            g = localizza(c, cod, riga)
            if g:
                c["scuole"][cod] = g
            else:
                c["falliti"][cod] = ora
            fatti += 1
            if fatti % 25 == 0:
                salva(c)
                print(f"  ... {fatti} scuole")
    for sigla in sorted({(i.get("provincia") or "").upper() for i in items if i.get("provincia")}):
        centro_provincia(c, sigla)
    salva(c)

    n = applica(items, c)
    dati["interpelli"] = items
    (ROOT / "data" / "interpelli.json").write_text(json.dumps(dati, ensure_ascii=False, indent=1) + "\n", "utf-8")
    feed_p = ROOT / "data" / "feed.json"
    if feed_p.exists():
        feed = json.loads(feed_p.read_text("utf-8"))
        applica(feed["interpelli"], c)
        feed_p.write_text(json.dumps(feed, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")
    livelli = {"i": 0, "c": 0, "p": 0}
    for i in items:
        if i.get("geo") in livelli:
            livelli[i["geo"]] += 1
    print(f"[geo] avvisi con coordinate: {n}/{len(items)} · indirizzo {livelli['i']} · comune {livelli['c']} · provincia {livelli['p']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
