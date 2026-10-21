#!/usr/bin/env python3
"""Rapporto provincia per provincia: uffici (stato lettura), scuole (mappate/leggibili), avvisi degli ultimi 7 giorni.
Scrive data/rapporto_province.json e data/rapporto_province.md con le anomalie da correggere."""
from __future__ import annotations
import glob, json, sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import scrape as S  # noqa: E402

D = S.ROOT / "data"


def jl(p, d=None):
    try:
        return json.loads(Path(p).read_text("utf-8"))
    except (OSError, ValueError):
        return d


def main() -> int:
    per = {p: {"sigla": sg, "regione": rg, "scuole": 0, "con_sito": 0, "lette_ok": 0, "uffici": 0, "uffici_ok": 0,
               "uffici_errori": [], "avvisi_uffici": 0, "avvisi7": 0, "avvisi_tot": 0} for p, (sg, rg) in S.PROVINCE.items()}
    sig = {v[0]: k for k, v in S.PROVINCE.items()}
    # scuole: elenchi e report (tutte le aree, Sicilia compresa)
    visti = set()
    for rp in glob.glob(str(D / "scuole" / "*_report.json")) + [str(D / "sicilia_report.json")]:
        r = jl(rp)
        if not r:
            continue
        for cod, v in (r.get("scuole") or {}).items():
            if cod in visti:
                continue
            visti.add(cod)
            p = sig.get(cod[:2].upper())
            if not p:
                continue
            per[p]["con_sito"] += 1
            per[p]["lette_ok"] += 1 if v.get("ok") else 0
    for ep in glob.glob(str(D / "scuole" / "*_elenco.json")) + [str(D / "sicilia_scuole.json")]:
        e = jl(ep) or {}
        for cod in (e.get("scuole") or e or {}):
            if isinstance(cod, str) and len(cod) == 10 and sig.get(cod[:2].upper()):
                per[sig[cod[:2].upper()]]["scuole"] += 0
    # istituti totali: dai report (con o senza sito)
    for rp in glob.glob(str(D / "scuole" / "*_elenco.json")):
        e = jl(rp) or {}
        for cod in (e.get("scuole") or {}):
            p = sig.get(cod[:2].upper())
            if p:
                per[p]["scuole"] += 1
    # uffici
    for sp in glob.glob(str(D / "scuole" / "uffici*_stato.json")):
        for url, v in (jl(sp) or {}).items():
            p = v.get("provincia")
            if p in per:
                per[p]["uffici"] += 1
                if v.get("errore"):
                    per[p]["uffici_errori"].append(f"{v['errore']} {url[:70]}")
                else:
                    per[p]["uffici_ok"] += 1
                per[p]["avvisi_uffici"] += v.get("avvisi", 0)
    # avvisi
    limite = (date.today() - timedelta(days=7)).isoformat()
    for it in (jl(D / "interpelli.json", {}) or {}).get("interpelli", []):
        pv = it.get("provincia")
        p = pv if pv in per else sig.get(pv)
        if p not in per:
            continue
        per[p]["avvisi_tot"] += 1
        if (it.get("pubblicato") or "") >= limite:
            per[p]["avvisi7"] += 1
    anomalie = []
    for p, v in sorted(per.items()):
        a = []
        if v["uffici"] == 0:
            a.append("nessun ufficio mappato")
        elif v["uffici_ok"] == 0:
            a.append("tutti gli uffici con errore")
        elif v["avvisi_uffici"] == 0:
            a.append("uffici letti ma 0 avvisi")
        if v["con_sito"] and v["lette_ok"] / v["con_sito"] < 0.6:
            a.append(f"scuole leggibili {100*v['lette_ok']//v['con_sito']}%")
        if v["avvisi7"] == 0:
            a.append("0 avvisi negli ultimi 7 giorni")
        v["anomalie"] = a
        if a:
            anomalie.append((p, a))
    (D / "rapporto_province.json").write_text(json.dumps(per, ensure_ascii=False, indent=1) + "\n", "utf-8")
    righe = [f"# Rapporto province {date.today()}", f"Province con anomalie: {len(anomalie)}/{len(per)}", "",
             "| Provincia | Scuole | Sito | Leggibili | Uffici ok/tot | Avvisi uffici | Avvisi 7gg | Anomalie |", "|---|---|---|---|---|---|---|---|"]
    for p, v in sorted(per.items()):
        righe.append(f"| {p} | {v['scuole']} | {v['con_sito']} | {v['lette_ok']} | {v['uffici_ok']}/{v['uffici']} | {v['avvisi_uffici']} | {v['avvisi7']} | {'; '.join(v['anomalie'])} |")
    (D / "rapporto_province.md").write_text("\n".join(righe) + "\n", "utf-8")
    print("\n".join(righe[:3]))
    for p, a in anomalie:
        print(" ", p, "->", "; ".join(a))
    return 0


if __name__ == "__main__":
    sys.exit(main())
