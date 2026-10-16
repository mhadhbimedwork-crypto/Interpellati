# Interpellati

Monitoraggio automatico degli **interpelli per supplenze ITP B015 e B017** in tutta Italia, con app Android.

## Come funziona

| Pezzo | Dove | Cosa fa |
|---|---|---|
| `scraper/scrape.py` | GitHub Actions, ogni 2 ore dalle 7 alle 21 | Legge gli elenchi giornalieri e le pagine interpelli degli uffici scolastici, tiene solo B015/B017, aggiorna `data/interpelli.json` |
| `app/` | telefono Android | Legge `data/interpelli.json`, filtra per classe e regione, prepara la mail di candidatura, tiene lo storico delle candidature e il profilo per i moduli, notifica i nuovi interpelli (controllo in background ogni ~30 min) |
| `.github/workflows/build-apk.yml` | GitHub Actions | Compila l'APK a ogni modifica dell'app e lo pubblica nella release **apk** |

## Installare l'app

1. Dal telefono apri **Releases → apk** di questo repository e scarica `Interpellati.apk`.
2. Apri il file e consenti l'installazione da questa fonte.
3. Al primo avvio consenti le notifiche.

Il profilo e le candidature restano solo sul telefono: nel repository ci sono solo avvisi pubblici delle scuole.

## Aggiungere una fonte

Aggiungi un ufficio in `scraper/sources.json` (`nome`, `provincia`, `url` della pagina interpelli). Lo scraper rispetta `robots.txt` e fa al massimo una richiesta al secondo per sito.
