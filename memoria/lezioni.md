# Lezioni apprese (da aggiornare a ogni scoperta)

- **509 (nginx, IP condivisi)**: limite per indirizzo IP, non per sito. Si cura con pause di 25–35 s e ritmo adattivo per IP (`scrape.RitmoIP`); leggere meno pagine per scuola riduce il problema alla radice.
- **503 «A breve on line»** (AWS, circa 400–660 scuole): sito non ancora pubblicato. Non è una lettura riuscita: la scuola resta rossa finché non c'è contenuto.
- **Domini inesistenti** (circa 490): provare Indice PA e le varianti www/http prima di dichiarare rosso. Solo 91 scuole hanno un dominio email proprio, quindi dall'email si recupera poco.
- **robots.txt che vieta il bot** (circa 144): si rispetta; gli avvisi si cercano su UST/USR e aggregatori.
- **Circolari con testo nell'allegato**: la pagina HTML ha solo il titolo; scadenza e «riservato agli interni» sono nel PDF/Word: `enrich()` legge fino a 2 allegati.
- **Esecuzioni programmate GitHub saltate** (ore senza giri): i workflow critici (B015/B017) si rilanciano da soli a fine giro.
- **Prove 26/10**: il modello di priorità con prior per gruppo e pavimento di esplorazione batte il round robin per tempestività; senza pavimento un gruppo senza scoperte veniva abbandonato (bug trovato dalla prova: 87 avvisi invece di 1.700).
- **Classi di concorso**: lista ufficiale = DPR 19/2016 + DM 259/2017 (Tabelle A e B); le sigle L-/LM- sono classi di laurea (titoli di accesso), non posti.
