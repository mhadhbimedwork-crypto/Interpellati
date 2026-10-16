#!/usr/bin/env python3
"""Prova di misura: quanti avvisi si riescono a leggere con precisione?
Non modifica i dati: stampa un rapporto JSON-lines e un riepilogo."""
from __future__ import annotations
import io, json, random, re, sys
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader
import scrape
from extract import find_ore, find_durata, categoria

def pdf_text(content: bytes) -> str:
    try:
        r = PdfReader(io.BytesIO(content))
        return " ".join((p.extract_text() or "") for p in r.pages[:8])
    except Exception:
        return ""

def fetch(f: scrape.Fetcher, url: str):
    if not f.allowed(url):
        return None, None
    import time
    host = re.sub(r"^https?://([^/]+).*", r"\1", url)
    w = 1.0 - (time.time() - f.last.get(host, 0))
    if w > 0: time.sleep(w)
    try:
        r = f.s.get(url, timeout=30)
        f.last[host] = time.time()
        if r.status_code != 200: return None, None
        ct = r.headers.get("content-type", "")
        if "pdf" in ct or url.lower().split("?")[0].endswith(".pdf") or r.content[:4] == b"%PDF":
            return "pdf", pdf_text(r.content)
        r.encoding = r.apparent_encoding or r.encoding
        return "html", r.text
    except requests.RequestException:
        return None, None

def windows(text: str, classi: list[str]):
    """Finestre di testo attorno alle citazioni della classe."""
    text = " ".join(text.split())
    out = []
    for c in classi:
        rx = re.compile(r"(?<![A-Za-z0-9])" + c[0] + r"[-\s]?0?" + c[1:] + r"(?![A-Za-z0-9])", re.I) if re.match(r"[AB]\d{3}$", c) else re.compile(re.escape(c), re.I)
        for m in rx.finditer(text):
            out.append((c, text[max(0, m.start() - 120): m.end() + 320]))
    return out

def main():
    items = json.load(open(scrape.DATA, encoding="utf-8"))["interpelli"]
    random.seed(7)
    prior = [i for i in items if set(i.get("classi", [])) & {"B015", "B017"}]
    other = [i for i in items if i not in prior]
    sample = prior + random.sample(other, min(40, len(other)))
    f = scrape.Fetcher()
    stats = {"items": 0, "doc_con_classe": 0, "ore_unica": 0, "ore_ambigua": 0, "ore_nessuna": 0, "durata_ok": 0, "durata_nessuna": 0}
    for it in sample:
        stats["items"] += 1
        kind, body = fetch(f, it["link"])
        docs = []
        if kind == "pdf":
            docs.append((it["link"], "pdf", body))
        elif kind == "html":
            soup = BeautifulSoup(body, "html.parser")
            main_ = soup.find("article") or soup.find("main") or soup
            page_text = " ".join(main_.get_text(" ", strip=True).split())
            docs.append((it["link"], "html", page_text))
            cand = []
            for a in soup.find_all("a", href=True):
                txt = " ".join(a.get_text(" ", strip=True).split())
                href = urljoin(it["link"], a["href"])
                ctx = scrape.block_of(a)
                hay = txt + " " + href + " " + (ctx if len(ctx) < 400 else "")
                if any(re.search(r"(?<![A-Za-z0-9])" + c + r"(?![A-Za-z0-9])", hay.replace("-", "").replace(" ", " ")) for c in it["classi"]) and re.search(r"interpell|supplen|disponib|\.pdf", hay, re.I):
                    cand.append(href)
            for href in list(dict.fromkeys(cand))[:5]:
                k2, b2 = fetch(f, href)
                if k2 == "pdf": docs.append((href, "pdf", b2))
                elif k2 == "html":
                    s2 = BeautifulSoup(b2, "html.parser")
                    docs.append((href, "html", " ".join((s2.find("article") or s2.find("main") or s2).get_text(" ", strip=True).split())))
        rec = {"id": it["id"], "classi": it["classi"], "link": it["link"], "docs": []}
        any_class = False; ore_vals = set(); dur = []
        for url, k, text in docs:
            ws = windows(text, it["classi"])
            if not ws: 
                rec["docs"].append({"url": url, "tipo": k, "chars": len(text), "classe_trovata": False}); continue
            any_class = True
            ores = [o for _, w in ws for o in find_ore(w)]
            durs = [d for _, w in ws for d in find_durata(w)]
            ore_vals |= {o["ore"] for o in ores}
            dur += durs
            rec["docs"].append({"url": url, "tipo": k, "chars": len(text), "classe_trovata": True,
                                "ore": ores[:4], "durata": durs[:4]})
        stats["doc_con_classe"] += any_class
        if len(ore_vals) == 1: stats["ore_unica"] += 1
        elif len(ore_vals) > 1: stats["ore_ambigua"] += 1
        else: stats["ore_nessuna"] += 1
        if dur: stats["durata_ok"] += 1
        else: stats["durata_nessuna"] += 1
        print("REC " + json.dumps(rec, ensure_ascii=False), flush=True)
    print("STATS " + json.dumps(stats), flush=True)

if __name__ == "__main__":
    main()
