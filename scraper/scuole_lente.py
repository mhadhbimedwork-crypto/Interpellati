#!/usr/bin/env python3
"""Lettura delle scuole che stanno su server condivisi con limite di richieste (data/ip_lenti.json).
Ritmo adattivo per IP (scrape.RitmoIP: parte da 4 s, raddoppia se il gestore risponde 509/429, rilassa dopo 25 successi),
precedenza agli istituti B015/B017, rotazione con cursore. Scrive data/scuole/lente_{report,stato,trovati}.json."""
from __future__ import annotations
import json, os, sys, time
from datetime import date, datetime, timedelta
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scrape as S  # noqa: E402
import sicilia  # noqa: E402
import scuole_italia as SI  # noqa: E402
import priorita_b as PB  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "data" / "scuole"


def main() -> int:
    t0 = time.time()
    sh = (sys.argv[1] if len(sys.argv) > 1 else "0/1").split("/")
    i_sh, n_sh = int(sh[0]), int(sh[1])
    pre = "lente" if n_sh == 1 else f"lente{i_sh}"
    budget = int(os.environ.get("BUDGET_S", "2100"))
    try:
        lenti = json.loads((ROOT / "data" / "ip_lenti.json").read_text("utf-8"))["scuole"]
    except (OSError, ValueError, KeyError):
        S.log("ip_lenti.json assente: eseguire prima ip_lenti.py")
        return 1
    b = PB.codici_b()
    elenco = {}
    for area, (nome, sigle) in SI.AREE.items():
        sicilia.configura(area, tuple(sigle.split()), nome)
        elenco.update({c: v for c, v in sicilia.carica_elenco(S.log).items() if c in lenti})
    sicilia.ELENCO = ROOT / "data" / "sicilia_scuole.json"
    sicilia.CORRETTI = ROOT / "data" / "sicilia_siti_corretti.json"
    try:
        sc = sicilia._applica_correzioni(json.loads(sicilia.ELENCO.read_text("utf-8")).get("scuole", {}))
        elenco.update({c: v for c, v in sc.items() if c in lenti})
    except (OSError, ValueError):
        pass
    codici = sorted(c for c, v in elenco.items() if v.get("sito") and sum(map(ord, c)) % n_sh == i_sh)
    prio = [c for c in codici if c in b or any(x in b for x in elenco[c].get("sedi", []))]
    resto = [c for c in codici if c not in set(prio)]
    st_p, rep_p, tr_p = D / f"{pre}_stato.json", D / f"{pre}_report.json", D / f"{pre}_trovati.json"
    try:
        cur = int(json.loads(st_p.read_text("utf-8")).get("cursore", 0)) % max(1, len(resto))
    except (OSError, ValueError):
        cur = 0
    ordine = prio + resto[cur:] + resto[:cur]
    try:
        store = json.loads((ROOT / "data" / "interpelli.json").read_text("utf-8"))
        sicilia.KNOWN = {i.get("link") for i in store.get("interpelli", [])}
    except (OSError, ValueError):
        sicilia.KNOWN = set()
    sicilia.MAX_SOTTO = 2
    f = S.Fetcher()
    since = date.today() - timedelta(days=10)
    try:
        vecchio = json.loads(rep_p.read_text("utf-8")).get("scuole", {})
    except (OSError, ValueError):
        vecchio = {}
    trovati, fatte_resto = [], 0
    S.log(f"siti lenti: {len(codici)} scuole ({len(prio)} B015/B017 in precedenza)")

    def uno(c):
        return c, sicilia.scansiona_scuola(S, f, c, elenco[c], since)
    with ThreadPoolExecutor(8) as ex:
        for i in range(0, len(ordine), 24):
            if time.time() - t0 > budget:
                break
            blocco = ordine[i:i + 24]
            for c, (it, rep) in ex.map(uno, blocco):
                vecchio[c] = {**rep, "nome": elenco[c]["nome"]}
                trovati += it
                if c not in set(prio):
                    fatte_resto += 1
    ok = sum(1 for v in vecchio.values() if v.get("ok"))
    rep_p.write_text(json.dumps({"aggiornato": datetime.now().isoformat(timespec="seconds"), "area": "Server condivisi",
                                 "scuole": vecchio}, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")
    st_p.write_text(json.dumps({"cursore": (cur + fatte_resto) % max(1, len(resto)), "intervalli": {k: round(v, 1) for k, v in S.RitmoIP._int.items()}}) + "\n", "utf-8")
    try:
        vecchi = json.loads(tr_p.read_text("utf-8"))
    except (OSError, ValueError):
        vecchi = []
    limite = (date.today() - timedelta(days=4)).isoformat()
    per = {(i["link"], tuple(i["classi"])): i for i in vecchi if (i.get("_visto") or "") >= limite}
    ora = datetime.now().isoformat(timespec="seconds")
    for it in trovati:
        it["_visto"] = ora
        per[(it["link"], tuple(it["classi"]))] = it
    tr_p.write_text(json.dumps(list(per.values()), ensure_ascii=False, indent=0) + "\n", "utf-8")
    S.log(f"siti lenti: letti ok {ok}/{len(vecchio)} · avvisi trovati {len(trovati)} · intervalli {S.RitmoIP._int} · {int(time.time()-t0)}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
