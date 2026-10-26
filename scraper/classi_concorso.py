#!/usr/bin/env python3
"""Catalogo delle classi di concorso e dei posti (DPR 19/2016 come modificato dal DM 259/2017: Tabelle A e B, varianti
linguistiche e di strumento, sostegno, infanzia/primaria, religione, profili ATA). Genera data/classi_concorso.json e
app/src/classi.ts. Le denominazioni vengono dall'Allegato 5 al DPR 19/2016 e dal testo del DM 259/2017 (data/fonti_classi/)."""
from __future__ import annotations
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

TAB_A = """A001|Arte e immagine nella scuola secondaria di I grado
A002|Design dei metalli, dell'oreficeria, delle pietre dure e delle gemme
A003|Design della ceramica
A004|Design del libro
A005|Design del tessuto e della moda
A006|Design del vetro
A007|Discipline audiovisive
A008|Discipline geometriche, architettura, design d'arredamento e scenotecnica
A009|Discipline grafiche, pittoriche e scenografiche
A010|Discipline grafico-pubblicitarie
A011|Discipline letterarie e latino
A012|Discipline letterarie negli istituti di istruzione secondaria di II grado
A013|Discipline letterarie, latino e greco
A014|Discipline plastiche, scultoree e scenoplastiche
A015|Discipline sanitarie
A016|Disegno artistico e modellazione odontotecnica
A017|Disegno e storia dell'arte negli istituti di istruzione secondaria di II grado
A018|Filosofia e scienze umane
A019|Filosofia e storia
A020|Fisica
A021|Geografia
A022|Italiano, storia, geografia nella scuola secondaria di I grado
A023|Lingua italiana per discenti di lingua straniera (alloglotti)
A026|Matematica
A027|Matematica e fisica
A028|Matematica e scienze
A029|Musica negli istituti di istruzione secondaria di II grado
A030|Musica nella scuola secondaria di I grado
A031|Scienze degli alimenti
A032|Scienze della geologia e della mineralogia
A033|Scienze e tecnologie aeronautiche
A034|Scienze e tecnologie chimiche
A035|Scienze e tecnologie della calzatura e della moda
A036|Scienze e tecnologie della logistica
A037|Scienze e tecnologie delle costruzioni, tecnologie e tecniche di rappresentazione grafica
A038|Scienze e tecnologie delle costruzioni aeronautiche
A039|Scienze e tecnologie delle costruzioni navali
A040|Scienze e tecnologie elettriche ed elettroniche
A041|Scienze e tecnologie informatiche
A042|Scienze e tecnologie meccaniche
A043|Scienze e tecnologie nautiche
A044|Scienze e tecnologie tessili, dell'abbigliamento e della moda
A045|Scienze economico-aziendali
A046|Scienze giuridico-economiche
A047|Scienze matematiche applicate
A048|Scienze motorie e sportive negli istituti di istruzione secondaria di II grado
A049|Scienze motorie e sportive nella scuola secondaria di I grado
A050|Scienze naturali, chimiche e biologiche
A051|Scienze, tecnologie e tecniche agrarie
A052|Scienze, tecnologie e tecniche di produzioni animali
A053|Storia della musica
A054|Storia dell'arte
A055|Strumento musicale negli istituti di istruzione secondaria di II grado
A056|Strumento musicale nella scuola secondaria di I grado
A057|Tecnica della danza classica
A058|Tecnica della danza contemporanea
A059|Tecniche di accompagnamento alla danza e teoria e pratica musicale per la danza
A060|Tecnologia nella scuola secondaria di I grado
A061|Tecnologie e tecniche delle comunicazioni multimediali
A062|Tecnologie e tecniche per la grafica
A063|Tecnologie musicali
A064|Teoria, analisi e composizione
A065|Teoria e tecnica della comunicazione
A066|Trattamento testi, dati ed applicazioni. Informatica
A070|Italiano nella scuola secondaria di I grado con lingua di insegnamento slovena
A071|Sloveno, storia ed educazione civica, geografia nella scuola secondaria di I grado con lingua di insegnamento slovena"""

TAB_B = """B001|Attività pratiche speciali
B003|Laboratori di fisica
B004|Laboratori di liuteria
B006|Laboratorio di odontotecnica
B007|Laboratorio di ottica
B008|Laboratori di produzioni industriali ed artigianali della ceramica
B009|Laboratori di scienze e tecnologie aeronautiche
B010|Laboratori di scienze e tecnologie delle costruzioni aeronautiche
B011|Laboratori di scienze e tecnologie agrarie
B012|Laboratori di scienze e tecnologie chimiche e microbiologiche
B014|Laboratori di scienze e tecnologie delle costruzioni
B015|Laboratori di scienze e tecnologie elettriche ed elettroniche
B016|Laboratori di scienze e tecnologie informatiche
B017|Laboratori di scienze e tecnologie meccaniche
B018|Laboratori di scienze e tecnologie tessili, dell'abbigliamento e della moda
B019|Laboratori di servizi di ricettività alberghiera
B020|Laboratori di servizi enogastronomici, settore cucina
B021|Laboratori di servizi enogastronomici, settore sala e vendita
B022|Laboratori di tecnologie e tecniche delle comunicazioni multimediali
B023|Laboratori per i servizi socio-sanitari
B024|Laboratorio di scienze e tecnologie nautiche
B025|Laboratorio di scienze e tecnologie delle costruzioni navali
B026|Laboratorio di tecnologie del legno
B027|Laboratorio di tecnologie del marmo
B028|Laboratorio di tecnologie orafe
B029|Gabinetto fisioterapico
B030|Addetto all'ufficio tecnico (ad esaurimento)
B031|Esercitazioni pratiche per centralinisti telefonici (ad esaurimento)
B032|Esercitazioni di pratica professionale (ad esaurimento)"""

LINGUE_24 = {"AA": "Francese", "AB": "Inglese", "AC": "Spagnolo", "AD": "Tedesco", "AE": "Russo", "AF": "Albanese", "AG": "Sloveno", "AH": "Serbocroato"}
LINGUE_25 = {k: v for k, v in LINGUE_24.items() if k in ("AA", "AB", "AC", "AD", "AE", "AF")}
STRUMENTI = {"AA": "Arpa", "AB": "Chitarra", "AC": "Clarinetto", "AD": "Corno", "AE": "Fagotto", "AF": "Fisarmonica", "AG": "Flauto",
             "AH": "Oboe", "AI": "Percussioni", "AJ": "Pianoforte", "AK": "Saxofono", "AL": "Tromba", "AM": "Violino", "AN": "Violoncello"}
CONV = {"BA": "Francese", "BB": "Inglese", "BC": "Spagnolo", "BD": "Tedesco", "BE": "Russo", "BF": "Albanese", "BG": "Sloveno", "BH": "Serbocroato"}

FISSE = [
    ("AAAA", "Posto comune scuola dell'infanzia", "Infanzia e primaria"),
    ("EEEE", "Posto comune scuola primaria", "Infanzia e primaria"),
    ("EEEM", "Scuola primaria (variante indicata da alcune scuole)", "Infanzia e primaria"),
    ("ADAA", "Sostegno scuola dell'infanzia", "Sostegno"),
    ("ADEE", "Sostegno scuola primaria", "Sostegno"),
    ("ADMM", "Sostegno scuola secondaria di I grado", "Sostegno"),
    ("ADSS", "Sostegno scuola secondaria di II grado", "Sostegno"),
    ("IRC", "Insegnamento della religione cattolica", "Religione"),
    ("CS", "Collaboratore scolastico", "Personale ATA"),
    ("AA", "Assistente amministrativo", "Personale ATA"),
    ("AT", "Assistente tecnico", "Personale ATA"),
    ("CR", "Cuoco", "Personale ATA"),
    ("GA", "Guardarobiere", "Personale ATA"),
    ("IF", "Infermiere", "Personale ATA"),
    ("AR", "Addetto alle aziende agrarie", "Personale ATA"),
    ("DSGA", "Direttore dei servizi generali e amministrativi", "Personale ATA"),
]


def costruisci() -> list[dict]:
    out: list[dict] = []

    def add(cod: str, nome: str, gruppo: str):
        alias = re.sub(r"^([A-Z]{1,2})(\d{2,3})$", lambda m: f"{m[1]}-{int(m[2]):02d}" if len(m[2]) == 3 else f"{m[1]}-{m[2]}", cod)
        out.append({"codice": cod, "alias": alias, "nome": nome, "gruppo": gruppo})
    for r in TAB_A.splitlines():
        c, n = r.split("|")
        add(c, n, "Classi di concorso (Tabella A)")
    for k, v in LINGUE_24.items():
        add(f"{k}24", f"Lingue e culture straniere negli istituti di istruzione secondaria di II grado – {v}", "Lingue straniere")
    for k, v in LINGUE_25.items():
        add(f"{k}25", f"Lingua inglese e seconda lingua comunitaria nella scuola secondaria di I grado – {v}", "Lingue straniere")
    for k, v in STRUMENTI.items():
        add(f"{k}56", f"Strumento musicale nella scuola secondaria di I grado – {v}", "Strumento musicale")
    for r in TAB_B.splitlines():
        c, n = r.split("|")
        add(c, n, "Insegnanti tecnico-pratici (Tabella B)")
    for k, v in CONV.items():
        add(f"{k}02", f"Conversazione in lingua straniera – {v}", "Conversazione in lingua straniera")
    for c, n, g in FISSE:
        out.append({"codice": c, "alias": c, "nome": n, "gruppo": g})
    return out


def main() -> int:
    voci = costruisci()
    (ROOT / "data" / "classi_concorso.json").write_text(json.dumps({"fonte": "DPR 19/2016, DM 259/2017 (Tabelle A e B), Allegato 5; profili ATA", "voci": voci}, ensure_ascii=False, indent=0) + "\n", "utf-8")
    ts = "// Generato da scraper/classi_concorso.py: non modificare a mano.\nexport const CLASSI_CATALOGO: { codice: string; alias: string; nome: string; gruppo: string }[] = " + json.dumps(voci, ensure_ascii=False) + ";\n"
    (ROOT / "app" / "src" / "classi.ts").write_text(ts, "utf-8")
    print(len(voci), "voci")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
