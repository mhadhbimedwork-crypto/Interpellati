import csv, io, requests, sys, json
UA = "Interpellati/1.0 (uso personale; monitoraggio avvisi pubblici)"
base = "https://dati.istruzione.it/opendata/opendata/catalogo/elements1/"
for nome in ["SCUANAGRAFESTAT20262720260901", "SCUANAGRAFEPAR20262720260901", "SCUANAAUTSTAT20262720260901"]:
    r = requests.get(base + nome + ".csv", headers={"User-Agent": UA}, timeout=120)
    print("==", nome, r.status_code, len(r.content), r.headers.get("content-type"))
    if r.status_code != 200:
        continue
    for enc in ("utf-8-sig", "latin-1"):
        try:
            t = r.content.decode(enc); break
        except UnicodeDecodeError:
            continue
    print("enc", enc)
    print(t[:1500])
    rows = list(csv.DictReader(io.StringIO(t)))
    print("righe", len(rows), "colonne", list(rows[0].keys()))
