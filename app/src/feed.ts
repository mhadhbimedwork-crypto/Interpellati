import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { feedServer, modalitaServer, registrato } from './server';

export const FEED_URL =
  'https://raw.githubusercontent.com/mhadhbimedwork-crypto/Interpellati/main/data/feed.json';
export const TASK = 'interpellati-controllo';

export type Interpello = {
  id: string;
  classi: string[];
  scuola?: string;
  comune?: string;
  provincia?: string;
  regione?: string;
  pubblicato?: string;
  scadenza?: string;
  oraScadenza?: string;
  ore?: number;
  periodo?: string;
  email?: string;
  link?: string;
  fonte?: string;
  note?: string;
  trovato?: string;
  /** ora di pubblicazione dichiarata dal sito (HH:MM), solo quando disponibile */
  oraPub?: string;
  stato?: string;
  durata?: { tipo: string; dal?: string; al?: string; giorni?: number };
  durataCat?: 'breve' | 'intermedia' | 'fino_a_fine_anno' | 'indeterminata';
  oreEvidenza?: string;
  durataEvidenza?: string;
  tipoPosto?: string;
  candidatura?: string;
  codiceScuola?: string;
  lat?: number;
  lon?: number;
  /** i = indirizzo della scuola · c = centro del comune · p = capoluogo di provincia */
  geo?: 'i' | 'c' | 'p';
  indirizzo?: string;
  lettoDa?: string;
};
export type Feed = { aggiornato?: string; stato?: string; fonti?: number; sicilia?: { istituti: number; conSito: number; letti: number; errori: number; uffici: number } | null; interpelli: Interpello[] };

export const ABIL_URL =
  'https://raw.githubusercontent.com/mhadhbimedwork-crypto/Interpellati/main/data/abilitazioni.json';
export type Abilitazione = { id: string; titolo: string; link: string; fonte: string; itp?: boolean; paginaItp?: boolean; visto?: string };
export type AbilFeed = { aggiornato?: string; voci: Abilitazione[] };
const K_ABIL = 'abil.cache';
const K_ABIL_SEEN = 'abil.seen';

const K_FEED = 'feed.cache';
const K_SEEN = 'feed.seen';
const K_PREFS = 'prefs';

/* ---------- preferenze: qualsiasi classe di concorso, qualsiasi regione ---------- */
export type Prefs = { classi: string[]; regioni: string[] };
export const DEFAULT_PREFS: Prefs = { classi: ['B015', 'B017'], regioni: [] }; // regioni vuote = tutta Italia

export const REGIONI = [
  'Abruzzo', 'Basilicata', 'Calabria', 'Campania', 'Emilia-Romagna', 'Friuli Venezia Giulia', 'Lazio',
  'Liguria', 'Lombardia', 'Marche', 'Molise', 'Piemonte', 'Puglia', 'Sardegna', 'Sicilia', 'Toscana',
  "Trentino-Alto Adige", 'Umbria', "Valle d'Aosta", 'Veneto',
];

/** A26 / a-026 / ab 24 -> A026 / AB24 */
export function normClasse(raw: string): string {
  const c = raw.replace(/[-\s]/g, '').toUpperCase();
  const m = /^([AB])(\d{2})$/.exec(c);
  return m ? m[1] + '0' + m[2] : c;
}

export async function loadPrefs(): Promise<Prefs> {
  try {
    const s = await AsyncStorage.getItem(K_PREFS);
    if (s) {
      const p = JSON.parse(s);
      return {
        classi: Array.isArray(p.classi) ? p.classi.map(normClasse).filter(Boolean) : DEFAULT_PREFS.classi,
        regioni: Array.isArray(p.regioni) ? p.regioni : [],
      };
    }
  } catch {}
  return DEFAULT_PREFS;
}
export async function savePrefs(p: Prefs) {
  try {
    await AsyncStorage.setItem(K_PREFS, JSON.stringify(p));
  } catch {}
}
/** Classi vuote = tutte le classi; regioni vuote = tutta Italia. */
export function matchPrefs(it: Interpello, p: Prefs): boolean {
  if (p.classi.length && !(it.classi || []).some((c) => p.classi.includes(c))) return false;
  if (p.regioni.length && !(it.regione && p.regioni.includes(it.regione))) return false;
  return true;
}

export async function loadCachedFeed(): Promise<Feed | null> {
  try {
    const s = await AsyncStorage.getItem(K_FEED);
    return s ? (JSON.parse(s) as Feed) : null;
  } catch {
    return null;
  }
}

export async function fetchFeed(): Promise<Feed> {
  // Con il server attivo i dati arrivano filtrati per questo telefono (richiesta firmata con la sua chiave)
  if (modalitaServer() && (await registrato())) {
    const d = await feedServer();
    if (d === null) {
      const c = await loadCachedFeed();
      if (c) return c;
      throw new Error('Nessun dato salvato');
    }
    const f: Feed = { aggiornato: d.aggiornato, interpelli: d.interpelli, stato: d.stato } as Feed;
    await AsyncStorage.setItem(K_FEED, JSON.stringify(f));
    return f;
  }
  const res = await fetch(FEED_URL + '?t=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error('Server dati non raggiungibile (' + res.status + ')');
  const feed = (await res.json()) as Feed;
  if (!feed || !Array.isArray(feed.interpelli)) throw new Error('Dati non validi');
  await AsyncStorage.setItem(K_FEED, JSON.stringify(feed));
  return feed;
}

export async function loadCachedAbil(): Promise<AbilFeed | null> {
  try {
    const s = await AsyncStorage.getItem(K_ABIL);
    return s ? (JSON.parse(s) as AbilFeed) : null;
  } catch {
    return null;
  }
}

export async function fetchAbil(): Promise<AbilFeed> {
  const res = await fetch(ABIL_URL + '?t=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error('Elenco abilitazioni non raggiungibile (' + res.status + ')');
  const d = (await res.json()) as AbilFeed;
  if (!d || !Array.isArray(d.voci)) throw new Error('Dati non validi');
  await AsyncStorage.setItem(K_ABIL, JSON.stringify(d));
  return d;
}

/* ---------- MEMORIA (v2): cosa l'app ti ha proposto e notificato ----------
 * Una voce per ogni avviso mai visto: v = prima volta proposto, n = quando e' stata inviata la notifica.
 * Nessun limite di lunghezza (il vecchio elenco si tagliava a 2000 voci e, col feed da 4000+ avvisi,
 * dimenticava gli avvisi aperti: per questo arrivavano sempre le stesse notifiche). */
export type Mem = Record<string, { v: string; n?: string }>;
const K_MEM = 'memoria.v2';
export const memCache: Mem = {};
let lock: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const r = lock.then(fn, fn);
  lock = r.catch(() => {});
  return r;
}
async function loadMem(): Promise<Mem | null> {
  try {
    const s = await AsyncStorage.getItem(K_MEM);
    return s ? (JSON.parse(s) as Mem) : null;
  } catch {
    return null;
  }
}
async function saveMem(m: Mem, ids: Set<string>) {
  const lim = Date.now() - 180 * 86400000;
  for (const k of Object.keys(m)) if (k[0] !== '~' && !ids.has(k) && new Date(m[k].v).getTime() < lim) delete m[k];
  Object.keys(memCache).forEach((k) => delete memCache[k]);
  Object.assign(memCache, m);
  await AsyncStorage.setItem(K_MEM, JSON.stringify(m));
}
export async function loadMemCache() {
  const m = await loadMem();
  if (m) Object.assign(memCache, m);
}
export function memStats(): { proposti: number; notificati: number } {
  const v = Object.entries(memCache).filter(([k]) => k[0] !== '~' && k.startsWith('i:')).map(([, x]) => x);
  return { proposti: v.length, notificati: v.filter((x) => x.n).length };
}
/** Restituisce gli avvisi davvero nuovi (mai visti prima) e li ricorda. Una sola esecuzione alla volta. */
function takeNewMem<T extends { id: string }>(all: T[], want: (x: T) => boolean, prefix: string): Promise<T[]> {
  return serial(async () => {
    const now = new Date().toISOString();
    let m = await loadMem();
    if (!m) m = {};
    const marker = '~' + prefix;
    const primo = !m[marker]; // primo avvio di questo elenco nella memoria v2: segna tutto come gia' proposto, senza notificare
    if (primo) {
      m[marker] = { v: now };
      // eredita il vecchio elenco "visti" (anche se tagliato) per non notificare di nuovo cose note
      try {
        for (const id of JSON.parse((await AsyncStorage.getItem(prefix === 'i:' ? K_SEEN : K_ABIL_SEEN)) || '[]')) m[prefix + id] = { v: now };
      } catch {}
    }
    const fresh: T[] = [];
    for (const x of all) {
      const key = prefix + x.id;
      if (m[key]) continue;
      m[key] = { v: now };
      if (!primo && want(x)) {
        m[key].n = now;
        fresh.push(x);
      }
    }
    await saveMem(m, new Set(all.map((x) => prefix + x.id)));
    return fresh;
  });
}

/** Nuovi bandi di abilitazione mai visti. */
export async function takeNewAbil(d: AbilFeed): Promise<Abilitazione[]> {
  return takeNewMem(d.voci, () => true, 'a:');
}

export async function notifyAbil(items: Abilitazione[]) {
  for (const v of items.slice(0, 3)) {
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Bando abilitazione' + (v.itp ? ' (ITP)' : ''), body: v.titolo.slice(0, 120) + ' — ' + v.fonte, data: { id: v.id } },
      trigger: null,
    });
  }
}

/** Interpelli aperti che corrispondono alle tue preferenze e che non ti sono mai stati proposti prima. */
export async function takeNew(feed: Feed, prefs?: Prefs): Promise<Interpello[]> {
  const p = prefs || (await loadPrefs());
  return takeNewMem(feed.interpelli, (i) => isOpen(i) && matchPrefs(i, p), 'i:');
}

export async function notifyNew(items: Interpello[]) {
  for (const it of items.slice(0, 5)) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Nuovo interpello ' + it.classi.join(' / '),
        body: [it.scuola, it.provincia ? '(' + it.provincia + ')' : '', it.scadenza ? '· scade ' + fmtDate(it.scadenza) : '']
          .filter(Boolean)
          .join(' '),
        data: { id: it.id },
      },
      trigger: null,
    });
  }
  if (items.length > 5) {
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Interpellati', body: 'Altri ' + (items.length - 5) + ' nuovi interpelli' },
      trigger: null,
    });
  }
}

TaskManager.defineTask(TASK, async () => {
  try {
    const feed = await fetchFeed();
    const fresh = await takeNew(feed);
    if (fresh.length) await notifyNew(fresh);
    try {
      const nuoviAb = await takeNewAbil(await fetchAbil());
      if (nuoviAb.length) await notifyAbil(nuoviAb);
    } catch {}
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackground() {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
    if (!(await TaskManager.isTaskRegisteredAsync(TASK))) {
      await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 30 });
    }
    return true;
  } catch {
    return false;
  }
}

/* ---------- helpers condivisi ---------- */
export function parseDate(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(String(s).slice(0, 10) + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}
export function daysLeft(d: Date | null): number | null {
  if (!d) return null;
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}
export function isOpen(it: Interpello): boolean {
  if (it.stato === 'chiuso') return false;
  const d = parseDate(it.scadenza);
  if (d) return (daysLeft(d) as number) >= 0;
  const p = parseDate(it.pubblicato);
  return p ? (daysLeft(p) as number) >= -3 : false;
}
export function isNew(it: Interpello): boolean {
  const t = it.trovato ? new Date(it.trovato) : parseDate(it.pubblicato);
  return t ? Date.now() - t.getTime() < 86400000 * 1.05 : false;
}
const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
export function fmtDate(s?: string | Date | null): string {
  const d = s instanceof Date ? s : parseDate(s || undefined);
  if (!d) return '';
  return d.getDate() + ' ' + MESI[d.getMonth()] + ' ' + d.getFullYear();
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** "oggi alle 09:11" / "ieri alle 21:40" / "19 ott alle 07:05" */
export function fmtRilevato(it: Interpello, now: Date = new Date()): string {
  if (!it.trovato) return '';
  const d = new Date(it.trovato);
  if (isNaN(d.getTime())) return '';
  const hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  const g0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const g1 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((g0 - g1) / 86400000);
  const giorno = diff === 0 ? 'oggi' : diff === 1 ? 'ieri' : d.getDate() + ' ' + MESI[d.getMonth()];
  return giorno + ' alle ' + hm;
}
/** "12 min fa", "3 ore fa", "2 giorni fa" */
export function fmtFa(it: Interpello, now: Date = new Date()): string {
  if (!it.trovato) return '';
  const m = Math.round((now.getTime() - new Date(it.trovato).getTime()) / 60000);
  if (isNaN(m) || m < 0) return '';
  if (m < 2) return 'ora';
  if (m < 60) return m + ' min fa';
  if (m < 1440) return Math.floor(m / 60) + (m < 120 ? ' ora fa' : ' ore fa');
  const g = Math.floor(m / 1440);
  return g + (g === 1 ? ' giorno fa' : ' giorni fa');
}
/** "21 ott 2026" + " ore 10:15" se il sito dichiara l'ora */
export function fmtPubblicato(it: Interpello): string {
  if (!it.pubblicato) return '';
  return fmtDate(it.pubblicato) + (it.oraPub ? ' ore ' + it.oraPub : '');
}
