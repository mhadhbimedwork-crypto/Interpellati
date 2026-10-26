"""Modello di priorità di lettura delle scuole.

Per ogni scuola s, ad ogni giro, si stima il VALORE ATTESO PER RICHIESTA di leggerla ora:

    punteggio(s) = P_nuovo(s) * P_ok(s) * valore(s) / costo(s)

  P_nuovo = 1 - exp(-lambda_s * dt)      probabilita' che dall'ultima lettura sia comparso almeno un avviso
                                         (processo di Poisson; lambda_s = avvisi/giorno, stimato con un prior Gamma
                                         che "restringe" le scuole con pochi dati verso la media del gruppo)
  P_ok    = (successi + a) / (tentativi + a + b)   probabilita' che la lettura riesca (prior Beta, gerarchico per IP:
                                         una scuola nuova su un IP che da' 509 parte con un prior pessimista)
  valore  = peso della domanda (classi seguite dagli utenti, es. B015/B017) * 1  (>=1)
  costo   = pagine da scaricare (1-2 se c'e' il feed RSS, ~60 altrimenti) con peso extra se l'IP e' lento

E' la regola indice dei problemi "restless bandit" (Whittle/Gittins semplificata): leggere ogni volta la scuola con
il miglior rapporto valore/costo, tenendo conto che il valore di una scuola ricresce col tempo (dt)."""
from __future__ import annotations
import math

# prior Gamma(a0, b0) per lambda (avvisi/giorno): media a0/b0 = 0.05/giorno (una scuola su 20 giorni) con peso di 20 giorni di osservazione
A0, B0 = 1.0, 20.0
# prior Beta per la riuscita della lettura
PA, PB = 2.0, 1.0
PAGINE_FEED, PAGINE_SITO = 2.0, 60.0


def gruppo_scuola(nome: str, regione: str = "") -> str:
    """Gruppo per il prior (empirical Bayes): tipo di istituto + regione. Le scuole di uno stesso tipo e zona pubblicano in modo simile."""
    n = (nome or "").upper().replace(".", " ").split()
    t = next((x for x in n[:3] if x in ("IC", "IIS", "ISIS", "IPSIA", "ITI", "ITIS", "ITT", "IPSSAR", "IPIA", "LICEO", "CPIA", "DD", "SMS", "ISTITUTO")), "ALTRO")
    if t in ("ISIS", "IIS", "ITI", "ITIS", "ITT", "IPSIA", "IPIA", "IPSSAR"):
        t = "SUPERIORE"
    return f"{t}|{regione}"


def lambda_stimato(n_avvisi: int, giorni_osservati: float, media_gruppo: float | None = None, peso: float = 20.0) -> float:
    """Media a posteriori del tasso (avvisi/giorno): (peso*media_gruppo + n) / (peso + T). Senza gruppo usa il prior generale."""
    if media_gruppo is None:
        return (A0 + n_avvisi) / (B0 + max(0.0, giorni_osservati))
    return (peso * max(media_gruppo, 1e-4) + n_avvisi) / (peso + max(0.0, giorni_osservati))


def p_nuovo(lmb: float, dt_giorni: float) -> float:
    return 1.0 - math.exp(-max(0.0, lmb) * max(0.0, dt_giorni))


def p_ok(successi: int, tentativi: int, prior_ip: float | None = None) -> float:
    a, b = (PA, PB) if prior_ip is None else (2 * prior_ip + 0.5, 2 * (1 - prior_ip) + 0.5)
    return (successi + a) / (tentativi + a + b)


def costo(ha_feed: bool, ip_lento: bool) -> float:
    c = PAGINE_FEED if ha_feed else PAGINE_SITO
    return c * (2.0 if ip_lento else 1.0)


def punteggio(s: dict, oggi_giorni: float, domanda: float = 1.0) -> float:
    """s: dict con avvisi, giorni_osservati, ultima_lettura_giorni (giorno assoluto o None), successi, tentativi, feed, ip_lento, prior_ip."""
    lmb = lambda_stimato(s.get("avvisi", 0), s.get("giorni_osservati", 0), s.get("media_gruppo"))
    ult = s.get("ultima_lettura_giorni")
    dt = (oggi_giorni - ult) if ult is not None else 30.0  # mai letta: la si considera "vecchia" di 30 giorni
    return p_nuovo(lmb, dt) * p_ok(s.get("successi", 0), s.get("tentativi", 0), s.get("prior_ip")) * domanda / costo(bool(s.get("feed")), bool(s.get("ip_lento")))


def ordina(scuole: dict[str, dict], oggi_giorni: float, domanda: dict[str, float] | None = None) -> list[tuple[str, float]]:
    domanda = domanda or {}
    out = [(c, punteggio(s, oggi_giorni, domanda.get(c, 1.0))) for c, s in scuole.items()]
    out.sort(key=lambda x: -x[1])
    return out
