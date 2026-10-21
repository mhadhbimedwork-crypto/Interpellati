#!/usr/bin/env python3
"""Interpellati - scraper interpelli (tutte le classi di concorso, tutta Italia).

Gira su GitHub Actions ogni 2 ore. Legge le pagine pubbliche degli uffici
scolastici (USP/UST/USR) e gli elenchi giornalieri di scuolainterpelli.it,
raccoglie gli avvisi di qualsiasi classe di concorso e aggiorna data/interpelli.json,
che l'app Android legge.

Regole: rispetta robots.txt, 1 richiesta al secondo per host, non inventa
dati (se un campo non c'e' resta vuoto).
"""
from __future__ import annotations

import hashlib
import random
import json
import re
import sys
import time
import urllib.robotparser
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import io
import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

import extract as ex
import geo
import llm

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "interpelli.json"
SOURCES = Path(__file__).resolve().parent / "sources.json"
UA = "InterpellatiBot/1.0 (+https://github.com/mhadhbimedwork-crypto/Interpellati)"
TZ = timezone(timedelta(hours=2))  # Europe/Rome (ora legale); per le date basta
KEEP_DAYS = 60
MAX_DETTAGLI = 250
LLM_BUDGET = [int(__import__('os').environ.get('MAX_LLM', '15'))]  # chiamate al modello per esecuzione  # avvisi analizzati per esecuzione (rispetta 1 richiesta/s per host)
MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio",
        "agosto", "settembre", "ottobre", "novembre", "dicembre"]

# Qualsiasi classe di concorso: A001-A090, B003-B032, lingue (AA24, AB25, AM56...),
# sostegno e posti comuni (ADEE, ADMM, ADSS, ADAA, EEEE, AAAA). Maiuscole obbligatorie
# per non scambiare parole normali per classi.
CODE_RE = re.compile(
    r"(?<![A-Za-z0-9])("
    r"A[-\s]?0?\d{2}|B[-\s]?0?\d{2}|A[A-Z]\d{2}|B[A-Z]\d{2}|A[MS]\d[A-Z]|ADEE|ADMM|ADSS|ADAA|ADSC|EEEE|AAAA|PPPP"
    r")(?![A-Za-z0-9])"
)
# Profili ATA (collaboratore scolastico, assistente amministrativo/tecnico, ecc.)
ATA_RE = {
    "CS": re.compile(r"collaborator\w*\s+scolastic", re.I),
    "AA": re.compile(r"assistent\w*\s+amministrativ", re.I),
    "AT": re.compile(r"assistent\w*\s+tecnic", re.I),
    "CUOCO": re.compile(r"\bcuoc[oh]\w*\b", re.I),
    "GUARDAROBIERE": re.compile(r"guardarobier", re.I),
    "INFERMIERE": re.compile(r"infermier", re.I),
}
# Nomi estesi usati da alcuni uffici al posto del codice
NOMI = {
    "B015": re.compile(r"laborator\w*\s+di\s+scienze\s+e\s+tecnologie\s+elettriche", re.I),
    "B017": re.compile(r"laborator\w*\s+di\s+scienze\s+e\s+tecnologie\s+meccaniche", re.I),
}
INTERPELLO_RE = re.compile(r"interpell|supplenz|disponibilit", re.I)

# provincia -> (sigla, regione)
PROVINCE = {
    "Agrigento": ("AG", "Sicilia"), "Alessandria": ("AL", "Piemonte"), "Ancona": ("AN", "Marche"),
    "Aosta": ("AO", "Valle d'Aosta"), "Arezzo": ("AR", "Toscana"), "Ascoli Piceno": ("AP", "Marche"),
    "Asti": ("AT", "Piemonte"), "Avellino": ("AV", "Campania"), "Bari": ("BA", "Puglia"),
    "Barletta-Andria-Trani": ("BT", "Puglia"), "Belluno": ("BL", "Veneto"), "Benevento": ("BN", "Campania"),
    "Bergamo": ("BG", "Lombardia"), "Biella": ("BI", "Piemonte"), "Bologna": ("BO", "Emilia-Romagna"),
    "Bolzano": ("BZ", "Trentino-Alto Adige"), "Brescia": ("BS", "Lombardia"), "Brindisi": ("BR", "Puglia"),
    "Cagliari": ("CA", "Sardegna"), "Caltanissetta": ("CL", "Sicilia"), "Campobasso": ("CB", "Molise"),
    "Caserta": ("CE", "Campania"), "Catania": ("CT", "Sicilia"), "Catanzaro": ("CZ", "Calabria"),
    "Chieti": ("CH", "Abruzzo"), "Como": ("CO", "Lombardia"), "Cosenza": ("CS", "Calabria"),
    "Cremona": ("CR", "Lombardia"), "Crotone": ("KR", "Calabria"), "Cuneo": ("CN", "Piemonte"),
    "Enna": ("EN", "Sicilia"), "Fermo": ("FM", "Marche"), "Ferrara": ("FE", "Emilia-Romagna"),
    "Firenze": ("FI", "Toscana"), "Foggia": ("FG", "Puglia"), "Forlì-Cesena": ("FC", "Emilia-Romagna"),
    "Frosinone": ("FR", "Lazio"), "Genova": ("GE", "Liguria"), "Gorizia": ("GO", "Friuli Venezia Giulia"),
    "Grosseto": ("GR", "Toscana"), "Imperia": ("IM", "Liguria"), "Isernia": ("IS", "Molise"),
    "L'Aquila": ("AQ", "Abruzzo"), "La Spezia": ("SP", "Liguria"), "Latina": ("LT", "Lazio"),
    "Lecce": ("LE", "Puglia"), "Lecco": ("LC", "Lombardia"), "Livorno": ("LI", "Toscana"),
    "Lodi": ("LO", "Lombardia"), "Lucca": ("LU", "Toscana"), "Macerata": ("MC", "Marche"),
    "Mantova": ("MN", "Lombardia"), "Massa-Carrara": ("MS", "Toscana"), "Matera": ("MT", "Basilicata"),
    "Messina": ("ME", "Sicilia"), "Milano": ("MI", "Lombardia"), "Modena": ("MO", "Emilia-Romagna"),
    "Monza e Brianza": ("MB", "Lombardia"), "Napoli": ("NA", "Campania"), "Novara": ("NO", "Piemonte"),
    "Nuoro": ("NU", "Sardegna"), "Oristano": ("OR", "Sardegna"), "Padova": ("PD", "Veneto"),
    "Palermo": ("PA", "Sicilia"), "Parma": ("PR", "Emilia-Romagna"), "Pavia": ("PV", "Lombardia"),
    "Perugia": ("PG", "Umbria"), "Pesaro e Urbino": ("PU", "Marche"), "Pescara": ("PE", "Abruzzo"),
    "Piacenza": ("PC", "Emilia-Romagna"), "Pisa": ("PI", "Toscana"), "Pistoia": ("PT", "Toscana"),
    "Pordenone": ("PN", "Friuli Venezia Giulia"), "Potenza": ("PZ", "Basilicata"), "Prato": ("PO", "Toscana"),
    "Ragusa": ("RG", "Sicilia"), "Ravenna": ("RA", "Emilia-Romagna"), "Reggio Calabria": ("RC", "Calabria"),
    "Reggio Emilia": ("RE", "Emilia-Romagna"), "Rieti": ("RI", "Lazio"), "Rimini": ("RN", "Emilia-Romagna"),
    "Roma": ("RM", "Lazio"), "Rovigo": ("RO", "Veneto"), "Salerno": ("SA", "Campania"),
    "Sassari": ("SS", "Sardegna"), "Savona": ("SV", "Liguria"), "Siena": ("SI", "Toscana"),
    "Siracusa": ("SR", "Sicilia"), "Sondrio": ("SO", "Lombardia"), "Sud Sardegna": ("SU", "Sardegna"),
    "Taranto": ("TA", "Puglia"), "Teramo": ("TE", "Abruzzo"), "Terni": ("TR", "Umbria"),
    "Torino": ("TO", "Piemonte"), "Trapani": ("TP", "Sicilia"), "Trento": ("TN", "Trentino-Alto Adige"),
    "Treviso": ("TV", "Veneto"), "Trieste": ("TS", "Friuli Venezia Giulia"), "Udine": ("UD", "Friuli Venezia Giulia"),
    "Varese": ("VA", "Lombardia"), "Venezia": ("VE", "Veneto"), "Verbano-Cusio-Ossola": ("VB", "Piemonte"),
    "Vercelli": ("VC", "Piemonte"), "Verona": ("VR", "Veneto"), "Vibo Valentia": ("VV", "Calabria"),
    "Vicenza": ("VI", "Veneto"), "Viterbo": ("VT", "Lazio"),
}
ALIAS = {"verbania": "Verbano-Cusio-Ossola", "vco": "Verbano-Cusio-Ossola", "forli": "Forlì-Cesena",
         "forlì": "Forlì-Cesena", "pesaro": "Pesaro e Urbino", "monza": "Monza e Brianza",
         "massa": "Massa-Carrara", "bat": "Barletta-Andria-Trani", "reggio emilia": "Reggio Emilia",
         "reggio calabria": "Reggio Calabria", "aquila": "L'Aquila"}
SIGLA = {v[0]: k for k, v in PROVINCE.items()}


REPORT: list[str] = []


def log(*a):
    line = " ".join(str(x) for x in a)
    REPORT.append(line)
    print(line, flush=True)


class Fetcher:
    def __init__(self):
        self.s = requests.Session()
        self.s.headers["User-Agent"] = UA
        self.s.headers["Accept-Language"] = "it-IT,it;q=0.9"
        self.robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self.last: dict[str, float] = {}
        self.pages = 0
        self.errs: dict[str, str] = {}

    def allowed(self, url: str) -> bool:
        host = urlparse(url).scheme + "://" + urlparse(url).netloc
        if host not in self.robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                r = self.s.get(host + "/robots.txt", timeout=15)
                if r.status_code == 200:
                    rp.parse(r.text.splitlines())
                    self.robots[host] = rp
                else:
                    self.robots[host] = None
            except requests.RequestException:
                self.robots[host] = None
        rp = self.robots[host]
        return True if rp is None else rp.can_fetch(UA, url)

    def get(self, url: str) -> str | None:
        if not self.allowed(url):
            log("  robots.txt non consente:", url)
            return None
        host = urlparse(url).netloc
        wait = random.uniform(1.0, 2.2) - (time.time() - self.last.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        try:
            r = self.s.get(url, timeout=25)
            self.last[host] = time.time()
            if r.status_code != 200:
                self.errs[url] = f"HTTP {r.status_code}"
                log(f"  HTTP {r.status_code}: {url}")
                return None
            r.encoding = r.apparent_encoding or r.encoding
            self.pages += 1
            return r.text
        except requests.RequestException as e:
            self.errs[url] = type(e).__name__
            log("  errore:", url, type(e).__name__)
            return None


def find_province(text: str) -> str | None:
    low = text.lower()
    best = None
    for name in sorted(PROVINCE, key=len, reverse=True):
        if re.search(r"\b" + re.escape(name.lower()) + r"\b", low):
            best = name
            break
    if not best:
        for a, name in ALIAS.items():
            if re.search(r"\b" + re.escape(a) + r"\b", low):
                best = name
                break
    return best


def norm_code(c: str) -> str:
    c = re.sub(r"[-\s]", "", c).upper()
    m = re.fullmatch(r"([AB])(\d{2})", c)  # A26 -> A026
    return f"{m[1]}0{m[2]}" if m else c


def classes_in(text: str, ata: bool = False) -> list[str]:
    """Tutte le classi di concorso citate (codici e nomi estesi). Con ata=True
    riconosce anche i profili ATA."""
    out: list[str] = []
    for m in CODE_RE.finditer(text):
        c = norm_code(m[1])
        if c not in out:
            out.append(c)
    for c, rx in NOMI.items():
        if c not in out and rx.search(text):
            out.append(c)
    if ata:
        for c, rx in ATA_RE.items():
            if c not in out and rx.search(text):
                out.append(c)
    return out


RANGE_RE = re.compile(r"(fino[\s_-]+al|al|entro[\s_-]+il|entro|scadenza|termine|dal)[\s_-]+(il[\s_-]+)?\d{1,2}[./-]\d{1,2}[./-]\d{2,4}", re.I)


DATE_PATTERNS = [
    re.compile(r"/(20\d\d)/(\d{1,2})/(\d{1,2})/"),
    re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](20\d\d)\b"),
    re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d\d)\b"),
]


def find_date(s: str) -> date | None:
    """Data di pubblicazione: prima quella nell'URL, poi una data nel testo che
    non sia un termine (fino al / entro / scadenza) e non sia nel futuro."""
    m = DATE_PATTERNS[0].search(s)
    if m:
        try:
            return date(int(m[1]), int(m[2]), int(m[3]))
        except ValueError:
            pass
    s = RANGE_RE.sub(" ", s)
    limit = date.today() + timedelta(days=1)
    for rx in DATE_PATTERNS[1:]:
        for m in rx.finditer(s):
            y = int(m[3])
            y = y + 2000 if y < 100 else y
            try:
                d = date(y, int(m[2]), int(m[1]))
            except ValueError:
                continue
            if d <= limit:
                return d
    m = re.search(r"\b(\d{1,2})\s+(" + "|".join(MESI) + r")\s+(20\d\d)\b", s, re.I)
    if m:
        return date(int(m[3]), MESI.index(m[2].lower()) + 1, int(m[1]))
    return None


def find_deadline(text: str) -> tuple[str | None, str | None]:
    """Cerca 'entro le ore 12:00 del 20/10/2026' e simili."""
    m = re.search(r"entro[^.\n]{0,60}?(\d{1,2})[./-](\d{1,2})[./-](20\d\d)", text, re.I)
    if not m:
        return None, None
    try:
        d = date(int(m[3]), int(m[2]), int(m[1])).isoformat()
    except ValueError:
        return None, None
    h = re.search(r"ore\s*(\d{1,2})[:.](\d{2})", m[0], re.I)
    return d, (f"{int(h[1]):02d}:{h[2]}" if h else None)


def slug(s: str, n: int = 24) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:n].strip("-") or "x"


def make_id(prov: str | None, classe: str, title: str, pub: str, link: str) -> str:
    sig = (PROVINCE.get(prov, ("xx",))[0] if prov else "xx").lower()
    h = hashlib.sha1((link + classe).encode()).hexdigest()[:6]
    return f"{sig}-{classe.lower()}-{slug(title, 18)}-{pub.replace('-', '')}-{h}"


def block_of(a) -> str:
    node = a
    for _ in range(4):
        if node.parent is None:
            break
        node = node.parent
        if node.name in ("li", "tr", "p", "article", "h2", "h3", "h4"):
            break
    return " ".join(node.get_text(" ", strip=True).split())


# ---------------------------------------------------------------- sorgenti

def scan_aggregator_day(f: Fetcher, d: date) -> list[dict]:
    url = f"https://www.scuolainterpelli.it/interpelli-scuola-{d.day}-{MESI[d.month - 1]}-{d.year}/"
    html = f.get(url)
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    main = soup.find("article") or soup.find("main") or soup
    out = []
    for blk in main.find_all(["li", "tr", "p"]):
        text = " ".join(blk.get_text(" ", strip=True).split())
        cls = classes_in(text, True)
        if not cls:
            continue
        links = [urljoin(url, a["href"]) for a in blk.find_all("a", href=True)
                 if "scuolainterpelli.it" not in a["href"]]
        prov = find_province(text)
        if not prov:
            head = blk.find_previous(["h2", "h3", "h4", "h5", "strong", "b"])
            prov = find_province(head.get_text(" ", strip=True)) if head else None
        if not prov and links:
            prov = find_province(links[0].replace("_", " ").replace("/", " ").replace("-", " "))
        log(f"  [aggregatore {d}] {cls} {prov} :: {text[:140]} :: {links[:2]}")
        if not prov or not links:
            continue
        for c in cls:
            title = f"Interpello {c} – " + (f"ambito di {prov}" if prov not in ("Verbano-Cusio-Ossola",) else "ambito Verbano-Cusio-Ossola")
            out.append({
                "classi": [c], "scuola": title, "provincia": PROVINCE[prov][0], "regione": PROVINCE[prov][1],
                "pubblicato": d.isoformat(), "link": links[0],
                "fonte": f"UST {prov} (segnalato da scuolainterpelli.it)",
                "note": "Scuola, ore e scadenza sono nell'avviso ufficiale: apri il link e cerca " + c + ".",
                "_prov": prov,
            })
    return out


def scan_office(f: Fetcher, src: dict, since: date) -> list[dict]:
    html = f.get(src["url"])
    if not html:
        return []
    return scan_html(f, src, since, html)


def scan_html(f: Fetcher, src: dict, since: date, html: str, undated: bool = False) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    out = []
    seen = set()
    prov = src.get("provincia")
    for a in soup.find_all("a", href=True):
        txt = " ".join(a.get_text(" ", strip=True).split())
        href = urljoin(src["url"], a["href"])
        ctx = block_of(a)
        hay = txt + " " + href + " " + ctx
        cls = classes_in(txt + " " + href, True) or (classes_in(ctx, True) if len(ctx) < 300 else [])
        if not cls or not INTERPELLO_RE.search(hay):
            continue
        if href in seen:
            continue
        seen.add(href)
        d = find_date(href) or find_date(txt) or find_date(ctx)
        log(f"  [{src['nome']}] {cls} data={d} :: {txt[:120]} :: {href}")
        if d and (d < since or d > date.today() + timedelta(days=1)):
            continue
        if not d and not (undated and not href.lower().split("?")[0].endswith((".pdf", ".doc", ".docx"))):
            continue
        item = {
            "classi": cls, "scuola": (txt or ctx)[:140], "pubblicato": d.isoformat() if d else "", "link": href,
            "fonte": src["nome"], "_prov": prov or find_province(hay),
        }
        p = item["_prov"]
        if p:
            item["provincia"], item["regione"] = PROVINCE[p]
        out.append(item)
    return out



# ---------------------------------------------------------------- dettagli (ore, durata)

def doc_fetch(f: "Fetcher", url: str) -> tuple[str | None, bytes | None]:
    """Scarica una pagina HTML, un PDF, uno ZIP o un .p7m (in memoria, nulla resta su disco).
    Restituisce (testo, contenuto_binario_se_non_HTML)."""
    cache = f.__dict__.setdefault("doc_cache", {})
    if url in cache:
        return cache[url]
    cache[url] = _doc_fetch(f, url)
    return cache[url]


def _doc_fetch(f: "Fetcher", url: str) -> tuple[str | None, bytes | None]:
    if not f.allowed(url):
        return None, None
    host = urlparse(url).netloc
    wait = random.uniform(1.0, 2.2) - (time.time() - f.last.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    try:
        r = f.s.get(url, timeout=30)
        f.last[host] = time.time()
        if r.status_code != 200:
            return None, None
        f.pages += 1
        c = r.content
        ctype = r.headers.get("content-type", "")
        low = url.lower().split("?")[0]
        if "pdf" in ctype or low.endswith((".pdf", ".zip", ".p7m")) or c[:4] == b"%PDF" or c[:2] == b"PK":
            if len(c) > llm.MAX_BYTES * 2:
                return None, None
            pdfs = llm.pdfs_from(c, url)
            texts = []
            for p in pdfs:
                try:
                    rd = PdfReader(io.BytesIO(p))
                    texts.append(" ".join((pg.extract_text() or "") for pg in rd.pages[:8]))
                except Exception:
                    pass
            return " ".join(" ".join(texts).split()), c
        r.encoding = r.apparent_encoding or r.encoding
        soup = BeautifulSoup(r.text, "html.parser")
        body = soup.find("article") or soup.find("main") or soup
        return " ".join(body.get_text(" ", strip=True).split()), None
    except requests.RequestException:
        return None, None


def doc_text(f: "Fetcher", url: str) -> str | None:
    return doc_fetch(f, url)[0]


def class_rx(c: str):
    if re.match(r"[AB]\d{3}$", c):
        return re.compile(r"(?<![A-Za-z0-9])" + c[0] + r"[-\s]?0?" + c[1:] + r"(?![A-Za-z0-9])", re.I)
    return re.compile(re.escape(c), re.I)


def apply_detail(it: dict, d: dict):
    """Copia ore/durata trovate nell'item, con evidenza e categoria."""
    if "ore" in d:
        it["ore"] = d["ore"]
        it["oreEvidenza"] = d["oreEvidenza"][:200]
    if "durata" in d:
        it["durata"] = d["durata"]
        it["durataEvidenza"] = d["durataEvidenza"][:200]
        try:
            pub = date.fromisoformat(it["pubblicato"]) if it.get("pubblicato") else None
            cat = ex.categoria(d["durata"], pub)
            if cat:
                it["durataCat"] = cat
        except ValueError:
            pass


def dettaglia(f: "Fetcher", it: dict) -> list[dict]:
    """Legge l'avviso collegato. Restituisce gli item che lo sostituiscono: se la
    pagina e' un elenco, uno per ogni scuola; altrimenti l'item stesso arricchito."""
    it["letto"] = True
    text, raw = doc_fetch(f, it["link"]) if it.get("link") else (None, None)
    if raw is not None and len(text or "") < 200:
        # scansione senza testo, oppure ZIP/P7M: ripiego con modello multimodale (se configurato)
        posti = [p for p in llm.leggi(raw, it["link"], LLM_BUDGET) if p.get("classe_di_concorso") in set(it["classi"])]
        if len(posti) == 1:
            p = posti[0]
            it["lettoDa"] = "ai"
            if "ore_settimanali" in p:
                it["ore"] = p["ore_settimanali"]
            if p.get("scadenza"):
                it["scadenza"] = p["scadenza"][:10]
                if len(p["scadenza"]) > 10:
                    it["oraScadenza"] = p["scadenza"][11:]
            if p.get("tipo_posto"):
                it["tipoPosto"] = p["tipo_posto"]
            if p.get("link_candidatura"):
                it["candidatura"] = p["link_candidatura"]
            if p.get("istituto") and it.get("scuola", "").startswith("Interpello "):
                it["scuola"] = p["istituto"]
        return [it]
    if not text:
        return [it]
    prov = it.get("_prov") or SIGLA.get(it.get("provincia"))
    mie = set(it["classi"])
    rows = ex.righe(text, lambda seg: [c for c in classes_in(seg, True) if c in mie])
    if rows:
        out = []
        for r in rows:
            n = dict(it)
            n["classi"] = r["classi"]
            n["codiceScuola"] = r["mecc"]
            n["scuola"] = r["scuola"] or r["mecc"]
            firma = hashlib.sha1((it["link"] + r["mecc"] + r["testo"][:200]).encode()).hexdigest()[:8]
            n["id"] = f"{(PROVINCE.get(prov, ('xx',))[0] if prov else 'xx').lower()}-{n['classi'][0].lower()}-{slug(r['mecc'], 12)}-{firma}"
            n.pop("ore", None); n.pop("durata", None)
            apply_detail(n, r)
            n["letto"] = True
            out.append(n)
        return out
    d = ex.finestra(text, class_rx(it["classi"][0]))
    apply_detail(it, d)
    return [it]


def enrich(f: Fetcher, it: dict):
    """Apre la pagina dell'avviso per scadenza, ore, email (solo se presenti)."""
    if not it.get("link") or it["link"].lower().endswith(".pdf"):
        return
    html = f.get(it["link"])
    if not html:
        return
    soup = BeautifulSoup(html, "html.parser")
    body = soup.find("article") or soup.find("main") or soup
    text = " ".join(body.get_text(" ", strip=True).split())
    dl, hh = find_deadline(text)
    if dl:
        it["scadenza"] = dl
        if hh:
            it["oraScadenza"] = hh
    m = re.search(r"([a-z]{4}\d{5}[a-z0-9]@(?:pec\.)?istruzione\.it)", text, re.I)
    if m and re.search(r"invia|trasmett|indirizzo", text, re.I):
        it["email"] = m[1].lower()
    if not it.get("comune"):
        m = re.search(r"\b(?:I\.?I\.?S\.?S?|IIS|ITIS|ITI|IPSIA|ISIS|IS|ITT|ITTS|IPS|Istituto)[^,;:]{2,80}", text)
        if m and it["scuola"].startswith("Interpello "):
            pass  # l'aggregatore non dice la scuola: la lasciamo generica piuttosto che indovinarla


def copertura_scuole() -> dict:
    """Quante scuole statali leggiamo davvero, per regione: Sicilia + aree nazionali (data/scuole/*_report.json)."""
    reg_di = {v[0]: v[1] for v in PROVINCE.values()}
    per: dict[str, dict] = {}
    reports = [ROOT / "data" / "sicilia_report.json"] + sorted((ROOT / "data" / "scuole").glob("*_report.json"))
    elenchi = [ROOT / "data" / "sicilia_scuole.json"] + [p.with_name(p.name.replace("_report", "_elenco")) for p in reports[1:]]
    for rp, ep in zip(reports, elenchi):
        try:
            sc = json.loads(rp.read_text("utf-8")).get("scuole", {})
        except (OSError, ValueError):
            sc = {}
        try:
            el = json.loads(ep.read_text("utf-8")).get("scuole", {})
        except (OSError, ValueError):
            el = {}
        for cod in set(el) | set(sc):
            r = reg_di.get(cod[:2]) or "Altro"
            x = per.setdefault(r, {"istituti": 0, "conSito": 0, "letti": 0})
            x["istituti"] += 1
            if (el.get(cod) or {}).get("sito") or (sc.get(cod) or {}).get("sito"):
                x["conSito"] += 1
            if (sc.get(cod) or {}).get("ok"):
                x["letti"] += 1
    tot = {k: sum(v[k] for v in per.values()) for k in ("istituti", "conSito", "letti")}
    tot["percentuale"] = round(100 * tot["letti"] / tot["istituti"], 1) if tot["istituti"] else 0
    for v in per.values():
        v["percentuale"] = round(100 * v["letti"] / v["istituti"], 1) if v["istituti"] else 0
    return {**tot, "perRegione": dict(sorted(per.items())), "uffici": sum(1 for _ in json.loads(SOURCES.read_text("utf-8"))["uffici"])}


def put(items: dict, r: dict):
    """Inserisce l'avviso; se esiste gia' (stesso id) tiene la data di pubblicazione piu' antica."""
    new = {k: v for k, v in r.items() if v not in (None, "", [])}
    old = items.get(new["id"])
    if old and old.get("pubblicato") and new.get("pubblicato") and old["pubblicato"] < new["pubblicato"]:
        new["pubblicato"] = old["pubblicato"]
    if old and old.get("trovato"):
        new["trovato"] = old["trovato"]
    if old and old.get("oraPub") and not new.get("oraPub"):
        new["oraPub"] = old["oraPub"]
    items[new["id"]] = new


def main() -> int:
    store = json.loads(DATA.read_text("utf-8")) if DATA.exists() else {"interpelli": []}
    items = {i["id"]: i for i in store.get("interpelli", [])}
    known_links = {(i.get("link"), tuple(i.get("classi", [])), i.get("pubblicato")) for i in items.values()}
    sources = json.loads(SOURCES.read_text("utf-8"))
    f = Fetcher()
    today = datetime.now(TZ).date()
    since = today - timedelta(days=10)

    found: list[dict] = []
    for back in range(3):
        found += scan_aggregator_day(f, today - timedelta(days=back))
    for src in sources["uffici"]:
        found += scan_office(f, src, since)
    try:
        import sicilia
        sicilia.KNOWN = {i.get('link') for i in items.values()}
        found += sicilia.scansiona_sicilia(sys.modules[__name__], f, since)
    except Exception as e:  # la Sicilia non deve mai bloccare il resto della scansione
        log("  Sicilia: errore", type(e).__name__, str(e)[:120])
    # avvisi trovati dalla scansione nazionale scuola per scuola (workflow "Scuole d'Italia")
    for tp in sorted((ROOT / "data" / "scuole").glob("*_trovati.json")):
        try:
            extra = [i for i in json.loads(tp.read_text("utf-8")) if i.get("link") and i.get("classi")]
        except (OSError, ValueError):
            continue
        for i in extra:
            i.pop("_visto", None)
        found += extra
        log(f"  {tp.stem}: {len(extra)} avvisi dalle scuole")

    now = datetime.now(TZ).isoformat(timespec="seconds")
    added = []
    dettagli_letti = 0
    for it in found:
        key = (it["link"], tuple(it["classi"]), it["pubblicato"])
        if key in known_links:
            continue
        prov = it.pop("_prov", None)
        it["id"] = make_id(prov, it["classi"][0], it.get("scuola", ""), it["pubblicato"], it["link"])
        if it["id"] in items:
            continue
        it["_prov"] = prov
        budget = MAX_DETTAGLI - dettagli_letti
        if budget > 0:
            dettagli_letti += 1
            res = dettaglia(f, it)
        else:
            res = [it]
        if len(res) == 1 and res[0] is it and not it["link"].startswith("https://www.mim.gov.it/web/") and "ambito" not in it.get("scuola", ""):
            enrich(f, it)
        for r in res:
            r.pop("_prov", None)
            r["trovato"] = now
            if r["id"] not in items:
                added.append(r)
            put(items, r)
        known_links.add(key)

    # recupero: legge gli avvisi gia' in archivio che non sono ancora stati analizzati
    arretrati = [i for i in items.values() if not i.get("letto") and i.get("link")]
    arretrati.sort(key=lambda i: i.get("pubblicato") or "", reverse=True)
    for it in arretrati[:max(0, MAX_DETTAGLI - dettagli_letti)]:
        dettagli_letti += 1
        it = dict(it)
        res = dettaglia(f, it)
        items.pop(it["id"], None)
        for r in res:
            r.setdefault("trovato", it.get("trovato"))
            put(items, r)
    log(f"Avvisi analizzati per ore/durata: {dettagli_letti}")

    cutoff = (today - timedelta(days=KEEP_DAYS)).isoformat()
    keep = [i for i in items.values() if (i.get("pubblicato") or "9999") >= cutoff]
    keep.sort(key=lambda i: i.get("pubblicato") or "", reverse=True)
    geo.applica(keep)  # coordinate dalla cache (nessuna rete); le nuove scuole le risolve geo.py
    out = {"aggiornato": now, "fonti": f.pages, "nuovi": [i["id"] for i in added], "interpelli": keep}
    DATA.parent.mkdir(parents=True, exist_ok=True)
    DATA.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", "utf-8")
    # feed leggero per l'app: solo avvisi recenti e non scaduti, senza testi di servizio
    FEED = ROOT / "data" / "feed.json"
    limite_pub = (today - timedelta(days=21)).isoformat()
    ieri = (today - timedelta(days=1)).isoformat()
    leggero = []
    for i in keep:
        if (i.get("pubblicato") or "") < limite_pub:
            continue
        if i.get("scadenza") and i["scadenza"] < ieri:
            continue
        r = {k: v for k, v in i.items() if k not in ("letto", "trovato")}
        if i.get("trovato"):
            r["trovato"] = i["trovato"][:19]  # ora in cui l'app ha rilevato l'avviso (Europe/Rome)
        leggero.append(r)
    copertura = copertura_scuole()
    sic = None
    try:
        rs = json.loads((ROOT / "data" / "sicilia_report.json").read_text("utf-8"))
        sic = {"istituti": rs["istituti_sicilia"], "conSito": rs["con_sito"], "letti": rs["siti_letti_ok"],
               "errori": rs["siti_con_errore"], "uffici": sum(1 for u in sources["uffici"] if "sicilia" in u["url"] or "Caltanissetta" in u["nome"])}
    except (OSError, ValueError, KeyError):
        pass
    FEED.write_text(json.dumps({"aggiornato": now, "fonti": f.pages, "sicilia": sic, "copertura": copertura, "interpelli": leggero}, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")
    log(f"Feed app: {len(leggero)} avvisi")
    log(f"Pagine lette: {f.pages} · trovati {len(found)} · nuovi {len(added)} · totale {len(keep)}")
    for i in added:
        log("  NUOVO", i["classi"], i.get("provincia"), i.get("scuola"), i["link"])
    (ROOT / "data" / "ultima_scansione.txt").write_text("\n".join(REPORT[-400:]) + "\n", "utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
