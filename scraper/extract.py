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
    re.compile(r"\b(\d{1,2})\s*(?:ore|h)\s*(?:settimanali|sett\.?|di\s+cattedra|di\s+insegnamento|di\s+lezione)\b", re.I),
    re.compile(r"\b(\d{1,2})\s*/\s*18\b"),
    re.compile(r"\b(\d{1,2})\s*(?:ore|h)\s*(?:su|/|su\s+un\s+totale\s+di)\s*18\b", re.I),
    re.compile(r"\bore\s+(?:settimanali|di\s+cattedra|di\s+insegnamento)\s*[:=\-–]?\s*(\d{1,2})\b", re.I),
    re.compile(r"\b(?:n\.?|numero)\s*ore\s*(?:settimanali\s*)?[:=\-–]?\s*(\d{1,2})\b", re.I),
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
                v = int(m.group(1)) if m.groups() else 18
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
    for m in TERMINE_ATT.finditer(window):
        out.append({"tipo": "termine_attivita", "evidenza": _snip(window, m.start(), m.end())})
    for m in TERMINE_ANNO.finditer(window):
        out.append({"tipo": "termine_anno", "evidenza": _snip(window, m.start(), m.end())})
    for m in AVENTE.finditer(window):
        out.append({"tipo": "avente_diritto", "evidenza": _snip(window, m.start(), m.end())})
    for m in GIORNI.finditer(window):
        out.append({"tipo": "giorni", "giorni": int(m.group(1)), "evidenza": _snip(window, m.start(), m.end())})
    return out


def categoria(d: dict, oggi: date | None = None) -> str | None:
    """breve (<30 gg) | media | annuale | indeterminata, da un dato di durata."""
    oggi = oggi or date.today()
    t = d.get("tipo")
    if t == "giorni":
        return "breve" if d["giorni"] < 30 else "media"
    if t in ("periodo", "fino_al") and d.get("al"):
        al = date.fromisoformat(d["al"])
        if al.month in (8, 9) and al.day >= 30 or (al.month == 8):
            return "annuale"
        if al.month == 6 and al.day >= 28:
            return "annuale_30_6"
        base = date.fromisoformat(d["dal"]) if d.get("dal") else oggi
        giorni = (al - base).days
        return "breve" if giorni < 30 else "media"
    if t == "termine_attivita":
        return "annuale_30_6"
    if t in ("termine_anno",):
        return "annuale"
    if t == "avente_diritto":
        return "indeterminata"
    return None
