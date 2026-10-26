#!/usr/bin/env python3
"""Prove di superamento: il modello di priorità deve battere le strategie semplici sui dati REALI dell'archivio.

Simulazione sequenziale (nessuna informazione dal futuro): ogni giorno, con un budget di K letture al giorno, una strategia
sceglie quali scuole leggere; un avviso pubblicato il giorno d in una scuola viene scoperto alla prima lettura di quella
scuola a partire da d. Metriche: % di avvisi scoperti entro 1 giorno, ritardo medio (giorni), avvisi mai scoperti.
Strategie: casuale · round robin (la meno recente per prima, e' quella usata finora) · priorita' (memoria.modello).
Esce con codice 1 se la priorita' non batte il round robin: cosi' ogni modifica del modello e' verificata."""
from __future__ import annotations
import json, math, random, sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from memoria import modello as M  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
G0 = date(2026, 1, 1).toordinal()


def carica():
    arch = json.loads((ROOT / "data" / "interpelli.json").read_text("utf-8"))["interpelli"]
    ev = defaultdict(list)
    for i in arch:
        if i.get("codiceScuola") and i.get("pubblicato"):
            ev[i["codiceScuola"]].append(date.fromisoformat(i["pubblicato"][:10]).toordinal() - G0)
    return ev


def simula(strategia: str, ev: dict, scuole: list[str], K: int, g_ini: int, g_fin: int, seed: int = 1, grp: dict | None = None):
    rnd = random.Random(seed)
    ult = {s: None for s in scuole}
    visti = {s: 0 for s in scuole}          # avvisi gia' scoperti (stima di lambda: solo passato)
    scoperti = {}                            # (scuola, giorno_pubblicazione, k) -> giorno_scoperta
    attese = {s: sorted(ev.get(s, [])) for s in scuole}
    for g in range(g_ini, g_fin + 1):
        if strategia == "casuale":
            scelte = rnd.sample(scuole, min(K, len(scuole)))
        elif strategia == "round_robin":
            scelte = sorted(scuole, key=lambda s: (ult[s] if ult[s] is not None else -10**6, s))[:K]
        else:
            T = g - g_ini
            gv, gn = defaultdict(int), defaultdict(int)
            for s in scuole:
                gv[grp[s]] += visti[s]; gn[grp[s]] += 1
            glob = sum(gv.values()) / max(1, len(scuole)) / max(1, T) if T > 0 else None
            # media del gruppo con "restringimento" verso la media generale e un pavimento: nessun gruppo viene mai abbandonato (esplorazione)
            media = {k: (None if glob is None else max(1.0 * glob, ((gv[k] / max(1, T)) + 30 * glob) / (gn[k] + 30))) for k in gn}
            stato = {s: {"avvisi": visti[s], "giorni_osservati": T, "ultima_lettura_giorni": ult[s], "successi": 5, "tentativi": 6,
                         "media_gruppo": media[grp[s]]} for s in scuole}
            scelte = [c for c, _ in M.ordina(stato, g)[:K]]
        for s in scelte:
            for d in attese[s]:
                if d <= g and (s, d) not in scoperti:
                    scoperti[(s, d)] = g
                    visti[s] += 1
            ult[s] = g
    tot = sum(len(attese[s]) for s in scuole if attese[s])
    # nota: solo avvisi pubblicati nella finestra di simulazione
    cons = [(s, d) for s in scuole for d in attese[s] if g_ini <= d <= g_fin]
    ritardi = [scoperti[k] - k[1] for k in cons if k in scoperti]
    return {"avvisi": len(cons), "scoperti": len(ritardi), "mai_scoperti": len(cons) - len(ritardi),
            "entro_1_giorno": round(100 * sum(1 for r in ritardi if r <= 1) / max(1, len(cons)), 1),
            "ritardo_medio_giorni": round(sum(ritardi) / max(1, len(ritardi)), 2)}


def main() -> int:
    ev = carica()
    memm = json.loads((ROOT / "data" / "memoria_scuole.json").read_text("utf-8"))["scuole"]
    scuole = sorted(memm)                    # tutte le ~7.780 scuole: la maggior parte non ha avvisi noti (e' il caso reale)
    grp = {c: M.gruppo_scuola(e.get("nome", ""), e.get("regione", "")) for c, e in memm.items()}
    giorni = [d for v in ev.values() for d in v]
    g_ini, g_fin = min(giorni), max(giorni)
    risultati = {"finestra": [str(date.fromordinal(g_ini + G0)), str(date.fromordinal(g_fin + G0))], "scuole": len(scuole), "prove": {}}
    ok = True
    for K in (150, 300, 600, 1200):
        r = {s: simula(s, ev, scuole, K, g_ini, g_fin, grp=grp) for s in ("casuale", "round_robin", "priorita")}
        risultati["prove"][f"budget_{K}_letture_al_giorno"] = r
        # prova di superamento: piu' tempestivo del round robin (ritardo medio e % entro 1 giorno) senza perdere piu' del 2% degli avvisi
        p, rr = r["priorita"], r["round_robin"]
        if not (p["ritardo_medio_giorni"] < rr["ritardo_medio_giorni"] and p["entro_1_giorno"] > rr["entro_1_giorno"] and p["scoperti"] >= 0.98 * rr["scoperti"]):
            ok = False
        print(K, {k: (v["scoperti"], v["entro_1_giorno"], v["ritardo_medio_giorni"]) for k, v in r.items()})
    risultati["superata"] = ok
    risultati["limiti"] = "Storico di sole 2 settimane e solo avvisi gia' scoperti dal sistema attuale: il confronto misura quanto il modello recupera di quanto gia' trovato, non gli avvisi mai trovati."
    (ROOT / "memoria" / "risultati" / "backtest.json").write_text(json.dumps(risultati, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print("PROVA SUPERATA" if ok else "PROVA NON SUPERATA")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
