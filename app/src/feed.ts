import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

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
  stato?: string;
  durata?: { tipo: string; dal?: string; al?: string; giorni?: number };
  durataCat?: 'breve' | 'intermedia' | 'fino_a_fine_anno' | 'indeterminata';
  oreEvidenza?: string;
  durataEvidenza?: string;
  tipoPosto?: string;
  candidatura?: string;
  codiceScuola?: string;
  lettoDa?: string;
};
export type Feed = { aggiornato?: string; fonti?: number; interpelli: Interpello[] };

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
  const res = await fetch(FEED_URL + '?t=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error('Server dati non raggiungibile (' + res.status + ')');
  const feed = (await res.json()) as Feed;
  if (!feed || !Array.isArray(feed.interpelli)) throw new Error('Dati non validi');
  await AsyncStorage.setItem(K_FEED, JSON.stringify(feed));
  return feed;
}

/** Returns the open interpelli never notified before, and marks them seen. */
export async function takeNew(feed: Feed, prefs?: Prefs): Promise<Interpello[]> {
  const p = prefs || (await loadPrefs());
  let seen: string[] = [];
  try {
    seen = JSON.parse((await AsyncStorage.getItem(K_SEEN)) || '[]');
  } catch {}
  const first = seen.length === 0;
  const fresh = feed.interpelli.filter((i) => isOpen(i) && !seen.includes(i.id) && matchPrefs(i, p));
  const all = Array.from(new Set([...seen, ...feed.interpelli.map((i) => i.id)])).slice(-2000);
  await AsyncStorage.setItem(K_SEEN, JSON.stringify(all));
  return first ? [] : fresh;
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
