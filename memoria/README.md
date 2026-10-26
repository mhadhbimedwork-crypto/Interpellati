# memoria/ — la memoria del progetto Interpellati

**Da leggere per prima a ogni nuova sessione di lavoro sul progetto.** Contiene cosa sa il sistema di ogni scuola, come decide
dove leggere per primo e le prove che il metodo funziona.

## Cosa c'è
| File | Cosa fa |
|---|---|
| `modello.py` | Punteggio di lettura per scuola: `P_nuovo × P_ok × valore / costo`. P_nuovo = 1−e^(−λ·Δt) (processo di Poisson, λ con prior Gamma per gruppo tipo-istituto+regione, "restringimento" verso la media: empirical Bayes). P_ok = Beta con prior per IP. Costo = pagine da scaricare (feed RSS ≈ 2, sito ≈ 60, ×2 se IP lento). Valore ×3 per gli istituti B015/B017. |
| `aggiorna.py` | Ogni giorno unisce memoria_scuole, archivio avvisi, sonda feed, IP lenti, diagnosi errori → `memoria/stato/scuole.json` e `data/priorita_lettura.json` (prime 2.500 scuole). |
| `esperimenti.py` | Prova di superamento: simula giorno per giorno sui dati reali (senza guardare il futuro) il modello contro "casuale" e "round robin". Esce con errore se il modello non è più tempestivo. Risultati in `memoria/risultati/backtest.json`. |
| `stato/scuole.json` | Stato calcolato per scuola (avvisi, tentativi, feed, IP lento, ultima lettura). |
| `lezioni.md` | Cosa abbiamo imparato (cause degli errori, cosa ha funzionato, cosa no). Aggiornare a ogni scoperta. |

## Dati collegati (cartella `data/`)
`memoria_scuole.json` (stato per scuola), `memoria_progetto.json` (storico giornaliero e lezioni automatiche), `scuole_stato.json` (elenco per l'app),
`Elenco_scuole_Interpellati.xlsx` (Excel generale, verde/arancione/rosso), `cms_report.json` (feed RSS/ETag per scuola), `priorita_lettura.json`,
`diagnosi_errori.json`, `ip_lenti.json`, `classi_concorso.json` (catalogo ufficiale), `fonti_classi/` (testi delle fonti).

## Come si usa
- `python memoria/aggiorna.py` rigenera priorità e stato. `python memoria/esperimenti.py` rifà la prova (circa 1 minuto).
- Workflow `miglioramento-giornaliero.yml` (03:40 e 13:40 UTC): riprova le scuole in errore **nell'ordine di priorità**, poi memoria, Excel, priorità, prova.
- Ogni modifica a `modello.py` va verificata con `esperimenti.py` prima di essere salvata.

## Risultato della prova (26/10/2026, 2 settimane di storico)
Con 150–1.200 letture al giorno il modello trova più avvisi entro 1 giorno del round robin (con 1.200 letture/giorno: 79,6% contro 31,3%) e il
ritardo medio scende (1,2 contro 2,7 giorni). Con budget grandi perde meno dell'1% degli avvisi totali rispetto alla lettura a tappeto.
**Limiti dichiarati:** lo storico è di sole 2 settimane e contiene solo avvisi già scoperti dal sistema attuale (514 scuole su 7.780): la prova misura
quanto il modello recupera di quanto già trovato, non gli avvisi mai trovati. Va ripetuta man mano che lo storico cresce.

## Regole fisse (non cambiare)
Bot dichiarato · robots.txt rispettato · TLS attivo · nessun aggiramento dei limiti dei server (si rallenta) · dati personali dell'utente mai pubblici ·
solo avvisi reali, mai dati inventati (le regioni diventano verdi solo con letture vere).
