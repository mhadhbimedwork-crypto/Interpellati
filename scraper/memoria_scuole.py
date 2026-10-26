#!/usr/bin/env python3
"""Memoria del progetto e foglio Excel delle scuole.

Ogni giorno, per ognuna delle ~7.800 scuole statali, tiene traccia di cosa e' successo (data/memoria_scuole.json):
  VERDE     il sito e' stato letto con successo
  ARANCIONE si sta ancora cercando (mai letta, errore recente, server che limita le richieste, in recupero)
  ROSSO     non si trova: nessun sito dichiarato, dominio inesistente, sito non ancora pubblicato, robots.txt che
            non consente il bot (rispettato), oppure irraggiungibile da piu' di 7 giorni consecutivi
In data/memoria_progetto.json resta lo storico giornaliero della copertura e le "lezioni" apprese (cause degli errori
con quante scuole riguardano e cosa e' stato fatto), cosi' ogni giorno il sistema parte da quello che ha gia' imparato.
Produce data/Elenco_scuole_Interpellati.xlsx (celle verdi / arancioni / rosse). Solo dati pubblici delle scuole."""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scrape as S  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "data" / "scuole"
MEM = ROOT / "data" / "memoria_scuole.json"
PROG = ROOT / "data" / "memoria_progetto.json"
XLSX = ROOT / "data" / "Elenco_scuole_Interpellati.xlsx"
OGGI = date.today().isoformat()
GIORNI_ROSSO = 7

COL = {"verde": "63BE7B", "arancione": "FFC000", "rosso": "F8696B"}
CHIARO = {"verde": "C6EFCE", "arancione": "FFE699", "rosso": "FFC7CE"}


def leggi(p: Path, default):
    try:
        return json.loads(p.read_text("utf-8"))
    except (OSError, ValueError):
        return default


def main() -> int:
    reg_di = {v[0]: v[1] for v in S.PROVINCE.values()}
    # anagrafica
    scuole: dict[str, dict] = {}
    for ep in [ROOT / "data" / "sicilia_scuole.json"] + sorted(D.glob("*_elenco.json")):
        if "priorita" in ep.name:
            continue
        for cod, v in leggi(ep, {}).get("scuole", {}).items():
            e = scuole.setdefault(cod, {"nome": v.get("nome", ""), "comune": v.get("comune", ""), "sito": v.get("sito"), "sedi": v.get("sedi", [])})
            e["sito"] = e.get("sito") or v.get("sito")
    # siti corretti
    corretti = {}
    for fp in sorted(D.glob("*_corretti.json")) + [ROOT / "data" / "sicilia_siti_corretti.json"]:
        corretti.update({c: u for c, u in leggi(fp, {}).items() if u})
    # esiti delle letture
    ok_rep: dict[str, bool] = {}
    err_rep: dict[str, str] = {}
    ultima_ok: dict[str, str] = {}
    for rp in [ROOT / "data" / "sicilia_report.json"] + sorted(D.glob("*_report.json")):
        agg = leggi(rp, {}).get("aggiornato", "")[:10]
        for cod, v in leggi(rp, {}).get("scuole", {}).items():
            if v.get("ok"):
                ok_rep[cod] = True
                ultima_ok[cod] = max(ultima_ok.get(cod, ""), agg)
            else:
                ok_rep.setdefault(cod, False)
                if v.get("err"):
                    err_rep[cod] = str(v["err"])
    diag_err = leggi(ROOT / "data" / "diagnosi_errori.json", {}).get("scuole", {})
    motivi_area: dict[str, str] = {}
    for fp in D.glob("*_diagnosi.json"):
        for c, v in leggi(fp, {}).items():
            if isinstance(v, dict) and v.get("motivo"):
                motivi_area[c] = v["motivo"]
    ip_lenti = leggi(ROOT / "data" / "ip_lenti.json", {}).get("scuole", {})
    b_codici = set()
    xl_b = ROOT / "data" / "Elenco_scuole_B015_B017.xlsx"
    if xl_b.exists():
        try:
            ws = load_workbook(xl_b, read_only=True)["Tutta Italia"]
            for r in list(ws.iter_rows(values_only=True))[1:]:
                if r and r[4]:
                    b_codici.add(str(r[4]).strip().upper())
        except Exception:  # noqa: BLE001
            pass
    conta_int = Counter()
    ultimo_int: dict[str, dict] = {}
    for it in leggi(ROOT / "data" / "interpelli.json", {}).get("interpelli", []):
        c = it.get("codiceScuola")
        if c:
            conta_int[c] += 1
            if (it.get("pubblicato") or "") >= (ultimo_int.get(c, {}).get("pubblicato") or ""):
                ultimo_int[c] = it

    mem = leggi(MEM, {"scuole": {}})
    m = mem["scuole"]
    transizioni = []
    for cod, a in scuole.items():
        sito = corretti.get(cod) or a.get("sito")
        e = m.setdefault(cod, {"primo_visto": OGGI, "giorni_errore": [], "storico": []})
        vecchio_stato = e.get("stato")
        e.update(nome=a["nome"], comune=a["comune"], sito=sito)
        e["regione"] = reg_di.get(cod[:2], "Altro")
        e["provincia"] = S.SIGLA.get(cod[:2], "")
        d = diag_err.get(cod)
        ult = d["t"][-1]["st"] if d and d.get("t") else None
        ip = d.get("ip") if d else ""
        if ok_rep.get(cod):
            stato, motivo = "verde", "sito letto"
            e["giorni_errore"] = []
            e["ultima_lettura"] = ultima_ok.get(cod) or OGGI
        else:
            if OGGI not in e["giorni_errore"] and (ok_rep.get(cod) is False or cod in err_rep):
                e["giorni_errore"].append(OGGI)
                e["giorni_errore"] = e["giorni_errore"][-30:]
            mot_area = motivi_area.get(cod, "")
            if not sito:
                stato, motivo = "rosso", "nessun sito indicato nell'anagrafica del Ministero"
            elif "inesistente" in mot_area or (d and ip == "" and ult not in (None, 200) and str(ult).endswith("Error")):
                stato, motivo = "rosso", "dominio inesistente (sito dismesso o cambiato)"
            elif "non ancora pubblicato" in mot_area or (d and ip == "13.37.102.167" and ult == 503):
                stato, motivo = "rosso", "sito non ancora pubblicato (segnaposto «A breve on line»)"
            elif ult == "robots vieta":
                stato, motivo = "rosso", "il robots.txt del sito non consente il bot (rispettato)"
            elif len([g for g in e["giorni_errore"] if g]) >= GIORNI_ROSSO:
                stato, motivo = "rosso", f"irraggiungibile da {len(e['giorni_errore'])} giorni ({err_rep.get(cod) or ult})"
            elif cod in ip_lenti or ult == 509:
                stato, motivo = "arancione", "server condiviso che limita le richieste: lettura lenta in corso"
            elif cod in ok_rep or cod in err_rep:
                stato, motivo = "arancione", "errore recente (" + str(err_rep.get(cod) or ult or "n.d.") + "): si riprova ogni giorno"
            else:
                stato, motivo = "arancione", "non ancora letta: in coda"
        e["stato"], e["motivo"] = stato, motivo
        if vecchio_stato and vecchio_stato != stato:
            transizioni.append((cod, vecchio_stato, stato, motivo))
        if not e["storico"] or e["storico"][-1][1] != stato:
            e["storico"].append([OGGI, stato])
            e["storico"] = e["storico"][-20:]
    for cod in [c for c in m if c not in scuole]:
        m.pop(cod)  # scuola non piu' in anagrafica (accorpata/chiusa)
    mem["aggiornato"] = datetime.now().isoformat(timespec="seconds")
    MEM.write_text(json.dumps(mem, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")

    # ---- statistiche e lezioni
    tot = Counter(e["stato"] for e in m.values())
    per_reg: dict[str, Counter] = defaultdict(Counter)
    for e in m.values():
        per_reg[e["regione"]][e["stato"]] += 1
    cause = Counter(e["motivo"].split(" (")[0] for e in m.values() if e["stato"] != "verde")
    prog = leggi(PROG, {"storico": [], "lezioni": [], "regole": []})
    riga = {"data": OGGI, "scuole": len(m), "verdi": tot["verde"], "arancioni": tot["arancione"], "rossi": tot["rosso"],
            "percentuale_verdi": round(100 * tot["verde"] / max(1, len(m)), 1),
            "per_regione": {r: {k: c[k] for k in ("verde", "arancione", "rosso")} for r, c in sorted(per_reg.items())}}
    prog["storico"] = [r for r in prog["storico"] if r["data"] != OGGI] + [riga]
    nuove_verdi = [t for t in transizioni if t[2] == "verde"]
    peggiorate = [t for t in transizioni if t[1] == "verde" and t[2] != "verde"]
    prog["lezioni"] = [l for l in prog["lezioni"] if l["data"] != OGGI]
    for causa, n in cause.most_common(8):
        prog["lezioni"].append({"data": OGGI, "tipo": "causa", "causa": causa, "scuole": n})
    if nuove_verdi:
        prog["lezioni"].append({"data": OGGI, "tipo": "recuperate", "scuole": len(nuove_verdi),
                                "esempi": [{"codice": c, "nome": m[c]["nome"][:40], "prima": a} for c, a, _, _ in nuove_verdi[:8]]})
    if peggiorate:
        prog["lezioni"].append({"data": OGGI, "tipo": "peggiorate", "scuole": len(peggiorate),
                                "esempi": [{"codice": c, "nome": m[c]["nome"][:40], "ora": b, "motivo": mo[:60]} for c, _, b, mo in peggiorate[:8]]})
    prog["lezioni"] = prog["lezioni"][-400:]
    prog["regole"] = [
        "HTTP 509/429 su server condivisi: leggere a ritmo adattivo per IP (scrape.RitmoIP), mai aggirare il limite",
        "Segnaposto «A breve on line»: non e' un sito letto, la scuola resta rossa e si ricontrolla",
        "Domini inesistenti: provare Indice PA, varianti www/http, .edu.it/.gov.it prima di dichiarare rosso",
        "robots.txt che vieta il bot: si rispetta; avvisi cercati su UST/USR e aggregatori",
        "Una scuola e' rossa dopo " + str(GIORNI_ROSSO) + " giorni di errore consecutivi e viene ricontrollata ogni giorno",
        "Avvisi con 'docenti in servizio / ore aggiuntive' sono riservati agli interni: segnalati come tali",
    ]
    PROG.write_text(json.dumps(prog, ensure_ascii=False, indent=0) + "\n", "utf-8")

    # ---- Excel
    wb = Workbook()
    ws0 = wb.active
    ws0.title = "Riepilogo"
    testa = Font(bold=True, color="FFFFFF")
    fill_testa = PatternFill("solid", fgColor="1F3864")
    ws0["A1"] = "Interpellati – copertura delle scuole statali"
    ws0["A1"].font = Font(bold=True, size=14)
    ws0["A2"] = f"Aggiornato il {datetime.now().strftime('%d/%m/%Y %H:%M')} · verde = sito letto · arancione = ancora in ricerca · rosso = non si trova"
    ws0.append([])
    ws0.append(["Stato", "Scuole", "%"])
    for c in ws0[4]:
        c.font, c.fill = testa, fill_testa
    for k, et in (("verde", "Verde – letta"), ("arancione", "Arancione – in ricerca"), ("rosso", "Rosso – non si trova")):
        ws0.append([et, tot[k], round(100 * tot[k] / max(1, len(m)), 1)])
        ws0.cell(ws0.max_row, 1).fill = PatternFill("solid", fgColor=COL[k])
    ws0.append(["Totale", len(m), 100])
    ws0.append([])
    ws0.append(["Regione", "Verdi", "Arancioni", "Rossi", "Totale", "% verdi"])
    for c in ws0[ws0.max_row]:
        c.font, c.fill = testa, fill_testa
    for r, c in sorted(per_reg.items(), key=lambda x: -x[1]["verde"] / max(1, sum(x[1].values()))):
        n = sum(c.values())
        ws0.append([r, c["verde"], c["arancione"], c["rosso"], n, round(100 * c["verde"] / n, 1)])
        ws0.cell(ws0.max_row, 2).fill = PatternFill("solid", fgColor=CHIARO["verde"])
        ws0.cell(ws0.max_row, 3).fill = PatternFill("solid", fgColor=CHIARO["arancione"])
        ws0.cell(ws0.max_row, 4).fill = PatternFill("solid", fgColor=CHIARO["rosso"])
    ws0.append([])
    ws0.append(["Perche' non sono verdi", "Scuole"])
    for c in ws0[ws0.max_row]:
        c.font, c.fill = testa, fill_testa
    for causa, n in cause.most_common():
        ws0.append([causa, n])
    ws0.append([])
    ws0.append(["Storico", "Verdi", "Arancioni", "Rossi", "% verdi"])
    for c in ws0[ws0.max_row]:
        c.font, c.fill = testa, fill_testa
    for r in prog["storico"][-60:][::-1]:
        ws0.append([r["data"], r["verdi"], r["arancioni"], r["rossi"], r["percentuale_verdi"]])
    ws0.column_dimensions["A"].width = 58
    for col in "BCDEF":
        ws0.column_dimensions[col].width = 13

    def foglio(nome, righe, nuove=False):
        ws = wb.create_sheet(nome)
        cols = ["Regione", "Provincia", "Comune", "Scuola", "Codice", "Sito", "Stato", "Motivo", "Ultima lettura riuscita",
                "Giorni in errore", "Interpelli trovati", "Ultimo interpello", "Nuova in elenco dal"]
        ws.append(cols)
        for c in ws[1]:
            c.font, c.fill = testa, fill_testa
            c.alignment = Alignment(wrap_text=True, vertical="center")
        for cod, e in righe:
            ui = ultimo_int.get(cod, {})
            ws.append([e["regione"], e["provincia"], e["comune"], e["nome"], cod, e.get("sito") or "", e["stato"].upper(), e["motivo"],
                       e.get("ultima_lettura", ""), len(e.get("giorni_errore", [])), conta_int.get(cod, 0),
                       ui.get("link", ""), e.get("primo_visto", "")])
            ws.cell(ws.max_row, 7).fill = PatternFill("solid", fgColor=COL[e["stato"]])
            ws.cell(ws.max_row, 7).font = Font(bold=True)
        for i, w in enumerate([16, 9, 20, 40, 13, 38, 12, 52, 14, 10, 10, 40, 14], 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions
        return ws
    tutte = sorted(m.items(), key=lambda x: (x[1]["regione"], x[1]["provincia"], x[1]["comune"], x[1]["nome"]))
    foglio("Tutte le scuole", tutte)
    foglio("Da cercare (arancione)", [(c, e) for c, e in tutte if e["stato"] == "arancione"])
    foglio("Non si trovano (rosso)", [(c, e) for c, e in tutte if e["stato"] == "rosso"])
    novita = [(c, e) for c, e in tutte if e.get("primo_visto") == OGGI and len(prog["storico"]) > 1] + \
             [(c, m[c]) for c, _, b, _ in nuove_verdi if c in m]
    foglio("Novità di oggi", novita)
    wb.save(XLSX)
    S.log(f"memoria: {len(m)} scuole · verdi {tot['verde']} · arancioni {tot['arancione']} · rossi {tot['rosso']} · recuperate oggi {len(nuove_verdi)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
