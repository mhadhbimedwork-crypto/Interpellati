// Aggiornamento dentro l'app: controlla l'ultima build pubblicata, scarica l'APK e apre l'installazione.
// Android chiede sempre una conferma (un tocco su «Installa»): non esiste un aggiornamento completamente silenzioso
// fuori da Google Play. L'APK ha la stessa firma, quindi si installa sopra senza disinstallare e senza perdere i dati.
import Constants from 'expo-constants';
import * as FS from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

const REPO = 'mhadhbimedwork-crypto/Interpellati';
export const APK_URL = `https://github.com/${REPO}/releases/download/apk/Interpellati.apk`;

export function buildInstallata(): number {
  return Number((Constants.expoConfig as any)?.android?.versionCode ?? 0) || 0;
}

/** Numero dell'ultima build pubblicata (scritto nelle note della release dal workflow), 0 se non leggibile. */
export async function buildDisponibile(): Promise<number> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/apk`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`Controllo non riuscito (${r.status})`);
  const j = await r.json();
  const m = /build=(\d+)/.exec(String(j.body || ''));
  return m ? Number(m[1]) : 0;
}

/** Scarica l'APK nella cache dell'app e apre il programma di installazione di Android. */
export async function scaricaEInstalla(onProgress: (perc: number) => void): Promise<void> {
  if (Platform.OS !== 'android') throw new Error("L'aggiornamento interno funziona solo su Android");
  const dest = (FS.cacheDirectory || '') + 'Interpellati-aggiornamento.apk';
  await FS.deleteAsync(dest, { idempotent: true });
  const dl = FS.createDownloadResumable(APK_URL, dest, {}, (p) => {
    if (p.totalBytesExpectedToWrite > 0) onProgress(Math.round((100 * p.totalBytesWritten) / p.totalBytesExpectedToWrite));
  });
  const res = await dl.downloadAsync();
  if (!res || res.status !== 200) throw new Error(`Download non riuscito (${res?.status ?? 'nessuna risposta'})`);
  const info = await FS.getInfoAsync(dest);
  if (!info.exists || (info as any).size < 10_000_000) throw new Error('File scaricato incompleto');
  const uri = await FS.getContentUriAsync(dest);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: uri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: 'application/vnd.android.package-archive',
  });
}
