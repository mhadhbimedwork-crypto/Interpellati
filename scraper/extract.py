"""Estrazione di ore settimanali e durata dal testo di un avviso di interpello.

Principio: PRECISIONE prima della copertura. Un valore viene restituito solo se
e' scritto nel testo vicino alla classe di concorso e non e' ambiguo. Ogni valore
porta con se' la frase originale (evidenza), cosi' l'app puo' mostrarla e tu puoi
controllarla. Se il testo e' ambiguo o assente il campo resta vuoto: mai indovinare.
"""
from __future__ import annotations

import re
from datetime import date

MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio",
        "agosto", "settembre", "ottobre", "novembre", "dicembre"]
MESE_RE = "|".join(MESI)

# ---- ore settimanali -------------------------------------------------------
# Ogni pattern cattura il numero di ore; sono tutte formule in cui l'avviso dice
# esplicitamente "ore" riferite alla cattedra/settimana.
ORE_PATTERNS = [
    re.compile(r"cattedra\s+(?:orario\s+)?(?:esterna\s+|interna\s+)?(?:di\s+|da\s+|con\s+)?(\d{1,2})\s*(?:ore|h)\b", re.I),
    re.compile(r"\b(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:ore|h)\s*(?:settimanali|sett\.?|di\s+cattedra|di\s+insegnamento|di\s+lezione)\b", re.I),
    re.compile(r"\b(\d{1,2})\s*/\s*18\b"),
    re.compile(r"\b(\d{1,2})\s*(?:ore|h)\s*(?:su|/|su\s+un\s+totale\s+di)\s*18\b", re.I),
    re.compile(r"\bore\s+(?:settimanali|di\s+cattedra|di\s+insegnamento)\s*[:=\-–]?\s*(\d{1,2})\b", re.I),
    re.compile(r"\b(?:n\.?|numero)\s*ore\s*(?:settimanali\s*)?[:=\-–]?\s*(\d{1,2}(?:[.,]\d{1,2})?)\b", re.I),
    re.compile(r"\bC\.?O\.?E\.?\s*(?:di\s+)?(\d{1,2})\s*(?:ore|h)?\b", re.I),
    re.compile(r"\b(?:orario\s+)?(?:completo|intero)\s*\(?\s*18\s*ore\)?", re.I),
]
FULL_RE = re.compile(r"\b(?:cattedra|orario)\s+(?:orario\s+)?(?:completa|completo|intera|intero)\b", re.I)


def _snip(text: str, a: int, b: int, pad: int = 70) -> str:
    return text[max(0, a - pad): b + pad].strip()


def find_ore(window: str) -> list[dict]:
    """Tutti i valori di ore trovati nella finestra, con evidenza."""
    out: list[dict] = []
    for rx in ORE_PATTERNS:
        for m in rx.finditer(window):
            try:
                v = float(m.group(1).replace(",", ".")) if m.groups() else 18.0
                v = int(v) if v == int(v) else round(v, 2)
            except (ValueError, IndexError):
                continue
            if 1 <= v <= 25:
                out.append({"ore": v, "evidenza": _snip(window, m.start(), m.end())})
    for m in FULL_RE.finditer(window):
        out.append({"ore": 18, "evidenza": _snip(window, m.start(), m.end())})
    return out


# ---- durata ------------------------------------------------------------------
DATE_NUM = r"(\d{1,2})[./-](\d{1,2})[./-](20\d\d|\d\d)"
DATE_TXT = r"(\d{1,2})\s+(" + MESE_RE + r")\s+(20\d\d)"
ISO_FINO = re.compile(r"\bfino\s+al\s+(20\d\d)-(\d\d)-(\d\d)\b", re.I)
FINO_GIUGNO = re.compile(r"\bfino\s+al\s+(30\s+giugno|31\s+agosto)\b(?!\s+20\d\d)", re.I)
FINO_AL = re.compile(r"\b(?:fino\s+(?:al|all[’']?)|sino\s+al|fino\s+a|entro\s+il\s+termine\s+del)\s+(?:il\s+)?(?:" + DATE_NUM + "|" + DATE_TXT + r")", re.I)
DAL_AL = re.compile(r"\bdal\s+(?:" + DATE_NUM + "|" + DATE_TXT + r")\s+al\s+(?:" + DATE_NUM + "|" + DATE_TXT + r")", re.I)
TERMINE_ATT = re.compile(r"fino\s+al\s+termine\s+delle\s+(?:attivit[aà]\s+didattiche|lezioni)", re.I)
TERMINE_ANNO = re.compile(r"fino\s+al\s+termine\s+dell[’']?\s*anno\s+scolastico", re.I)
AVENTE = re.compile(r"fino\s+(?:al\s+rientro|all[’']?\s*(?:eventuale\s+)?rientro|alla\s+(?:eventuale\s+)?(?:nomina|presa\s+di\s+servizio)|a\s+nomina|al\s+ritorno)|avente\s+diritto|titolare\s+(?:assente|in\s+congedo)", re.I)
GIORNI = re.compile(r"\bper\s+(?:n\.?\s*)?(\d{1,3})\s*(?:giorni|gg)\b", re.I)


def _mk(d: str, m: str, y: str) -> date | None:
    try:
        yy = int(y)
        yy = yy + 2000 if yy < 100 else yy
        return date(yy, int(m), int(d))
    except ValueError:
        return None


def _from_groups(g: tuple) -> date | None:
    """g = (d, m, y, d2, mese, y2) per i due formati; restituisce la prima data valida."""
    if g[0] and g[1] and g[2]:
        return _mk(g[0], g[1], g[2])
    if len(g) >= 6 and g[3] and g[4] and g[5]:
        try:
            return date(int(g[5]), MESI.index(g[4].lower()) + 1, int(g[3]))
        except ValueError:
            return None
    return None


def find_durata(window: str) -> list[dict]:
    out: list[dict] = []
    for m in DAL_AL.finditer(window):
        g = m.groups()
        a = _from_groups(g[0:6]); b = _from_groups(g[6:12])
        if a and b and a <= b:
            out.append({"tipo": "periodo", "dal": a.isoformat(), "al": b.isoformat(), "evidenza": _snip(window, m.start(), m.end())})
    for m in FINO_AL.finditer(window):
        d = _from_groups(m.groups())
        if d:
            out.append({"tipo": "fino_al", "al": d.isoformat(), "evidenza": _snip(window, m.start(), m.end())})
    for m in ISO_FINO.finditer(window):
        d = _mk(m.group(3), m.group(2), m.group(1))
        if d:
            out.append({"tipo": "fino_al", "al": d.isoformat(), "evidenza": _snip(window, m.start(), m.end())})
    for m in FINO_GIUGNO.finditer(window):
        out.append({"tipo": "termine_anno" if m.group(1).lower().startswith("31") else "termine_attivita", "evidenza": _snip(window, m.start(), m.end())})
    for m in TERMINE_ATT.finditer(window):
        out.append({"tipo": "termine_attivita", "evidenza": _snip(window, m.start(), m.end())})
    for m in TERMINE_ANNO.finditer(window):
        out.append({"tipo": "termine_anno", "evidenza": _snip(window, m.start(), m.end())})
    for m in AVENTE.finditer(window):
        out.append({"tipo": "avente_diritto", "evidenza": _snip(window, m.start(), m.end())})
    for m in GIORNI.finditer(window):
        out.append({"tipo": "giorni", "giorni": int(m.group(1)), "evidenza": _snip(window, m.start(), m.end())})
    return out


def categoria(d: dict, pubblicato: date | None = None) -> str | None:
    """breve (fino a 30 giorni) | intermedia | fino_a_fine_anno | indeterminata."""
    t = d.get("tipo")
    base = date.fromisoformat(d["dal"]) if d.get("dal") else pubblicato
    if t == "giorni":
        return "breve" if d["giorni"] <= 30 else "intermedia"
    if t in ("termine_attivita", "termine_anno"):
        return "fino_a_fine_anno"
    if t == "avente_diritto":
        return "indeterminata"
    if t in ("periodo", "fino_al") and d.get("al"):
        al = date.fromisoformat(d["al"])
        if base is None:
            return None
        giorni = (al - base).days
        if giorni <= 30:
            return "breve"
        return "fino_a_fine_anno" if al.month in (6, 7, 8) else "intermedia"
    return None


# ---- lettura riga per riga ---------------------------------------------------
# Codice meccanografico di una scuola (es. VBIC82200R, CTIS01100B): 2 lettere
# provincia + 2 lettere tipo + 5 cifre/lettere + 1 lettera, con almeno 3 cifre.
MECC_RE = re.compile(r"(?<![A-Za-z0-9])([A-Z]{2}[A-Z]{2}[0-9A-Z]{5}[A-Z])(?![A-Za-z0-9])")


def _unico(valori: list, chiave) -> object | None:
    """Restituisce il valore solo se tutte le occorrenze concordano."""
    distinti = {chiave(v) for v in valori}
    return valori[0] if len(distinti) == 1 and valori else None


def _scegli(window: str) -> dict:
    """Ore e durata di una finestra: valori solo se univoci, altrimenti vuoti."""
    ore = find_ore(window)
    dur = [d for d in find_durata(window) if d["tipo"] != "giorni" or d.get("giorni")]
    out: dict = {}
    o = _unico(ore, lambda v: v["ore"])
    if o:
        out["ore"] = o["ore"]
        out["oreEvidenza"] = o["evidenza"]
    # durata: se ci sono piu' indicazioni diverse non scegliamo
    d = _unico(dur, lambda v: (v["tipo"], v.get("al"), v.get("dal"), v.get("giorni")))
    if d:
        out["durata"] = {k: v for k, v in d.items() if k != "evidenza"}
        out["durataEvidenza"] = d["evidenza"]
    return out


def righe(text: str, ha_classe) -> list[dict]:
    """Se il testo e' un elenco (>=2 codici scuola) restituisce una riga per ogni
    scuola che nomina la classe cercata; altrimenti [] (il chiamante usa finestre).
    ha_classe(segmento) -> lista di classi trovate nel segmento."""
    text = " ".join(text.split())
    ms = [m for m in MECC_RE.finditer(text) if sum(c.isdigit() for c in m.group(1)) >= 3]
    if len(ms) < 2:
        return []
    out = []
    for i, m in enumerate(ms):
        fine = ms[i + 1].start() if i + 1 < len(ms) else len(text)
        seg = text[m.start():fine]
        classi = ha_classe(seg)
        if not classi:
            continue
        r = {"mecc": m.group(1), "classi": classi, "testo": seg[:260]}
        r.update(_scegli(seg))
        out.append(r)
    return out


def finestra(text: str, classe_rx, pad_prima: int = 120, pad_dopo: int = 320) -> dict:
    """Avviso singolo: usa le finestre attorno alla classe; vuoto se i valori divergono."""
    text = " ".join(text.split())
    ore, dur = [], []
    for m in classe_rx.finditer(text):
        w = text[max(0, m.start() - pad_prima): m.end() + pad_dopo]
        ore += find_ore(w)
        dur += find_durata(w)
    out: dict = {}
    o = _unico(ore, lambda v: v["ore"])
    if o:
        out["ore"] = o["ore"]; out["oreEvidenza"] = o["evidenza"]
    d = _unico(dur, lambda v: (v["tipo"], v.get("al"), v.get("dal"), v.get("giorni")))
    if d:
        out["durata"] = {k: v for k, v in d.items() if k != "evidenza"}
        out["durataEvidenza"] = d["evidenza"]
    return out
