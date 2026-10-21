/** Strumenti per l'utente: distanza da casa, promemoria delle scadenze, documenti da allegare, candidatura via mail. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as FS from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import * as MailComposer from 'expo-mail-composer';
import * as Notifications from 'expo-notifications';
import type { Interpello } from './feed';

/* ---------- casa e distanza ---------- */
export type Casa = { lat: number; lon: number; nome: string };
const K_CASA = 'casa';

export async function leggiCasa(): Promise<Casa | null> {
  try {
    const s = await AsyncStorage.getItem(K_CASA);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
export async function salvaCasa(c: Casa | null) {
  if (c) await AsyncStorage.setItem(K_CASA, JSON.stringify(c));
  else await AsyncStorage.removeItem(K_CASA);
}
/** Posizione attuale (approssimata), solo se l'utente lo chiede. Resta sul telefono. */
export async function casaDaGps(): Promise<Casa> {
  const p = await Location.requestForegroundPermissionsAsync();
  if (p.status !== 'granted') throw new Error('Permesso posizione negato');
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  let nome = 'Posizione attuale';
  try {
    const r = await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    if (r[0]) nome = [r[0].city || r[0].subregion, r[0].region].filter(Boolean).join(', ') || nome;
  } catch {}
  // arrotondata a ~1 km: non serve di piu' per calcolare la distanza
  return { lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100, nome };
}
/** Casa = capoluogo della provincia scelta, ricavato dagli avvisi con posizione «capoluogo». */
export function casaDaProvincia(prov: string, items: Interpello[]): Casa | null {
  const it = items.find((i) => i.provincia === prov && i.geo === 'p' && typeof i.lat === 'number');
  return it ? { lat: it.lat as number, lon: it.lon as number, nome: 'Provincia di ' + prov } : null;
}
export function km(casa: Casa | null, it: Interpello): number | null {
  if (!casa || typeof it.lat !== 'number' || typeof it.lon !== 'number') return null;
  const R = 6371, rad = Math.PI / 180;
  const dLat = (it.lat - casa.lat) * rad, dLon = ((it.lon as number) - casa.lon) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(casa.lat * rad) * Math.cos(it.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/* ---------- promemoria ---------- */
function quandoScade(it: Interpello): Date | null {
  if (!it.scadenza) return null;
  const [y, m, d] = it.scadenza.slice(0, 10).split('-').map(Number);
  if (!y) return null;
  let h = 23, mi = 59;
  const o = /^(\d{1,2})[:.](\d{2})/.exec(it.oraScadenza || '');
  if (o) { h = Number(o[1]); mi = Number(o[2]); }
  return new Date(y, m - 1, d, h, mi);
}
/** Avviso sul telefono prima della scadenza (di default 3 ore prima). */
export async function promemoria(it: Interpello, oreAnticipo = 3): Promise<string> {
  const s = quandoScade(it);
  if (!s) throw new Error("L'avviso non indica la scadenza: controllala sull'avviso ufficiale");
  const quando = new Date(s.getTime() - oreAnticipo * 3600_000);
  if (quando.getTime() <= Date.now() + 60_000) throw new Error('Scade tra meno di ' + oreAnticipo + ' ore: candidati adesso');
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Interpello in scadenza', body: (it.scuola || 'Interpello') + ' · ' + (it.classi || []).join('/') + ' — scade alle ' + s.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }), data: { id: it.id, link: it.link || '' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: quando },
  });
  return quando.toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
/** Apre il calendario del telefono con la scadenza gia' compilata (nessun permesso richiesto). */
export async function aggiungiAlCalendario(it: Interpello) {
  const s = quandoScade(it);
  if (!s) throw new Error("L'avviso non indica la scadenza");
  await Calendar.createEventInCalendarAsync({
    title: 'Scadenza interpello ' + (it.classi || []).join('/') + ' – ' + (it.scuola || ''),
    startDate: new Date(s.getTime() - 3600_000), endDate: s,
    notes: (it.link || '') + (it.email ? '\nInvio a: ' + it.email : ''),
    location: [it.comune, it.provincia].filter(Boolean).join(' '),
  });
}

/* ---------- documenti da allegare (restano sul telefono) ---------- */
export type Documento = { nome: string; uri: string; dimensione: number; allega: boolean };
const K_DOC = 'documenti';
const CARTELLA = (FS.documentDirectory || '') + 'documenti/';

export async function leggiDocumenti(): Promise<Documento[]> {
  try {
    const l: Documento[] = JSON.parse((await AsyncStorage.getItem(K_DOC)) || '[]');
    const out: Documento[] = [];
    for (const d of l) if ((await FS.getInfoAsync(d.uri)).exists) out.push(d);
    return out;
  } catch {
    return [];
  }
}
async function salvaDocumenti(l: Documento[]) {
  await AsyncStorage.setItem(K_DOC, JSON.stringify(l));
}
export async function aggiungiDocumenti(): Promise<Documento[]> {
  const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: ['application/pdf', 'image/*', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] });
  const l = await leggiDocumenti();
  if (r.canceled) return l;
  await FS.makeDirectoryAsync(CARTELLA, { intermediates: true }).catch(() => {});
  for (const a of r.assets) {
    const nome = a.name.replace(/[\\/:*?"<>|]/g, '_');
    const dest = CARTELLA + Date.now() + '_' + nome;
    await FS.copyAsync({ from: a.uri, to: dest });
    l.push({ nome, uri: dest, dimensione: a.size || 0, allega: true });
  }
  await salvaDocumenti(l);
  return l;
}
export async function rimuoviDocumento(uri: string): Promise<Documento[]> {
  await FS.deleteAsync(uri, { idempotent: true });
  const l = (await leggiDocumenti()).filter((d) => d.uri !== uri);
  await salvaDocumenti(l);
  return l;
}
export async function alternaAllegato(uri: string): Promise<Documento[]> {
  const l = (await leggiDocumenti()).map((d) => (d.uri === uri ? { ...d, allega: !d.allega } : d));
  await salvaDocumenti(l);
  return l;
}

/** Apre l'app di posta con destinatario, oggetto, testo e i documenti scelti gia' allegati. */
export async function inviaCandidatura(destinatario: string, oggetto: string, testo: string): Promise<'inviata' | 'salvata' | 'annullata' | 'aperta'> {
  if (!(await MailComposer.isAvailableAsync())) throw new Error("Nessuna app di posta configurata: usa «Copia testo»");
  const allegati = (await leggiDocumenti()).filter((d) => d.allega).map((d) => d.uri);
  const r = await MailComposer.composeAsync({ recipients: destinatario ? [destinatario] : [], subject: oggetto, body: testo, attachments: allegati });
  return (r.status as any) === 'sent' ? 'inviata' : (r.status as any) === 'saved' ? 'salvata' : (r.status as any) === 'cancelled' ? 'annullata' : 'aperta';
}
