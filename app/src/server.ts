/** Collegamento al server di Interpellati: ogni chiamata e' firmata con la chiave del telefono.
 *  Se nell'app non e' configurato un server (app.json -> extra.serverUrl) l'app funziona come prima. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { chiaveDisponibile, chiavePubblica, firma, idDispositivo } from '../modules/chiave-dispositivo';

export const SERVER_URL: string = ((Constants.expoConfig?.extra as any)?.serverUrl || '').replace(/\/$/, '');
export const VERSIONE: string = Constants.expoConfig?.version || '';
export const modalitaServer = () => !!SERVER_URL && chiaveDisponibile;

const K_REG = 'server.registrato';  // id del dispositivo registrato sul server
const K_STATO = 'server.stato';
const K_ETAG = 'server.etag';

export type Contatti = {
  nome?: string; email?: string; pec?: string; whatsapp?: string; telegram?: string; instagram?: string; facebook?: string;
  community?: { nome: string; link: string }[];
};
export type StatoServer = {
  dispositivo: string;
  stato: 'attivo' | 'attesa' | 'sospeso' | 'revocato' | 'scaduto' | 'spento' | 'gruppo_sospeso';
  classi: string[]; regioni: string[]; concorsi: boolean; piano: string; scadenza: string | null;
  gruppo: string | null; richiesta_aperta: boolean;
  contatti: Contatti; messaggio: string; versione_minima: string;
  sostegno: { testo: string; link: string }; trasparenza: { testo: string };
};

/** Hash SHA-256 (esadecimale) in puro JS: serve a firmare il corpo della richiesta. */
function sha256hex(testo: string): string {
  const b = utf8(testo);
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const l = b.length, nb = (((l + 9) >> 6) + 1) << 6;
  const m = new Uint8Array(nb);
  m.set(b);
  m[l] = 0x80;
  const bits = l * 8;
  m[nb - 4] = (bits >>> 24) & 255; m[nb - 3] = (bits >>> 16) & 255; m[nb - 2] = (bits >>> 8) & 255; m[nb - 1] = bits & 255;
  m[nb - 5] = Math.floor(bits / 2 ** 32) & 255;
  const w = new Uint32Array(64);
  const r = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < nb; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = (m[o + i * 4] << 24) | (m[o + i * 4 + 1] << 16) | (m[o + i * 4 + 2] << 8) | m[o + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, bb, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += bb; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return Array.from(H).map((x) => x.toString(16).padStart(8, '0')).join('');
}
function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00); }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}
export const _test = { sha256hex };

async function chiama(metodo: 'GET' | 'POST', percorso: string, dati?: unknown, extra?: Record<string, string>) {
  const corpo = dati === undefined ? '' : JSON.stringify(dati);
  const ts = String(Date.now());
  const msg = `${metodo}\n${percorso}\n${ts}\n${sha256hex(corpo)}`;
  const h: Record<string, string> = { 'x-ts': ts, 'x-firma': firma(msg), 'content-type': 'application/json', ...(extra || {}) };
  if (percorso !== '/v1/registra') h['x-dispositivo'] = idDispositivo();
  const res = await fetch(SERVER_URL + percorso, { method: metodo, headers: h, body: corpo || undefined });
  return res;
}

async function json(res: Response) {
  let d: any = null;
  try { d = await res.json(); } catch {}
  if (!res.ok) throw new Error(d?.detail || 'Errore del server (' + res.status + ')');
  return d;
}

/** Il telefono e' gia' registrato con la chiave attuale? (dopo un ripristino su un nuovo telefono la chiave cambia) */
export async function registrato(): Promise<boolean> {
  if (!modalitaServer()) return false;
  return (await AsyncStorage.getItem(K_REG)) === idDispositivo();
}

export async function registra(p: { codice?: string; classi: string[]; regioni?: string[]; provincia?: string; messaggio?: string }) {
  const d = await json(await chiama('POST', '/v1/registra', {
    chiave_pubblica: chiavePubblica(), codice: p.codice || null, classi: p.classi, regioni: p.regioni || [],
    provincia: p.provincia || null, messaggio: p.messaggio || '', piattaforma: 'android', versione: VERSIONE,
  }));
  await AsyncStorage.setItem(K_REG, d.dispositivo);
  return d as { dispositivo: string; stato: string };
}

export async function leggiStato(): Promise<StatoServer> {
  const d = (await json(await chiama('GET', '/v1/stato'))) as StatoServer;
  await AsyncStorage.setItem(K_STATO, JSON.stringify(d));
  return d;
}

export async function statoSalvato(): Promise<StatoServer | null> {
  try {
    const s = await AsyncStorage.getItem(K_STATO);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

/** Feed filtrato dal server per le classi/regioni abilitate. null = nessuna novita' (304). */
export async function feedServer(): Promise<{ aggiornato: string; interpelli: any[]; stato: string } | null> {
  const tag = (await AsyncStorage.getItem(K_ETAG)) || '';
  const res = await chiama('GET', '/v1/feed', undefined, tag ? { 'if-none-match': tag } : undefined);
  if (res.status === 304) return null;
  const d = await json(res);
  const nuovo = res.headers.get('etag');
  if (nuovo) await AsyncStorage.setItem(K_ETAG, nuovo);
  return d;
}

export const inviaRichiesta = async (classi: string[], regioni: string[], messaggio: string, concorsi = false) =>
  json(await chiama('POST', '/v1/richiesta', { classi, regioni, messaggio, concorsi }));
export const usaCodice = async (codice: string) => json(await chiama('POST', '/v1/codice', { codice }));
export const segnala = async (tipo: 'mancante' | 'errore', link: string, testo: string, interpello_id?: string) =>
  json(await chiama('POST', '/v1/segnala', { tipo, link, testo, interpello_id: interpello_id || null }));
export const inviaPushToken = async (token: string) => json(await chiama('POST', '/v1/push', { token }));

export function versioneVecchia(minima: string): boolean {
  if (!minima) return false;
  const a = VERSIONE.split('.').map(Number), b = minima.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  }
  return false;
}
