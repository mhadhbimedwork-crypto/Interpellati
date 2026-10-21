import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as Notifications from 'expo-notifications';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  useColorScheme,
  View,
} from 'react-native';
import {
  DEFAULT_PREFS,
  loadPrefs,
  matchPrefs,
  normClasse,
  Prefs,
  REGIONI,
  savePrefs,
  daysLeft,
  fetchFeed,
  fetchAbil,
  loadCachedAbil,
  takeNewAbil,
  notifyAbil,
  type AbilFeed,
  Feed,
  fmtDate,
  fmtFa,
  fmtPubblicato,
  fmtRilevato,
  Interpello,
  isNew,
  isOpen,
  loadCachedFeed,
  parseDate,
  registerBackground,
  takeNew,
  notifyNew,
  loadMemCache,
  memStats,
} from './src/feed';
import { conCoordinate, MappaInterpelli } from './src/MapView';
import {
  inviaRichiesta, leggiStato, modalitaServer, registra, registrato, segnala, statoSalvato, usaCodice, versioneVecchia,
  type StatoServer,
} from './src/server';
import {
  aggiungiAlCalendario, aggiungiDocumenti, alternaAllegato, casaDaGps, casaDaProvincia, inviaCandidatura, km, leggiCasa,
  leggiDocumenti, promemoria, rimuoviDocumento, salvaCasa, type Casa, type Documento,
} from './src/strumenti';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type Stato = '' | 'inviata' | 'convocato' | 'scartata';
type Cand = { stato: Stato; inviataIl?: string; note?: string };
type Tab = 'interpelli' | 'mappa' | 'abilitazione' | 'candidature' | 'preferenze' | 'profilo' | 'aiuto';

const CLASSI_COMUNI: [string, string][] = [
  ['B015', 'ITP elettrica'], ['B017', 'ITP meccanica'], ['B012', 'ITP chimica'], ['B016', 'ITP informatica'],
  ['A040', 'Elettrotecnica'], ['A041', 'Informatica'], ['A042', 'Meccanica'], ['A026', 'Matematica'],
  ['A027', 'Matem. e fisica'], ['A050', 'Scienze'], ['A012', 'Lettere sup.'], ['A022', 'Lettere medie'],
  ['AB24', 'Inglese sup.'], ['AB25', 'Inglese medie'], ['ADSS', 'Sostegno sup.'], ['ADMM', 'Sostegno medie'],
  ['ADEE', 'Sostegno primaria'], ['EEEE', 'Primaria'], ['AAAA', 'Infanzia'], ['CS', 'Coll. scolastico'],
  ['AA', 'Ass. amministrativo'], ['AT', 'Ass. tecnico'],
];

const FIELDS: [string, string][] = [
  ['cognome', 'Cognome'],
  ['nome', 'Nome'],
  ['nascitaData', 'Data di nascita'],
  ['nascitaLuogo', 'Luogo di nascita'],
  ['cf', 'Codice fiscale'],
  ['cittadinanza', 'Cittadinanza'],
  ['residenza', 'Residenza (indirizzo completo)'],
  ['telefono', 'Telefono'],
  ['email', 'Email'],
  ['pec', 'PEC'],
  ['titolo', 'Titolo di accesso (come sul diploma)'],
  ['titoloIstituto', 'Rilasciato da'],
  ['titoloData', 'Data conseguimento'],
  ['titoloVoto', 'Voto'],
  ['riferimento', 'Riferimento normativo del titolo'],
  ['classi', 'Classi di concorso'],
  ['diploma', 'Diploma di maturità'],
  ['certificazioni', 'Certificazioni principali'],
  ['servizio', 'Servizio scolastico prestato'],
  ['graduatorie', 'Inserimento in graduatorie'],
  ['disponibilita', 'Disponibilità'],
];
// Nessun dato personale nel codice: il profilo si compila una sola volta dalla scheda «Profilo»
// e resta solo sul telefono (AsyncStorage).
const PROFILO_BASE: Record<string, string> = {
  riferimento:
    "Titolo di accesso alle classi B-15 e B-17 ai sensi del D.I. 246/2023, Allegato 1 (figura nazionale 1.2.1 «Tecnico superiore per l'efficienza energetica degli impianti», EQF 5)",
  classi: 'B015, B017',
  disponibilita: 'Disponibilità a prendere servizio immediatamente, anche fuori regione.',
};

const LIGHT = {
  bg: '#f3f5f4', surface: '#ffffff', ink: '#15211f', muted: '#5b6965', line: '#d7dedb',
  accent: '#1f5f8b', accentInk: '#ffffff', accentSoft: '#e2edf5',
  ok: '#1d7a4c', okSoft: '#dcf1e5', warn: '#a15c00', warnSoft: '#fbecd6', crit: '#b3261e', critSoft: '#fbe2df',
};
const DARK = {
  bg: '#0f1514', surface: '#18201f', ink: '#e6ecea', muted: '#9aa8a4', line: '#2b3633',
  accent: '#7fb6dd', accentInk: '#0b1a24', accentSoft: '#1c2c38',
  ok: '#6fcf9b', okSoft: '#163325', warn: '#f0b35c', warnSoft: '#3a2a12', crit: '#ff8a80', critSoft: '#3d1a17',
};
type Pal = typeof LIGHT;

function toast(msg: string) {
  if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.SHORT);
}
async function copia(t: string) {
  await Clipboard.setStringAsync(t || '');
  toast('Copiato');
}

function mailFor(it: Interpello, p: Record<string, string>) {
  const v = (k: string) => (p[k] || '').trim();
  const nome = [v('nome'), v('cognome')].filter(Boolean).join(' ');
  const classi = (it.classi || []).join(' / ');
  const descr = (it.classi || [])
    .map((c) =>
      c === 'B015'
        ? 'B015 – Laboratori di scienze e tecnologie elettriche ed elettroniche'
        : c === 'B017'
          ? 'B017 – Laboratori di scienze e tecnologie meccaniche'
          : c,
    )
    .join('; ');
  const subject = ['Candidatura interpello ' + classi, it.scuola || '', nome].filter(Boolean).join(' – ');
  const righe = [
    'Gentile Dirigente Scolastico,',
    '',
    "in riferimento all'interpello" +
      (it.pubblicato ? ' pubblicato il ' + fmtPubblicato(it) : '') +
      ' per la classe di concorso ' + descr +
      (it.ore ? ' (' + it.ore + ' ore settimanali)' : '') +
      (nome ? ', il sottoscritto ' + nome : '') +
      (/italian/i.test(v('cittadinanza')) ? ', cittadino italiano' : '') +
      (v('nascitaLuogo') && v('nascitaData') ? ', nato a ' + v('nascitaLuogo') + ' il ' + v('nascitaData') : '') +
      (v('cf') ? ', C.F. ' + v('cf') : '') +
      (nome ? ', comunica la propria disponibilità ad accettare la supplenza.' : ', comunico la mia disponibilità ad accettare la supplenza.'),
    '',
    v('titolo')
      ? 'Titolo di accesso: ' + v('titolo') +
        (v('titoloIstituto') ? ', rilasciato da ' + v('titoloIstituto') : '') +
        (v('titoloData') ? ' il ' + v('titoloData') : '') +
        (v('titoloVoto') ? ', votazione ' + v('titoloVoto') : '') + '.' +
        (v('riferimento') ? ' ' + v('riferimento') + '.' : '')
      : v('riferimento') ? v('riferimento') + '.' : '',
    v('graduatorie') ? 'Graduatorie: ' + v('graduatorie') + '.' : '',
    v('servizio') ? 'Servizio: ' + v('servizio') + '.' : '',
    '',
    v('disponibilita') || 'Disponibilità a prendere servizio immediatamente.',
    '',
    'Allego: modulo di candidatura compilato (se previsto), curriculum vitae, documento di identità, titolo di accesso.',
    '',
    'Distinti saluti,',
    nome,
    [v('telefono'), v('email'), v('pec')].filter(Boolean).join(' · '),
  ].filter((r, i, a) => !(r === '' && a[i - 1] === ''));
  return { subject, body: righe.join('\n') };
}

export default function App() {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? DARK : LIGHT;
  const s = useMemo(() => makeStyles(c), [c]);

  const [tab, setTab] = useState<Tab>('interpelli');
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cand, setCand] = useState<Record<string, Cand>>({});
  const [profilo, setProfilo] = useState<Record<string, string>>(PROFILO_BASE);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [fClasse, setFClasse] = useState('tutte');
  const [soloMie, setSoloMie] = useState(true);
  const [nuovaClasse, setNuovaClasse] = useState('');
  const [fVista, setFVista] = useState<'aperti' | 'tutti' | 'nonrisposti'>('aperti');
  const [fOrdine, setFOrdine] = useState<'scadenza' | 'recenti' | 'vicini'>('scadenza');
  const [fRegione, setFRegione] = useState('');
  const [q, setQ] = useState('');
  const [fOre, setFOre] = useState<'tutte' | 'poche' | 'medie' | 'piene'>('tutte');
  const [fDurata, setFDurata] = useState<'tutte' | 'breve' | 'intermedia' | 'fino_a_fine_anno'>('tutte');
  const [conND, setConND] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [bg, setBg] = useState<boolean | null>(null);
  const [abil, setAbil] = useState<AbilFeed | null>(null);
  const [soloItp, setSoloItp] = useState(false);
  const [selIds, setSelIds] = useState<string[] | null>(null);
  const [visIds, setVisIds] = useState<string[]>([]);
  const [visN, setVisN] = useState(0);
  const [soloPrecisi, setSoloPrecisi] = useState(false);
  const [srv, setSrv] = useState<StatoServer | null>(null);
  const [srvReg, setSrvReg] = useState<boolean | null>(modalitaServer() ? null : true);
  const [codiceLink, setCodiceLink] = useState('');
  const [casa, setCasa] = useState<Casa | null>(null);
  const [docs, setDocs] = useState<Documento[]>([]);
  const [fKm, setFKm] = useState<'tutte' | '30' | '60' | '100'>('tutte');

  const aggiornaServer = useCallback(async () => {
    if (!modalitaServer()) return;
    try {
      const reg = await registrato();
      setSrvReg(reg);
      if (reg) setSrv(await leggiStato());
    } catch (e: any) {
      const st = await statoSalvato();
      if (st) setSrv(st);
      setError(e?.message || 'Server non raggiungibile');
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await aggiornaServer();
    try {
      const f = await fetchFeed();
      setFeed(f);
      setError('');
      const fresh = await takeNew(f, await loadPrefs());
      if (fresh.length) await notifyNew(fresh);
      try {
        const ab = await fetchAbil();
        setAbil(ab);
        const nuovi = await takeNewAbil(ab);
        if (nuovi.length) await notifyAbil(nuovi);
      } catch {}
    } catch (e: any) {
      setError(e?.message || 'Connessione assente');
    } finally {
      setLoading(false);
    }
  }, [aggiornaServer]);

  // link d'invito del sindacato: interpellati://codice/XXXX-XXXX-XXXX
  useEffect(() => {
    const leggi = (url: string | null) => {
      const m = /codice\/([A-Za-z0-9-]{4,32})/.exec(url || '');
      if (m) { setCodiceLink(m[1].toUpperCase()); setTab('aiuto'); }
    };
    Linking.getInitialURL().then(leggi).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => leggi(e.url));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    (async () => {
      await loadMemCache();
      setCasa(await leggiCasa());
      setDocs(await leggiDocumenti());
      const cached = await loadCachedFeed();
      if (cached) setFeed(cached);
      const ca = await loadCachedAbil();
      if (ca) setAbil(ca);
      try {
        const cs = await AsyncStorage.getItem('cand');
        if (cs) setCand(JSON.parse(cs));
        setPrefs(await loadPrefs());
        const ps = await AsyncStorage.getItem('profilo');
        if (ps) setProfilo({ ...PROFILO_BASE, ...JSON.parse(ps) });
      } catch {}
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Nuovi interpelli',
          importance: Notifications.AndroidImportance.HIGH,
        });
      }
      await Notifications.requestPermissionsAsync();
      setBg(await registerBackground());
      refresh();
    })();
  }, [refresh]);

  const saveCand = (id: string, patch: Partial<Cand>) => {
    setCand((prev) => {
      const cur = prev[id] || { stato: '' };
      const next = { ...prev, [id]: { ...cur, ...patch } };
      if (patch.stato === 'inviata' && !cur.inviataIl) next[id].inviataIl = new Date().toISOString();
      AsyncStorage.setItem('cand', JSON.stringify(next)).catch(() => {});
      return next;
    });
  };
  const updatePrefs = (patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
    setFClasse('tutte');
  };
  const addClasse = (raw: string) => {
    const c = normClasse(raw);
    if (c.length < 2) return;
    if (!prefs.classi.includes(c)) updatePrefs({ classi: [...prefs.classi, c] });
    setNuovaClasse('');
  };
  const toggleRegione = (r: string) =>
    updatePrefs({ regioni: prefs.regioni.includes(r) ? prefs.regioni.filter((x) => x !== r) : [...prefs.regioni, r] });
  const saveProfilo = (k: string, v: string) => {
    setProfilo((prev) => {
      const next = { ...prev, [k]: v };
      AsyncStorage.setItem('profilo', JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  const items = feed?.interpelli || [];
  const regioni = prefs.regioni.length ? prefs.regioni : REGIONI;
  const tutteClassi = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((i) => (i.classi || []).forEach((c) => m.set(c, (m.get(c) || 0) + (isOpen(i) ? 1 : 0))));
    prefs.classi.forEach((c) => { if (!m.has(c)) m.set(c, 0); });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [items, prefs]);
  const mine = useMemo(() => items.filter((i) => matchPrefs(i, prefs)), [items, prefs]);
  const base = soloMie ? mine : items;
  const open = base.filter(isOpen);
  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return base
      .filter((it) => {
        if (fClasse !== 'tutte' && !(it.classi || []).includes(fClasse)) return false;
        if (fRegione && it.regione !== fRegione) return false;
        if (fOre !== 'tutte') {
          if (it.ore == null) { if (!conND) return false; }
          else if (fOre === 'poche' ? it.ore > 9 : fOre === 'medie' ? it.ore < 10 || it.ore > 17 : it.ore < 18) return false;
        }
        if (fDurata !== 'tutte') {
          if (!it.durataCat) { if (!conND) return false; }
          else if (it.durataCat !== fDurata) return false;
        }
        if (qq && !((it.scuola || '') + ' ' + (it.comune || '') + ' ' + (it.provincia || '')).toLowerCase().includes(qq)) return false;
        if (fKm !== 'tutte' && casa) { const k = km(casa, it); if (k === null || k > Number(fKm)) return false; }
        if (fVista === 'aperti') return isOpen(it);
        if (fVista === 'nonrisposti') return isOpen(it) && !(cand[it.id] && cand[it.id].stato);
        return true;
      })
      .sort((a, b) => {
        if (fOrdine === 'vicini' && casa) {
          const ka = km(casa, a) ?? 1e9, kb = km(casa, b) ?? 1e9;
          if (ka !== kb) return ka - kb;
        }
        if (fOrdine === 'recenti') {
          const ta = a.trovato ? new Date(a.trovato).getTime() : 0, tb = b.trovato ? new Date(b.trovato).getTime() : 0;
          if (ta !== tb) return tb - ta;
          return (parseDate(b.pubblicato)?.getTime() || 0) - (parseDate(a.pubblicato)?.getTime() || 0);
        }
        const oa = isOpen(a), ob = isOpen(b);
        if (oa !== ob) return oa ? -1 : 1;
        const pa = parseDate(a.pubblicato)?.getTime() || 0, pb = parseDate(b.pubblicato)?.getTime() || 0;
        if (oa) {
          const da = parseDate(a.scadenza)?.getTime() ?? 9e15, db = parseDate(b.scadenza)?.getTime() ?? 9e15;
          if (da !== db) return da - db;
        }
        return pb - pa;
      });
  }, [base, fClasse, fVista, fRegione, q, cand, fOre, fDurata, conND, fOrdine, fKm, casa]);

  const mapItems = useMemo(
    () => rows.filter((i) => conCoordinate(i) && (!soloPrecisi || i.geo !== 'p')),
    [rows, soloPrecisi],
  );
  const perId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const selItems = useMemo(
    () => (selIds || []).map((id) => perId.get(id)).filter((x): x is Interpello => !!x),
    [selIds, perId],
  );
  const onSelectMappa = useCallback((ids: string[]) => setSelIds(ids), []);
  const onViewMappa = useCallback((ids: string[], n: number) => { setVisIds(ids); setVisN(n); }, []);
  const inviate = Object.values(cand).filter((x) => x.stato === 'inviata' || x.stato === 'convocato').length;
  const topPad = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 44;

  const bloccato = modalitaServer() && (srvReg === false || (srv && srv.stato !== 'attivo'));
  if (modalitaServer() && srvReg === null) {
    return (
      <View style={[s.root, { paddingTop: topPad, justifyContent: 'center' }]}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }
  if (bloccato) {
    return (
      <View style={[s.root, { paddingTop: topPad }]}>
        <ExpoStatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Accesso s={s} c={c} srv={srv} registrato={!!srvReg} codiceIniziale={codiceLink} errore={error}
          onFatto={async () => { await aggiornaServer(); refresh(); }} />
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      <ExpoStatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {srv?.messaggio ? <Text style={[s.body, { backgroundColor: c.accentSoft, color: c.accent, padding: 10 }]}>{srv.messaggio}</Text> : null}
      {srv && versioneVecchia(srv.versione_minima) ? (
        <Text style={[s.body, { backgroundColor: c.warnSoft, color: c.warn, padding: 10 }]}>È disponibile una nuova versione dell'app: aggiornala dal link del tuo sindacato o dai contatti in «Aiuto e contatti».</Text>
      ) : null}
      <View style={s.header}>
        <Text style={s.h1}>Interpellati <Text style={{ fontSize: 12, fontWeight: '600', color: c.muted }}>v2.0.0</Text></Text>
        <Text style={s.who} numberOfLines={1}>
          {(prefs.classi.length ? prefs.classi.join(' · ') : 'Tutte le classi') + ' — ' + (prefs.regioni.length ? prefs.regioni.length + ' regioni' : 'tutta Italia')}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabsScroll} contentContainerStyle={s.tabs}>
        {([
          ['interpelli', 'Interpelli', open.length],
          ['mappa', 'Mappa', null],
          ['abilitazione', 'Abilitazione', abil ? abil.voci.length : null],
          ['candidature', 'Candidature', inviate],
          ['preferenze', 'Preferenze', null],
          ['profilo', 'Profilo', null],
          ['aiuto', 'Aiuto e contatti', null],
        ] as [Tab, string, number | null][]).map(([k, l, n]) => (
          <Pressable key={k} onPress={() => setTab(k)} style={[s.tab, tab === k && s.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}>
            <Text style={[s.tabText, tab === k && s.tabTextOn]}>
              {l}
              {n !== null ? '  ' + n : ''}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {tab === 'interpelli' && (
        <FlatList
          data={rows}
          keyExtractor={(i) => i.id}
          contentContainerStyle={s.list}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
          ListHeaderComponent={
            <View style={{ gap: 10 }}>
              <View style={s.stats}>
                <Stat s={s} n={open.length} l="aperti" />
                <Stat s={s} n={base.filter(isNew).length} l="nuovi 24h" />
                <Stat s={s} n={open.filter((i) => { const d = daysLeft(parseDate(i.scadenza)); return d !== null && d <= 1; }).length} l="scadono 48h" />
              </View>
              <Text style={s.status}>
                {error
                  ? 'Offline: ' + error + (feed ? ' · mostro gli ultimi dati salvati' : '')
                  : feed?.aggiornato
                    ? 'Dati aggiornati ' + new Date(feed.aggiornato).toLocaleString('it-IT')
                    : loading ? 'Carico gli interpelli…' : ''}
                {feed?.sicilia ? '\nSicilia: ' + feed.sicilia.letti + ' siti scolastici letti su ' + feed.sicilia.conSito + ' (' + feed.sicilia.istituti + ' istituti) + ' + feed.sicilia.uffici + ' uffici' : ''}
                {bg === false ? ' · controllo in background non disponibile su questo telefono' : ''}
              </Text>
              <Chips s={s} value={soloMie ? 'mie' : 'tutto'} set={(v) => { setSoloMie(v === 'mie'); setFClasse('tutte'); }} opts={[['mie', 'Le mie preferenze'], ['tutto', 'Tutte le classi e regioni']]} />
              {soloMie && prefs.classi.length > 1 ? (
                <Chips s={s} value={fClasse} set={setFClasse} opts={[['tutte', 'Tutte le mie'], ...prefs.classi.map((c) => [c, c] as [string, string])]} />
              ) : null}
              <Chips s={s} value={fVista} set={setFVista} opts={[['aperti', 'Aperti'], ['nonrisposti', 'Senza risposta'], ['tutti', 'Anche scaduti']]} />
              <Chips s={s} value={fOrdine} set={setFOrdine} opts={[['scadenza', 'Per scadenza'], ['recenti', 'Più recenti (rilevati)'], ...(casa ? [['vicini', 'Più vicini a casa'] as ['vicini', string]] : [])]} />
              {casa ? (
                <Chips s={s} value={fKm} set={setFKm} opts={[['tutte', 'Qualsiasi distanza'], ['30', 'Entro 30 km'], ['60', 'Entro 60 km'], ['100', 'Entro 100 km']]} />
              ) : (
                <Pressable onPress={() => setTab('profilo')}><Text style={[s.small, { color: c.accent }]}>Imposta «Casa» nel Profilo per vedere la distanza e gli avvisi più vicini</Text></Pressable>
              )}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {[['', 'Tutta Italia'], ...regioni.map((r) => [r, r])].map(([v, l]) => (
                  <Pressable key={v || 'all'} onPress={() => setFRegione(v)} style={[s.chip, fRegione === v && s.chipOn]}>
                    <Text style={[s.chipText, fRegione === v && s.chipTextOn]}>{l}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Chips s={s} value={fOre} set={(v) => setFOre(v as any)} opts={[['tutte', 'Ore: tutte'], ['poche', 'Fino a 9 ore'], ['medie', '10–17 ore'], ['piene', '18 ore']]} />
              <Chips s={s} value={fDurata} set={(v) => setFDurata(v as any)} opts={[['tutte', 'Durata: tutte'], ['breve', 'Breve (≤30 gg)'], ['intermedia', 'Intermedia'], ['fino_a_fine_anno', 'Fino a fine anno']]} />
              {fOre !== 'tutte' || fDurata !== 'tutte' ? (
                <Chips s={s} value={conND ? 'si' : 'no'} set={(v) => setConND(v === 'si')} opts={[['si', 'Includi «non rilevato»'], ['no', 'Solo con dato certo']]} />
              ) : null}
              <TextInput value={q} onChangeText={setQ} placeholder="Cerca scuola, comune o provincia" placeholderTextColor={c.muted} style={s.input} />
            </View>
          }
          ListEmptyComponent={
            loading && !feed ? (
              <ActivityIndicator style={{ marginTop: 32 }} color={c.accent} />
            ) : (
              <View style={s.empty}>
                <Text style={s.emptyTitle}>{items.length ? 'Nessun interpello aperto con questi filtri' : 'Ancora nessun dato'}</Text>
                <Text style={s.muted}>
                  Gli interpelli durano 24–48 ore. L'app controlla da sola ogni mezz'ora circa e ti avvisa con una notifica solo per classi e regioni scelte in «Preferenze». Trascina giù per aggiornare.
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <Card
              it={item}
              s={s}
              c={c}
              cand={cand[item.id]}
              expanded={openId === item.id}
              onToggle={() => setOpenId(openId === item.id ? null : item.id)}
              profilo={profilo}
              saveCand={saveCand}
              casa={casa}
              docs={docs}
            />
          )}
        />
      )}

      {tab === 'mappa' && (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 6 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {[['mie', 'Le mie preferenze', soloMie], ['tutto', 'Tutta Italia', !soloMie]].map(([k, l, on]) => (
                <Pressable key={k as string} onPress={() => { setSoloMie(k === 'mie'); setFClasse('tutte'); setSelIds(null); }} style={[s.chip, on && s.chipOn]}>
                  <Text style={[s.chipText, on && s.chipTextOn]}>{l as string}</Text>
                </Pressable>
              ))}
              {([['aperti', 'Aperti'], ['nonrisposti', 'Senza risposta'], ['tutti', 'Anche scaduti']] as [typeof fVista, string][]).map(([k, l]) => (
                <Pressable key={k} onPress={() => { setFVista(k); setSelIds(null); }} style={[s.chip, fVista === k && s.chipOn]}>
                  <Text style={[s.chipText, fVista === k && s.chipTextOn]}>{l}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setSoloPrecisi(!soloPrecisi)} style={[s.chip, soloPrecisi && s.chipOn]}>
                <Text style={[s.chipText, soloPrecisi && s.chipTextOn]}>Solo posizione precisa</Text>
              </Pressable>
            </ScrollView>
            <Text style={s.small}>
              {mapItems.length} avvisi sulla mappa su {rows.length}
              {rows.length - rows.filter(conCoordinate).length > 0 ? ' · ' + (rows.length - rows.filter(conCoordinate).length) + ' senza posizione' : ''}
              {' · classe, ore e durata si scelgono nella scheda Interpelli'}
            </Text>
          </View>
          <View style={{ flex: 1, marginTop: 6 }}>
            <MappaInterpelli items={mapItems} dark={scheme === 'dark'} fitKey={`${soloMie}|${fClasse}|${fVista}|${fRegione}|${soloPrecisi}`} onSelect={onSelectMappa} onView={onViewMappa} muted={c.muted} />
          </View>
          {selIds ? (
            <View style={{ maxHeight: '55%', borderTopWidth: 1, borderColor: c.line, backgroundColor: c.bg }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 }}>
                <Text style={s.title}>{selItems.length} {selItems.length === 1 ? 'avviso' : 'avvisi'} in questo punto</Text>
                <Pressable onPress={() => setSelIds(null)} style={s.chip}><Text style={s.chipText}>Chiudi</Text></Pressable>
              </View>
              <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 10 }}>
                {selItems.map((item) => (
                  <Card key={item.id} it={item} s={s} c={c} cand={cand[item.id]} expanded={openId === item.id}
                    onToggle={() => setOpenId(openId === item.id ? null : item.id)} profilo={profilo} saveCand={saveCand} casa={casa} docs={docs} />
                ))}
              </ScrollView>
            </View>
          ) : (
            <Pressable onPress={() => setSelIds(visIds)} disabled={!visIds.length} style={{ padding: 12, alignItems: 'center', borderTopWidth: 1, borderColor: c.line, backgroundColor: c.bg }}>
              <Text style={[s.chipText, { color: c.accent, fontWeight: '800' }]}>
                {visN ? `Elenco di questa zona (${visN}${visN > visIds.length ? ', i primi ' + visIds.length : ''})` : 'Sposta la mappa per vedere gli avvisi'}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {tab === 'abilitazione' && (
        <ScrollView contentContainerStyle={s.list} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}>
          <Text style={s.body}>
            Bandi e avvisi dei percorsi abilitanti (30, 36, 60 crediti) trovati sulle pagine ufficiali di Ministero e università. L'app non verifica se hai i requisiti: apri il link e controlla titolo di accesso, scadenza e se riguarda gli ITP (B015, B017).
          </Text>
          <Chips s={s} value={soloItp ? 'itp' : 'tutti'} set={(v) => setSoloItp(v === 'itp')} opts={[['tutti', 'Tutti'], ['itp', 'Solo se citano ITP / B015 / B017']]} />
          {(abil?.voci || []).filter((v) => !soloItp || v.itp).length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyTitle}>{abil ? 'Nessun bando trovato con questo filtro' : 'Ancora nessun dato'}</Text>
              <Text style={s.muted}>L'elenco si aggiorna da solo; trascina giù per ricaricare.</Text>
            </View>
          ) : (
            (abil?.voci || []).filter((v) => !soloItp || v.itp).map((v) => (
              <View key={v.id} style={s.card}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {v.itp ? <Text style={[s.pill, { backgroundColor: c.okSoft, color: c.ok }]}>Cita ITP</Text> : <Text style={[s.pill, { backgroundColor: c.warnSoft, color: c.warn }]}>Da verificare</Text>}
                </View>
                <Text style={s.title}>{v.titolo}</Text>
                <Text style={s.muted}>{v.fonte}{v.visto ? ' · trovato ' + fmtDate(v.visto) : ''}</Text>
                <View style={s.actions}>
                  <Pressable onPress={() => Linking.openURL(v.link)} style={[s.btn, s.btnPrimary]}>
                    <Text style={[s.btnText, { color: c.accentInk }]}>Apri la pagina ufficiale</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {tab === 'candidature' && (
        <ScrollView contentContainerStyle={s.list}>
          <Text style={s.small}>
            Memoria dell'app: {memStats().proposti} avvisi proposti, {memStats().notificati} notificati come nuovi · candidature inviate: {Object.values(cand).filter((x) => x.stato === 'inviata').length}, convocazioni: {Object.values(cand).filter((x) => x.stato === 'convocato').length}. La notifica arriva solo per avvisi mai visti prima.
          </Text>
          {Object.entries(cand).filter(([, x]) => x.stato).length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyTitle}>Nessuna candidatura registrata</Text>
              <Text style={s.muted}>Apri un interpello, prepara la mail e dopo l'invio segna «Inviata». Qui trovi lo storico.</Text>
            </View>
          ) : (
            Object.entries(cand)
              .filter(([, x]) => x.stato)
              .sort((a, b) => String(b[1].inviataIl || '').localeCompare(String(a[1].inviataIl || '')))
              .map(([id, x]) => {
                const it = items.find((i) => i.id === id);
                return (
                  <View key={id} style={s.card}>
                    <Text style={s.title}>{it?.scuola || id}</Text>
                    <Text style={s.muted}>
                      {(it?.classi || []).join(' ')} {it?.provincia ? '· ' + it.provincia : ''} ·{' '}
                      {x.stato === 'inviata' ? 'Inviata' : x.stato === 'convocato' ? 'Convocato' : 'Non interessa'}
                      {x.inviataIl ? ' il ' + fmtDate(new Date(x.inviataIl)) : ''}
                    </Text>
                    {x.note ? <Text style={s.body}>{x.note}</Text> : null}
                    {it?.link ? (
                      <Pressable onPress={() => Linking.openURL(it.link!)} style={s.btn}>
                        <Text style={s.btnText}>Apri l'avviso</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })
          )}
        </ScrollView>
      )}

      {tab === 'preferenze' && (
        <ScrollView contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
          <Text style={s.muted}>
            Scegli le classi di concorso e le regioni che ti interessano. Le notifiche arrivano solo per quelle. Nessuna classe scelta = tutte le classi; nessuna regione = tutta Italia.
          </Text>
          <Text style={s.label}>★ Le tue classi preferite</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {prefs.classi.length === 0 ? <Text style={s.muted}>Tutte le classi</Text> : null}
            {prefs.classi.map((cl) => (
              <Pressable key={cl} onPress={() => updatePrefs({ classi: prefs.classi.filter((x) => x !== cl) })} style={[s.chip, s.chipOn]}>
                <Text style={[s.chipText, s.chipTextOn]}>{cl}  ✕</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              value={nuovaClasse}
              onChangeText={setNuovaClasse}
              onSubmitEditing={() => addClasse(nuovaClasse)}
              autoCapitalize="characters"
              placeholder="Aggiungi una classe (es. A026, AB24, ADSS)"
              placeholderTextColor={c.muted}
              style={[s.input, { flex: 1 }]}
            />
            <Pressable onPress={() => addClasse(nuovaClasse)} style={s.btn}>
              <Text style={s.btnText}>Aggiungi</Text>
            </Pressable>
          </View>
          <Text style={s.label}>Scelte rapide</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {CLASSI_COMUNI.map(([cl, nome]) => {
              const on = prefs.classi.includes(cl);
              return (
                <Pressable
                  key={cl}
                  onPress={() => updatePrefs({ classi: on ? prefs.classi.filter((x) => x !== cl) : [...prefs.classi, cl] })}
                  style={[s.chip, on && s.chipOn]}
                >
                  <Text style={[s.chipText, on && s.chipTextOn]}>{cl} · {nome}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={s.label}>Tutte le classi presenti ora ({tutteClassi.length}) — tocca per aggiungere ai preferiti</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {tutteClassi.map(([cl, n]) => {
              const on = prefs.classi.includes(cl);
              return (
                <Pressable
                  key={cl}
                  onPress={() => updatePrefs({ classi: on ? prefs.classi.filter((x) => x !== cl) : [...prefs.classi, cl] })}
                  style={[s.chip, on && s.chipOn]}
                >
                  <Text style={[s.chipText, on && s.chipTextOn]}>{on ? '★ ' : '☆ '}{cl} · {n}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={() => updatePrefs({ classi: [] })} style={s.btn}>
            <Text style={s.btnText}>Tutte le classi (nessun preferito)</Text>
          </Pressable>
          <Text style={s.label}>Regioni (nessuna scelta = tutta Italia)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {REGIONI.map((r) => {
              const on = prefs.regioni.includes(r);
              return (
                <Pressable key={r} onPress={() => toggleRegione(r)} style={[s.chip, on && s.chipOn]}>
                  <Text style={[s.chipText, on && s.chipTextOn]}>{r}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={() => updatePrefs({ regioni: [] })} style={s.btn}>
            <Text style={s.btnText}>Tutta Italia</Text>
          </Pressable>
        </ScrollView>
      )}

      {tab === 'profilo' && (
        <ScrollView contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
          <Text style={s.muted}>
            Facoltativo. Serve solo per la mail di candidatura già scritta e per copiare i dati nei moduli Google o Microsoft. Se la scuola ti manda il suo modulo, puoi lasciare tutto vuoto. I dati restano solo su questo telefono.
          </Text>
          <View style={s.card}>
            <Text style={s.title}>Casa</Text>
            <Text style={s.muted}>{casa ? 'Impostata: ' + casa.nome + '. Ogni avviso mostra la distanza e puoi filtrare per chilometri.' : "Imposta da dove parti: l'app mostra quanti km dista ogni scuola. Resta solo su questo telefono."}</Text>
            <View style={s.actions}>
              <Pressable style={[s.btn, s.btnPrimary]} onPress={async () => { try { const x = await casaDaGps(); await salvaCasa(x); setCasa(x); toast('Casa impostata'); } catch (e: any) { toast(e?.message || 'Posizione non disponibile'); } }}>
                <Text style={[s.btnText, { color: c.accentInk }]}>Usa la mia posizione</Text>
              </Pressable>
              {casa ? (
                <Pressable style={s.btn} onPress={async () => { await salvaCasa(null); setCasa(null); setFKm('tutte'); }}>
                  <Text style={s.btnText}>Rimuovi</Text>
                </Pressable>
              ) : null}
            </View>
            <TextInput placeholder="Oppure scrivi la sigla della tua provincia (es. EN) e premi invio" placeholderTextColor={c.muted} autoCapitalize="characters" maxLength={2} style={s.input}
              onSubmitEditing={async (e) => { const x = casaDaProvincia(e.nativeEvent.text.trim().toUpperCase(), items); if (x) { await salvaCasa(x); setCasa(x); toast('Casa impostata'); } else toast('Provincia non trovata negli avvisi attuali: usa la posizione'); }} />
          </View>
          <View style={s.card}>
            <Text style={s.title}>Documenti da allegare</Text>
            <Text style={s.muted}>CV, Europass, documento d'identità, titolo di studio. Quando ti candidi, la mail si apre con questi file già allegati. Restano solo su questo telefono.</Text>
            {docs.map((d) => (
              <View key={d.uri} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Pressable onPress={async () => setDocs(await alternaAllegato(d.uri))} style={[s.chip, d.allega && s.chipOn]}>
                  <Text style={[s.chipText, d.allega && s.chipTextOn]}>{d.allega ? '✓ allega' : 'non allegare'}</Text>
                </Pressable>
                <Text style={[s.body, { flex: 1 }]} numberOfLines={1}>{d.nome}</Text>
                <Pressable onPress={async () => setDocs(await rimuoviDocumento(d.uri))} style={s.btn}><Text style={s.btnText}>Togli</Text></Pressable>
              </View>
            ))}
            <Pressable style={s.btn} onPress={async () => { try { setDocs(await aggiungiDocumenti()); } catch { toast('Impossibile aggiungere il file'); } }}>
              <Text style={s.btnText}>Aggiungi documenti</Text>
            </Pressable>
          </View>
          {FIELDS.map(([k, l]) => (
            <View key={k} style={{ gap: 4 }}>
              <Text style={s.label}>{l}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  value={profilo[k] || ''}
                  onChangeText={(v) => saveProfilo(k, v)}
                  multiline={k === 'certificazioni' || k === 'riferimento' || k === 'servizio'}
                  style={[s.input, { flex: 1 }]}
                  placeholderTextColor={c.muted}
                />
                <Pressable onPress={() => copia(profilo[k] || '')} style={s.btn}>
                  <Text style={s.btnText}>Copia</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {tab === 'aiuto' && (
        <Aiuto s={s} c={c} srv={srv} feed={feed} codiceIniziale={codiceLink} onCambio={aggiornaServer} />
      )}
    </View>
  );
}

function linkContatto(tipo: string, v: string): string {
  const x = v.trim();
  if (/^https?:\/\//.test(x)) return x;
  if (tipo === 'email' || tipo === 'pec') return 'mailto:' + x;
  if (tipo === 'whatsapp') return 'https://wa.me/' + x.replace(/[^0-9]/g, '');
  if (tipo === 'telegram') return 'https://t.me/' + x.replace(/^@/, '');
  if (tipo === 'instagram') return 'https://instagram.com/' + x.replace(/^@/, '');
  if (tipo === 'facebook') return 'https://facebook.com/' + x.replace(/^@/, '');
  return x;
}

function ContattiBox({ s, c, srv }: { s: any; c: Pal; srv: StatoServer | null }) {
  const k = srv?.contatti || {};
  const voci = (['whatsapp', 'telegram', 'email', 'pec', 'instagram', 'facebook'] as const).filter((t) => (k as any)[t]);
  if (!voci.length && !(k.community || []).length) return <Text style={s.muted}>I contatti dell'amministratore appariranno qui.</Text>;
  const nomi: Record<string, string> = { whatsapp: 'WhatsApp', telegram: 'Telegram', email: 'Email', pec: 'PEC', instagram: 'Instagram', facebook: 'Facebook' };
  return (
    <View style={s.actions}>
      {voci.map((t) => (
        <Pressable key={t} style={s.btn} onPress={() => Linking.openURL(linkContatto(t, (k as any)[t])).catch(() => copia((k as any)[t]))}>
          <Text style={s.btnText}>{nomi[t]}</Text>
        </Pressable>
      ))}
      {(k.community || []).map((x) => (
        <Pressable key={x.link} style={[s.btn, s.btnPrimary]} onPress={() => Linking.openURL(x.link).catch(() => {})}>
          <Text style={[s.btnText, { color: c.accentInk }]}>{x.nome}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Accesso({ s, c, srv, registrato, codiceIniziale, errore, onFatto }: {
  s: any; c: Pal; srv: StatoServer | null; registrato: boolean; codiceIniziale: string; errore: string; onFatto: () => void;
}) {
  const [passo, setPasso] = useState<'codice' | 'classi'>('codice');
  const [codice, setCodice] = useState(codiceIniziale);
  const [classi, setClassi] = useState<string[]>([]);
  const [altra, setAltra] = useState('');
  const [msg, setMsg] = useState('');
  const [prov, setProv] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (codiceIniziale) setCodice(codiceIniziale); }, [codiceIniziale]);

  const invia = async (conCodice: boolean) => {
    setBusy(true); setErr('');
    try {
      if (registrato && conCodice) await usaCodice(codice.trim());
      else await registra({ codice: conCodice ? codice.trim() : undefined, classi, provincia: prov.trim().toUpperCase() || undefined, messaggio: msg.trim() });
      onFatto();
    } catch (e: any) {
      setErr(e?.message || 'Errore');
    } finally {
      setBusy(false);
    }
  };

  if (registrato && srv && srv.stato !== 'attivo') {
    const testi: Record<string, string> = {
      attesa: "Richiesta inviata. L'amministratore abilita il tuo telefono per le classi che hai scelto: appena lo fa, gli interpelli compaiono qui.",
      sospeso: "Il tuo accesso è sospeso. Contatta l'amministratore.",
      revocato: "Il tuo accesso è stato revocato. Contatta l'amministratore.",
      scaduto: "Il tuo accesso è scaduto. Contatta l'amministratore per rinnovarlo.",
      spento: 'Il servizio è momentaneamente sospeso per manutenzione. Riprova più tardi.',
      gruppo_sospeso: "L'accesso del tuo gruppo è sospeso. Contatta il tuo riferimento o l'amministratore.",
    };
    return (
      <ScrollView contentContainerStyle={[s.list, { paddingTop: 24 }]}>
        <Text style={s.h1}>Interpellati</Text>
        <View style={s.card}>
          <Text style={s.title}>{srv.stato === 'attesa' ? 'In attesa di abilitazione' : 'Accesso non attivo'}</Text>
          <Text style={s.body}>{testi[srv.stato] || ''}</Text>
          {srv.classi?.length ? <Text style={s.muted}>Classi richieste: {srv.classi.join(', ')}</Text> : null}
          <Pressable style={[s.btn, s.btnPrimary]} onPress={onFatto}><Text style={[s.btnText, { color: c.accentInk }]}>Controlla di nuovo</Text></Pressable>
        </View>
        <View style={s.card}>
          <Text style={s.title}>Hai un codice del tuo sindacato?</Text>
          <TextInput value={codice} onChangeText={setCodice} autoCapitalize="characters" placeholder="XXXX-XXXX-XXXX" placeholderTextColor={c.muted} style={s.input} />
          <Pressable disabled={busy || codice.trim().length < 4} style={[s.btn, s.btnPrimary]} onPress={() => invia(true)}>
            <Text style={[s.btnText, { color: c.accentInk }]}>{busy ? 'Invio…' : 'Usa il codice'}</Text>
          </Pressable>
          {err ? <Text style={[s.small, { color: c.crit }]}>{err}</Text> : null}
        </View>
        <View style={s.card}>
          <Text style={s.title}>Contatta l'amministratore</Text>
          <ContattiBox s={s} c={c} srv={srv} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={[s.list, { paddingTop: 24 }]} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Benvenuto in Interpellati</Text>
      <Text style={s.body}>Gli interpelli e le supplenze delle scuole, appena escono. Nessun account e nessun dato personale: l'app funziona solo su questo telefono.</Text>
      {errore ? <Text style={[s.small, { color: c.crit }]}>{errore}</Text> : null}
      {passo === 'codice' ? (
        <View style={s.card}>
          <Text style={s.title}>1 · Hai un codice del tuo sindacato?</Text>
          <TextInput value={codice} onChangeText={setCodice} autoCapitalize="characters" placeholder="XXXX-XXXX-XXXX" placeholderTextColor={c.muted} style={s.input} />
          <Pressable disabled={busy || codice.trim().length < 4} style={[s.btn, s.btnPrimary]} onPress={() => invia(true)}>
            <Text style={[s.btnText, { color: c.accentInk }]}>{busy ? 'Attivazione…' : 'Entra con il codice'}</Text>
          </Pressable>
          <Pressable style={s.btn} onPress={() => setPasso('classi')}><Text style={s.btnText}>Non ho un codice: chiedi l'accesso</Text></Pressable>
          {err ? <Text style={[s.small, { color: c.crit }]}>{err}</Text> : null}
        </View>
      ) : (
        <View style={s.card}>
          <Text style={s.title}>2 · Quali classi di concorso ti interessano?</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {CLASSI_COMUNI.map(([cl, nome]) => {
              const on = classi.includes(cl);
              return (
                <Pressable key={cl} onPress={() => setClassi(on ? classi.filter((x) => x !== cl) : [...classi, cl])} style={[s.chip, on && s.chipOn]}>
                  <Text style={[s.chipText, on && s.chipTextOn]}>{cl} · {nome}</Text>
                </Pressable>
              );
            })}
            {classi.filter((x) => !CLASSI_COMUNI.some(([k]) => k === x)).map((x) => (
              <Pressable key={x} onPress={() => setClassi(classi.filter((y) => y !== x))} style={[s.chip, s.chipOn]}>
                <Text style={[s.chipText, s.chipTextOn]}>{x}  ✕</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput value={altra} onChangeText={setAltra} autoCapitalize="characters" placeholder="Altra classe (es. A046)" placeholderTextColor={c.muted} style={[s.input, { flex: 1 }]} />
            <Pressable style={s.btn} onPress={() => { const x = normClasse(altra); if (x.length >= 2 && !classi.includes(x)) setClassi([...classi, x]); setAltra(''); }}><Text style={s.btnText}>Aggiungi</Text></Pressable>
          </View>
          <TextInput value={prov} onChangeText={setProv} autoCapitalize="characters" maxLength={2} placeholder="Provincia (facoltativa, es. EN)" placeholderTextColor={c.muted} style={s.input} />
          <TextInput value={msg} onChangeText={setMsg} multiline placeholder="Messaggio per l'amministratore (facoltativo). Se vuoi essere ricontattato, scrivi qui come." placeholderTextColor={c.muted} style={s.input} />
          <Pressable disabled={busy || !classi.length} style={[s.btn, s.btnPrimary]} onPress={() => invia(false)}>
            <Text style={[s.btnText, { color: c.accentInk }]}>{busy ? 'Invio…' : 'Chiedi l’accesso'}</Text>
          </Pressable>
          <Pressable style={s.btn} onPress={() => setPasso('codice')}><Text style={s.btnText}>Indietro</Text></Pressable>
          {err ? <Text style={[s.small, { color: c.crit }]}>{err}</Text> : null}
        </View>
      )}
    </ScrollView>
  );
}

function Aiuto({ s, c, srv, feed, codiceIniziale, onCambio }: {
  s: any; c: Pal; srv: StatoServer | null; feed: Feed | null; codiceIniziale: string; onCambio: () => void;
}) {
  const [link, setLink] = useState('');
  const [testo, setTesto] = useState('');
  const [classiNuove, setClassiNuove] = useState('');
  const [codice, setCodice] = useState(codiceIniziale);
  useEffect(() => { if (codiceIniziale) setCodice(codiceIniziale); }, [codiceIniziale]);
  const server = modalitaServer() && !!srv;
  return (
    <ScrollView contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
      <View style={s.card}>
        <Text style={s.title}>Contatta l'amministratore</Text>
        <Text style={s.muted}>Per attivare nuove classi o regioni, segnalare un problema o proporre un'idea.</Text>
        <ContattiBox s={s} c={c} srv={srv} />
      </View>
      {server ? (
        <View style={s.card}>
          <Text style={s.title}>Il tuo accesso</Text>
          <Text style={s.body}>Classi: {srv!.classi.includes('*') ? 'tutte' : srv!.classi.join(', ') || '—'} · Regioni: {srv!.regioni.includes('*') ? 'tutta Italia' : srv!.regioni.join(', ')}</Text>
          {srv!.gruppo ? <Text style={s.muted}>Gruppo: {srv!.gruppo}</Text> : null}
          {srv!.scadenza ? <Text style={s.muted}>Valido fino al {fmtDate(srv!.scadenza)}</Text> : null}
          <TextInput value={classiNuove} onChangeText={setClassiNuove} autoCapitalize="characters" placeholder="Chiedi altre classi (es. A040, A042)" placeholderTextColor={c.muted} style={s.input} />
          <Pressable style={s.btn} onPress={async () => {
            const l = classiNuove.split(/[,\s]+/).map(normClasse).filter((x) => x.length >= 2);
            if (!l.length) return;
            try { await inviaRichiesta(l, [], ''); setClassiNuove(''); toast('Richiesta inviata'); onCambio(); } catch (e: any) { toast(e?.message || 'Errore'); }
          }}><Text style={s.btnText}>Invia richiesta</Text></Pressable>
          <TextInput value={codice} onChangeText={setCodice} autoCapitalize="characters" placeholder="Codice del sindacato" placeholderTextColor={c.muted} style={s.input} />
          <Pressable style={s.btn} onPress={async () => { try { await usaCodice(codice.trim()); toast('Codice attivato'); onCambio(); } catch (e: any) { toast(e?.message || 'Errore'); } }}>
            <Text style={s.btnText}>Usa codice</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={s.card}>
        <Text style={s.title}>Manca un interpello?</Text>
        <Text style={s.muted}>Se hai visto un interpello che l'app non mostra, incolla il link: serve a migliorare la ricerca per tutti.</Text>
        <TextInput value={link} onChangeText={setLink} placeholder="Link dell'avviso" placeholderTextColor={c.muted} autoCapitalize="none" style={s.input} />
        <TextInput value={testo} onChangeText={setTesto} placeholder="Scuola, classe, provincia (facoltativo)" placeholderTextColor={c.muted} multiline style={s.input} />
        <Pressable style={[s.btn, s.btnPrimary]} onPress={async () => {
          if (!link.trim() && !testo.trim()) return;
          if (server) {
            try { await segnala('mancante', link.trim(), testo.trim()); setLink(''); setTesto(''); toast('Grazie, segnalazione inviata'); } catch (e: any) { toast(e?.message || 'Errore'); }
          } else {
            const e = srv?.contatti?.email;
            Linking.openURL('mailto:' + (e || '') + '?subject=' + encodeURIComponent('Interpello mancante') + '&body=' + encodeURIComponent(link + '\n' + testo)).catch(() => copia(link + ' ' + testo));
          }
        }}><Text style={[s.btnText, { color: c.accentInk }]}>Invia segnalazione</Text></Pressable>
      </View>
      {feed?.sicilia ? (
        <View style={s.card}>
          <Text style={s.title}>Copertura della ricerca</Text>
          <Text style={s.body}>Sicilia: {feed.sicilia.letti} siti scolastici letti su {feed.sicilia.conSito} ({Math.round((feed.sicilia.letti / Math.max(1, feed.sicilia.conSito)) * 100)}%), più {feed.sicilia.uffici} uffici scolastici. In tutta Italia: uffici scolastici provinciali e regionali e aggregatori nazionali.</Text>
        </View>
      ) : null}
      {srv?.sostegno?.link ? (
        <View style={s.card}>
          <Text style={s.title}>Sostieni il progetto</Text>
          <Text style={s.body}>{srv.sostegno.testo || "Interpellati è gratuito. Se vuoi, puoi sostenere progetti per gli studenti."}</Text>
          <Pressable style={[s.btn, s.btnPrimary]} onPress={() => Linking.openURL(srv.sostegno.link).catch(() => {})}><Text style={[s.btnText, { color: c.accentInk }]}>Sostieni</Text></Pressable>
          {srv.trasparenza?.testo ? <Text style={s.small}>{srv.trasparenza.testo}</Text> : null}
        </View>
      ) : null}
      <Text style={s.small}>Interpellati non raccoglie dati personali. Profilo, documenti e candidature restano solo su questo telefono.</Text>
    </ScrollView>
  );
}

function Stat({ s, n, l }: { s: any; n: number; l: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statN}>{n}</Text>
      <Text style={s.muted}>{l}</Text>
    </View>
  );
}

function Chips<T extends string>({ s, value, set, opts }: { s: any; value: T; set: (v: T) => void; opts: [T, string][] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {opts.map(([v, l]) => (
        <Pressable key={v} onPress={() => set(v)} style={[s.chip, value === v && s.chipOn]} accessibilityState={{ selected: value === v }}>
          <Text style={[s.chipText, value === v && s.chipTextOn]}>{l}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function durataLabel(it: Interpello): string {
  const d = it.durata;
  if (!d) return '';
  const al = d.al ? fmtDate(d.al) : '';
  if (d.tipo === 'giorni' && d.giorni) return d.giorni + ' giorni';
  if (al) return 'fino al ' + al;
  if (it.durataCat === 'fino_a_fine_anno') return 'fino a fine anno';
  if (it.durataCat === 'indeterminata') return 'fino a rientro titolare';
  return '';
}

function Card({
  it, s, c, cand, expanded, onToggle, profilo, saveCand, casa, docs,
}: {
  it: Interpello; s: any; c: Pal; cand?: Cand; expanded: boolean; onToggle: () => void;
  profilo: Record<string, string>; saveCand: (id: string, p: Partial<Cand>) => void;
  casa: Casa | null; docs: Documento[];
}) {
  const dist = km(casa, it);
  const op = isOpen(it);
  const d = parseDate(it.scadenza);
  const l = daysLeft(d);
  let badge: [string, string, string];
  if (!op) badge = ['Scaduto', c.bg, c.muted];
  else if (l === null) badge = ["Scadenza sull'avviso", c.warnSoft, c.warn];
  else if (l <= 1) badge = [l === 0 ? 'Scade oggi' : 'Scade domani', c.critSoft, c.crit];
  else if (l <= 3) badge = ['Scade tra ' + l + ' giorni', c.warnSoft, c.warn];
  else badge = ['Aperto', c.okSoft, c.ok];
  const place = [it.comune, it.provincia ? '(' + it.provincia + ')' : '', it.regione ? '· ' + it.regione : ''].filter(Boolean).join(' ');
  const m = expanded ? mailFor(it, profilo) : null;

  return (
    <View style={[s.card, !op && { opacity: 0.65 }, op && isNew(it) && { borderColor: c.accent }]}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {(it.classi || []).map((x) => (
          <Text key={x} style={[s.pill, { backgroundColor: c.accentSoft, color: c.accent }]}>{x}</Text>
        ))}
        {op && isNew(it) ? <Text style={[s.pill, { backgroundColor: c.okSoft, color: c.ok }]}>Nuovo</Text> : null}
        {it.ore ? <Text style={[s.pill, { backgroundColor: c.bg, color: c.ink }]}>{it.ore} h/sett.</Text> : null}
        {durataLabel(it) ? <Text style={[s.pill, { backgroundColor: c.bg, color: c.ink }]}>{durataLabel(it)}</Text> : null}
        {it.tipoPosto === 'sostegno' ? <Text style={[s.pill, { backgroundColor: c.bg, color: c.ink }]}>Sostegno</Text> : null}
        <Text style={[s.pill, { backgroundColor: badge[1], color: badge[2] }]}>{badge[0]}</Text>
        {dist !== null ? <Text style={[s.pill, { backgroundColor: c.bg, color: c.ink }]}>{(it.geo === 'p' ? '≈ ' : '') + dist + ' km'}</Text> : null}
        {cand?.stato ? (
          <Text style={[s.pill, { backgroundColor: c.okSoft, color: c.ok }]}>
            {cand.stato === 'inviata' ? 'Inviata' : cand.stato === 'convocato' ? 'Convocato' : 'Scartata'}
          </Text>
        ) : null}
      </View>
      <Text style={s.title}>{it.scuola || 'Interpello'}</Text>
      {place ? <Text style={s.muted}>{place}</Text> : null}
      {it.geo ? (
        <Text style={s.small}>
          {it.geo === 'i' ? 'Posizione: ' + (it.indirizzo || 'indirizzo della scuola')
            : it.geo === 'c' ? 'Posizione: centro del comune (indirizzo non trovato)'
              : 'Posizione indicativa (capoluogo): l\'avviso non indica la scuola'}
        </Text>
      ) : null}
      <Text style={s.muted}>
        {[d ? 'Scadenza ' + fmtDate(d) + (it.oraScadenza ? ' ore ' + it.oraScadenza : '') : '', it.ore ? it.ore + ' ore/sett.' : '', it.periodo || '', it.pubblicato ? 'Pubblicato ' + fmtPubblicato(it) : '']
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {it.trovato ? (
        <Text style={s.small}>Rilevato dall'app {fmtRilevato(it)} ({fmtFa(it)})</Text>
      ) : null}
      {it.note ? <Text style={s.body}>{it.note}</Text> : null}
      {it.email ? <Text style={s.body} selectable>Invio a: {it.email}</Text> : null}
      {expanded && (it.oreEvidenza || it.durataEvidenza) ? (
        <Text style={s.small}>
          {it.lettoDa === 'ai' ? 'Letto con intelligenza artificiale, da verificare sull\'avviso. ' : 'Letto dall\'avviso: '}
          {[it.oreEvidenza, it.durataEvidenza].filter(Boolean).map((x) => '«…' + x + '…»').join(' ')}
        </Text>
      ) : null}
      <View style={s.actions}>
        {it.candidatura && /^https?:/.test(it.candidatura) ? (
          <Pressable onPress={() => Linking.openURL(it.candidatura!)} style={s.btn}>
            <Text style={s.btnText}>Modulo di candidatura</Text>
          </Pressable>
        ) : null}
        {it.link ? (
          <Pressable onPress={() => Linking.openURL(it.link!)} style={[s.btn, s.btnPrimary]}>
            <Text style={[s.btnText, { color: c.accentInk }]}>Apri l'avviso ufficiale</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onToggle} style={s.btn}>
          <Text style={s.btnText}>{expanded ? 'Chiudi' : 'Prepara candidatura'}</Text>
        </Pressable>
      </View>
      {it.fonte ? <Text style={s.small}>Fonte: {it.fonte}</Text> : null}

      {m ? (
        <View style={s.panel}>
          <Text style={s.label}>Oggetto</Text>
          <Text style={s.mail} selectable>{m.subject}</Text>
          <Text style={s.label}>Testo della mail</Text>
          <Text style={s.mail} selectable>{m.body}</Text>
          <View style={s.actions}>
            {it.email ? (
              <Pressable
                onPress={async () => {
                  try {
                    const r = await inviaCandidatura(it.email!, m.subject, m.body);
                    if (r === 'inviata') { saveCand(it.id, { stato: 'inviata' }); toast('Candidatura inviata'); }
                  } catch {
                    Linking.openURL('mailto:' + it.email + '?subject=' + encodeURIComponent(m.subject) + '&body=' + encodeURIComponent(m.body)).catch(() => toast('Nessuna app di posta'));
                  }
                }}
                style={[s.btn, s.btnPrimary]}>
                <Text style={[s.btnText, { color: c.accentInk }]}>
                  {docs.filter((d) => d.allega).length ? 'Invia con ' + docs.filter((d) => d.allega).length + ' allegati' : 'Apri nella mail'}
                </Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => copia(m.subject)} style={s.btn}><Text style={s.btnText}>Copia oggetto</Text></Pressable>
            <Pressable onPress={() => copia(m.body)} style={s.btn}><Text style={s.btnText}>Copia testo</Text></Pressable>
          </View>
          {!profilo.titolo ? <Text style={s.small}>Completa il Profilo per riempire i campi tra parentesi quadre.</Text> : null}
          {!docs.length ? <Text style={s.small}>Aggiungi CV e documenti nel Profilo: verranno allegati da soli.</Text> : null}
          {it.scadenza ? (
            <View style={s.actions}>
              <Pressable style={s.btn} onPress={async () => { try { toast('Ti avviso il ' + (await promemoria(it))); } catch (e: any) { toast(e?.message || 'Errore'); } }}>
                <Text style={s.btnText}>Ricordamelo</Text>
              </Pressable>
              <Pressable style={s.btn} onPress={() => aggiungiAlCalendario(it).catch((e) => toast(e?.message || 'Calendario non disponibile'))}>
                <Text style={s.btnText}>Aggiungi al calendario</Text>
              </Pressable>
            </View>
          ) : null}
          {modalitaServer() ? (
            <Pressable style={s.btn} onPress={() => segnala('errore', it.link || '', 'Dati da verificare', it.id).then(() => toast('Grazie, lo controllo')).catch((e) => toast(e?.message || 'Errore'))}>
              <Text style={s.btnText}>Segnala un errore in questo avviso</Text>
            </Pressable>
          ) : null}
          <Text style={s.label}>Stato</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {([['inviata', 'Inviata'], ['convocato', 'Convocato'], ['scartata', 'Non mi interessa'], ['', 'Nessuno']] as [Stato, string][]).map(([v, l]) => (
              <Pressable key={v || 'none'} onPress={() => saveCand(it.id, { stato: v })} style={[s.chip, (cand?.stato || '') === v && s.chipOn]}>
                <Text style={[s.chipText, (cand?.stato || '') === v && s.chipTextOn]}>{l}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            defaultValue={cand?.note || ''}
            onEndEditing={(e) => saveCand(it.id, { note: e.nativeEvent.text })}
            placeholder="Note: data invio, risposta, contatti"
            placeholderTextColor={c.muted}
            multiline
            style={s.input}
          />
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(c: Pal) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: { paddingHorizontal: 16, paddingTop: 8, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    h1: { fontSize: 26, fontWeight: '800', color: c.ink },
    who: { color: c.muted, fontSize: 13 },
    tabsScroll: { flexGrow: 0, borderBottomWidth: 1, borderColor: c.line, marginTop: 6 },
    tabs: { flexDirection: 'row', paddingHorizontal: 8 },
    tab: { paddingVertical: 10, paddingHorizontal: 10, borderBottomWidth: 3, borderColor: 'transparent' },
    tabOn: { borderColor: c.accent },
    tabText: { color: c.muted, fontWeight: '700' },
    tabTextOn: { color: c.ink },
    list: { padding: 16, gap: 10, paddingBottom: 48 },
    stats: { flexDirection: 'row', gap: 8 },
    stat: { flex: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 10, padding: 10 },
    statN: { fontSize: 22, fontWeight: '800', color: c.ink, fontVariant: ['tabular-nums'] },
    status: { color: c.muted, fontSize: 12 },
    chip: { borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12 },
    chipOn: { backgroundColor: c.accent, borderColor: c.accent },
    chipText: { color: c.ink, fontSize: 13 },
    chipTextOn: { color: c.accentInk },
    input: { borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, color: c.ink, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
    card: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 10, padding: 14, gap: 6 },
    title: { fontSize: 16, fontWeight: '700', color: c.ink },
    muted: { color: c.muted, fontSize: 13 },
    body: { color: c.ink, fontSize: 13 },
    small: { color: c.muted, fontSize: 12 },
    label: { color: c.muted, fontSize: 12, fontWeight: '700' },
    pill: { fontSize: 11, fontWeight: '700', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
    btn: { borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12, justifyContent: 'center' },
    btnPrimary: { backgroundColor: c.accent, borderColor: c.accent },
    btnText: { color: c.ink, fontSize: 13, fontWeight: '600' },
    panel: { marginTop: 8, gap: 8, borderTopWidth: 1, borderColor: c.line, paddingTop: 10 },
    mail: { color: c.ink, fontSize: 13, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 10 },
    empty: { backgroundColor: c.surface, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line, borderRadius: 10, padding: 18, gap: 6 },
    emptyTitle: { fontSize: 15, fontWeight: '700', color: c.ink },
  });
}
