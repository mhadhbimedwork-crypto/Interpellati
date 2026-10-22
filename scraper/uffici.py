#!/usr/bin/env python3
"""Legge a turni gli uffici scolastici (USR/UST/ATP) di tutta Italia: homepage + pagine 'interpelli' collegate.
Uso: python scraper/uffici.py <k> <n>  (turno k di n, in parallelo). Avvisi in data/scuole/uffici<k>_trovati.json"""
from __future__ import annotations
import json, re, sys, time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup
sys.path.insert(0, str(Path(__file__).resolve().parent))
import scrape as S  # noqa: E402

D = S.ROOT / "data"


def pagine_interpelli(f, url: str, html: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for a in soup.find_all("a", href=True):
        t = (a.get_text(" ", strip=True) + " " + a["href"]).lower()
        if any(k in t for k in ("interpell", "supplenz", "disponibilit", "convocazion")) and not a["href"].lower().split("?")[0].endswith((".pdf", ".doc", ".docx", ".zip")):
            u = urljoin(url, a["href"]).split("#")[0]
            if u not in out and u != url and u.startswith(("http://", "https://")):
                out.append(u)
    # prima gli articoli (data nell'indirizzo o titolo lungo), poi categorie e menu
    out.sort(key=lambda u: (0 if re.search(r"/20\d\d/\d\d/", u) else 1 if len(u.rstrip("/").split("/")[-1]) >= 25 else 2))
    return out[:10]


SOCIAL = ("facebook.", "twitter.", "x.com", "whatsapp", "linkedin.", "t.me", "telegram.", "pinterest.", "instagram.", "youtube.", "youtu.be")
PAG_RX = re.compile(r"/(category|tag|author|argomento|argomenti|page|categoria|archivio|mese)(/|$)|[?&](cat|page|paged)=", re.I)


FILE_EXT = (".pdf", ".doc", ".docx", ".odt", ".zip", ".rtf", ".xls", ".xlsx")


def forma_ok(it: dict) -> bool:
    """Link che sembra un avviso vero: un documento, oppure un articolo con titolo lungo (non indici, categorie, menu)."""
    if not it.get("link") or not it.get("classi"):
        return False
    lk = it["link"].lower()
    if not lk.startswith(("http://", "https://")) or any(h in lk.split("/")[2] for h in SOCIAL):
        return False
    path = lk.split("#")[0].split("?")[0]
    if path.endswith(FILE_EXT):
        return True
    if PAG_RX.search(path):
        return False
    slug = path.rstrip("/").split("/")[-1]
    if "/interpell" in path and len(slug) >= 18:
        return True
    return len(slug) >= 18 and ("interpell" in slug or "supplenz" in slug or "disponibil" in slug or bool(S.CODE_RE.search(slug.upper())))


def valido(it: dict) -> bool:
    return bool(it.get("pubblicato")) and forma_ok(it)


def data_pagina(f, link: str, cache: dict) -> str:
    """Data di pubblicazione letta dalla pagina dell'articolo (meta, tag time, testo); ricordata per non rileggere."""
    if cache.get(link):
        return cache[link]
    d = ""
    m = re.search(r"/(20\d\d)/(\d{1,2})/(\d{1,2})/", link)
    if m:
        try:
            d = date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
        except ValueError:
            d = ""
    if d:
        cache[link] = d
        return d
    up = re.search(r"/uploads/(20\d\d)/(\d\d)/", link)
    if up and (int(up[1]), int(up[2])) < ((date.today() - timedelta(days=10)).year, (date.today() - timedelta(days=10)).month):
        cache[link] = f"{up[1]}-{up[2]}-01"  # allegato caricato in un mese passato: non e' nuovo
        return cache[link]
    if not link.lower().split("?")[0].endswith(FILE_EXT):
        html = f.get(link)
        if not html:
            return ""  # pagina non raggiunta: riprova al prossimo giro, non memorizzare il fallimento
        if html:
            soup = BeautifulSoup(html, "html.parser")
            testo = soup.get_text(" ", strip=True)
            cand = []
            # 1) date dichiarate con un'etichetta (Pubblicato il, Data:, Ultimo aggiornamento)
            for mm in re.finditer(r"(?:pubblicat\w*|aggiornament\w*|\bdata\b)[^0-9]{0,30}(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{1,2}\s+[a-zà]+\s+\d{4})", testo[:8000], re.I):
                cand.append(mm.group(1))
            # 2) metadati e tag <time>
            for m in soup.find_all("meta"):
                if (m.get("property") or m.get("name") or m.get("itemprop") or "").lower() in (
                        "article:published_time", "article:modified_time", "og:updated_time", "date", "datepublished", "dc.date"):
                    cand.append(m.get("content") or "")
            for t in soup.find_all("time"):
                cand.append(t.get("datetime") or t.get_text(" ", strip=True))
            # 3) inizio della pagina
            cand.append(testo[:800])
            oggi = date.today()
            for c in cand:
                x = None
                iso = re.match(r"\s*(20\d\d)-(\d\d)-(\d\d)", c or "")
                if iso:
                    try:
                        x = date(int(iso[1]), int(iso[2]), int(iso[3]))
                    except ValueError:
                        x = None
                x = x or S.find_date(c)
                if x and x <= oggi + timedelta(days=1):
                    d = x.isoformat()
                    break
    cache[link] = d
    return d


FEED_LETTI: set = set()  # un feed per sito per giro, anche se piu' pagine dello stesso ufficio lo dichiarano


def da_rss(xml: str, src: dict, since: date) -> list[dict]:
    """Feed RSS/Atom ufficiale del sito: titolo, link e data di pubblicazione certa per ogni avviso."""
    from email.utils import parsedate_to_datetime
    try:
        soup = BeautifulSoup(xml, "xml")
    except Exception:  # noqa: BLE001  (lxml assente)
        soup = BeautifulSoup(xml, "html.parser")
    out = []
    for it in soup.find_all(["item", "entry"]):
        tit = (it.find("title").get_text(" ", strip=True) if it.find("title") else "")
        ln = it.find("link")
        link = (ln.get("href") or ln.get_text(strip=True)) if ln else ""
        desc = " ".join(x.get_text(" ", strip=True) for x in it.find_all(["description", "summary", "category"]))[:600]
        pub = it.find(["pubDate", "pubdate", "published", "updated"])
        d = None
        if pub:
            t = pub.get_text(strip=True)
            try:
                d = parsedate_to_datetime(t).date()
            except (TypeError, ValueError):
                d = S.find_date(t) or (date.fromisoformat(t[:10]) if re.match(r"20\d\d-\d\d-\d\d", t) else None)
        cls = S.classes_in(tit + " " + link, True) or S.classes_in(desc, True)
        if not link or not cls or not S.INTERPELLO_RE.search(tit + " " + desc + " " + link):
            continue
        if not d or d < since or d > date.today() + timedelta(days=1):
            continue
        p = S.provincia_scuola(tit + " " + desc) or (None if "nazional" in tit.lower() else src.get("_prov"))
        item = {"classi": cls, "scuola": tit[:140], "pubblicato": d.isoformat(), "link": link, "fonte": src["nome"], "_prov": p}
        if p:
            item["provincia"], item["regione"] = S.PROVINCE[p]
        out.append(item)
    return out


def uno(f, off: dict, since: date) -> list[dict]:
    html = f.get(off["url"])
    if not html:
        return []
    if html.lstrip()[:200].lower().startswith("<?xml") or "<rss" in html[:400].lower() or "<feed" in html[:400].lower():
        src = {"nome": off["nome"], "url": off["url"], "_prov": off.get("provincia")}
        return da_rss(html, src, since)
    src = {"nome": off["nome"], "url": off["url"], "provincia": off.get("provincia")}
    # anche la pagina dell'ufficio stessa puo' elencare avvisi senza data: la data si legge dopo dall'avviso
    res = S.scan_html(f, src, since, html, undated=True)
    # feed RSS dichiarato dal sito (<link rel="alternate" type="application/rss+xml">): date certe per ogni articolo
    m = re.search(r"<link[^>]+type=[\"']application/(?:rss|atom)\+xml[\"'][^>]*>", html, re.I)
    if m:
        h = re.search(r"href=[\"']([^\"']+)", m.group(0))
        if h and "comments" not in h.group(1):
            fu = urljoin(off["url"], h.group(1))
            xml = None if fu in FEED_LETTI else f.get(fu)
            FEED_LETTI.add(fu)
            if xml and ("<rss" in xml[:500].lower() or "<feed" in xml[:500].lower() or xml.lstrip().startswith("<?xml")):
                res += da_rss(xml, {"nome": off["nome"], "url": fu, "_prov": off.get("provincia")}, since)
    for u in pagine_interpelli(f, off["url"], html):
        h2 = f.get(u)
        if h2:
            res += S.scan_html(f, dict(src, url=u), since, h2, undated=True)
    return res


def main() -> int:
    k, n = int(sys.argv[1]), int(sys.argv[2])
    uff = []
    fissi = json.loads(S.SOURCES.read_text("utf-8"))["uffici"]
    try:
        uff += json.loads((D / "uffici_scoperti.json").read_text("utf-8"))
    except (OSError, ValueError):
        pass
    try:
        uff += json.loads((D / "uffici_elenco.json").read_text("utf-8"))
    except (OSError, ValueError):
        pass
    visti = {u["url"] for u in uff}
    uff += [u for u in fissi if u["url"] not in visti]
    uff = [u for i, u in enumerate(sorted(uff, key=lambda x: x["url"])) if i % n == k]
    f = S.Fetcher()
    since = date.today() - timedelta(days=10)
    t0 = time.time()
    trovati = []
    stato = {}
    dp = D / "scuole" / f"uffici{k}_date.json"
    try:
        cache_date = json.loads(dp.read_text("utf-8"))
    except (OSError, ValueError):
        cache_date = {}
    budget_date = [450]
    vp = D / "scuole" / f"uffici{k}_visti.json"
    try:
        visti_prima = json.loads(vp.read_text("utf-8"))
        base_esiste = True
    except (OSError, ValueError):
        visti_prima, base_esiste = {}, False
    oggi = date.today().isoformat()
    def lavoro(o):
        try:
            grezzi = uno(f, o, since)
            per_ufficio = 30  # date lette per ufficio e per giro: nessun sito monopolizza il tempo
            for i in grezzi:
                if not forma_ok(i) or i.get("pubblicato"):
                    continue
                if i["link"] not in cache_date:
                    if per_ufficio <= 0 or budget_date[0] <= 0:
                        continue
                    per_ufficio -= 1
                    budget_date[0] -= 1
                dd = data_pagina(f, i["link"], cache_date)
                if dd and dd >= since.isoformat():
                    i["pubblicato"] = dd
            for i in grezzi:
                # senza data leggibile: vale la data in cui il link compare per la prima volta (dopo il primo giro di riferimento)
                if forma_ok(i) and not i.get("pubblicato"):
                    v = visti_prima.get(i["link"])
                    if v is None:
                        visti_prima[i["link"]] = oggi if base_esiste else "base"
                        v = visti_prima[i["link"]]
                    if v != "base" and v >= since.isoformat():
                        i["pubblicato"] = v
            r = [i for i in grezzi if valido(i)]
            stato[o["url"]] = {"grezzi": len(grezzi), "scartati": [i["link"][:110] for i in grezzi if not valido(i)][:4]}
            return o, r, None
        except Exception as e:  # noqa: BLE001
            return o, [], type(e).__name__
    with ThreadPoolExecutor(10) as ex:
        for o, r, err in ex.map(lavoro, uff):
            trovati += r
            stato.setdefault(o["url"], {}).update({"provincia": o.get("provincia"), "avvisi": len(r), "errore": err or f.errs.get(o["url"])})
    vp.write_text(json.dumps(dict(list(visti_prima.items())[-6000:]), ensure_ascii=False, indent=0) + "\n", "utf-8")
    dp.write_text(json.dumps(dict(list(cache_date.items())[-3000:]), ensure_ascii=False, indent=0) + "\n", "utf-8")
    tp = D / "scuole" / f"uffici{k}_trovati.json"
    try:
        vecchi = json.loads(tp.read_text("utf-8"))
    except (OSError, ValueError):
        vecchi = []
    limite = (date.today() - timedelta(days=4)).isoformat()
    per = {(i["link"], tuple(i["classi"])): i for i in vecchi if (i.get("_visto") or "") >= limite and valido(i)}
    (D / "scuole" / f"uffici{k}_stato.json").write_text(json.dumps(stato, ensure_ascii=False, indent=0) + "\n", "utf-8")
    ora = datetime.now().isoformat(timespec="seconds")
    for it in trovati:
        it["_visto"] = ora
        per[(it["link"], tuple(it["classi"]))] = it
    tp.parent.mkdir(parents=True, exist_ok=True)
    tp.write_text(json.dumps(list(per.values()), ensure_ascii=False, indent=0) + "\n", "utf-8")
    (D / "scuole" / f"uffici{k}_log.txt").write_text("\n".join(l for l in S.REPORT if "catena" in l or "certificato" in l or "robots" in l or "HTTP" in l)[:20000] + "\n", "utf-8")
    print(f"turno {k}/{n}: uffici {len(uff)} · avvisi {len(trovati)} · in attesa {len(per)} · {int(time.time()-t0)}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
