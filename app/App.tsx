import Constants from 'expo-constants';
import { CLASSI_CATALOGO } from './src/classi';
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
  Share,
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
  inviaRichiesta, inviaVerifica, LINK_APP, leggiStato, modalitaServer, registra, registrato, segnala, statoSalvato, usaCodice, versioneVecchia,
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
type Tab = 'interpelli' | 'mappa' | 'scuole' | 'abilitazione' | 'candidature' | 'preferenze' | 'profilo' | 'verifica' | 'aiuto';

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
  const [cercaClasse, setCercaClasse] = useState('');
  const [letteraClasse, setLetteraClasse] = useState('');
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

  const inProva = modalitaServer() && srv?.stato === 'prova';
  const limitato = modalitaServer() && srv?.stato === 'limitato';
  const bloccato = modalitaServer() && (srvReg === false || (srv && !['attivo', 'prova', 'limitato'].includes(srv.stato)));
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
          onFatto={async () => { setPrefs(await loadPrefs()); await aggiornaServer(); refresh(); }} />
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
      {inProva && srv ? (
        <Pressable onPress={() => setTab('verifica')} style={{ backgroundColor: c.accentSoft, padding: 10 }}>
          <Text style={[s.body, { color: c.accent }]}>
            Prova gratuita: {srv.giorni_rimasti ?? 0} {srv.giorni_rimasti === 1 ? 'giorno rimasto' : 'giorni rimasti'}. Verifica il tuo profilo per continuare a vedere scuole e avvisi. Tocca qui.
          </Text>
        </Pressable>
      ) : null}
      {limitato ? (
        <Pressable onPress={() => setTab('verifica')} style={{ backgroundColor: c.warnSoft, padding: 10 }}>
          <Text style={[s.body, { color: c.warn }]}>La prova gratuita è finita: vedi i numeri, ma scuole e avvisi restano oscurati finché non verifichi il profilo. Tocca qui.</Text>
        </Pressable>
      ) : null}
      <View style={s.header}>
        <Text style={s.h1}>Interpellati <Text style={{ fontSize: 12, fontWeight: '600', color: c.muted }}> v{Constants.expoConfig?.version || ''}</Text></Text>
        <Text style={s.who} numberOfLines={1}>
          {(prefs.classi.length ? prefs.classi.join(' · ') : 'Tutte le classi') + ' — ' + (prefs.regioni.length ? prefs.regioni.length + ' regioni' : 'tutta Italia')}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabsScroll} contentContainerStyle={s.tabs}>
        {([
          ['interpelli', 'Interpelli', open.length],
          ['mappa', 'Mappa', null],
          ['scuole', 'Scuole', null],
          ['abilitazione', 'Abilitazione', abil ? abil.voci.length : null],
          ['candidature', 'Candidature', inviate],
          ['preferenze', 'Preferenze', null],
          ['profilo', 'Profilo', null],
          ...((modalitaServer() && srv && !srv.verificato ? [['verifica', 'Verifica', null]] : []) as [Tab, string, number | null][]),
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

      {limitato && (tab === 'interpelli' || tab === 'mappa') ? (
        <LimitatoBox s={s} c={c} feed={feed} modo={tab} classiUtente={srv?.classi_dichiarate || []} onVerifica={() => setTab('verifica')} />
      ) : null}
      {tab === 'verifica' && srv ? <VerificaBox s={s} c={c} srv={srv} onFatto={aggiornaServer} /> : null}
      {tab === 'interpelli' && !limitato && (
        <FlatList
          data={rows}
          keyExtractor={(i) => i.id}
          contentContainerStyle={s.list}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
          ListHeaderComponent={
            <View style={{ gap: 10 }}>
              <View style={s.stats}>
                <Stat s={s} n={open.length} l="aperti" />
                <Stat s={s} n={open.filter((i) => !!i.scadenza).length} l="con scadenza" />
                <Stat s={s} n={base.filter(isNew).length} l="nuovi 24h" />
                <Stat s={s} n={open.filter((i) => { const d = daysLeft(parseDate(i.scadenza)); return d !== null && d <= 1; }).length} l="scadono 48h" />
              </View>
              <Text style={s.status}>
                {error
                  ? 'Offline: ' + error + (feed ? ' · mostro gli ultimi dati salvati' : '')
                  : feed?.aggiornato
                    ? 'Dati aggiornati ' + new Date(feed.aggiornato).toLocaleString('it-IT')
                    : loading ? 'Carico gli interpelli…' : ''}
                {!feed?.copertura && feed?.sicilia ? '\nSicilia: ' + feed.sicilia.letti + ' siti scolastici letti su ' + feed.sicilia.conSito + ' (' + feed.sicilia.istituti + ' istituti) + ' + feed.sicilia.uffici + ' uffici' : ''}
                {bg === false ? ' · controllo in background non disponibile su questo telefono' : ''}
              </Text>
              {feed?.copertura ? <CoperturaBox s={s} c={c} cop={feed.copertura} /> : null}
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

      {tab === 'mappa' && !limitato && (
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

      {tab === 'scuole' && <ScuoleTab s={s} c={c} />}

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
          <Text style={s.label}>Cerca tra tutte le classi di concorso d'Italia ({CLASSI_CATALOGO.length})</Text>
          <TextInput
            value={cercaClasse}
            onChangeText={(v) => { setCercaClasse(v); if (v.trim().length >= 2) setLetteraClasse(''); }}
            placeholder="Codice o nome (es. B015, elettriche, sostegno, inglese)"
            placeholderTextColor={c.muted}
            autoCapitalize="none"
            style={s.input}
          />
          <Text style={s.label}>Elenco completo dalla A alla Z</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {Array.from(new Set(CLASSI_CATALOGO.map((x) => x.codice[0]))).sort().map((L) => (
              <Pressable key={L} onPress={() => { setCercaClasse(''); setLetteraClasse(letteraClasse === L ? '' : L); }} style={[s.chip, letteraClasse === L && s.chipOn]}>
                <Text style={[s.chipText, letteraClasse === L && s.chipTextOn]}>{L} · {CLASSI_CATALOGO.filter((x) => x.codice[0] === L).length}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={s.small}>Fonte: DPR 19/2016 e DM 259/2017 (Tabelle A e B), tabella ufficiale delle classi di concorso; sostegno, infanzia/primaria, religione e profili ATA dai relativi contratti. I codici delle scuole non presenti nel catalogo sono in «Codici visti negli avvisi».</Text>
          {(() => {
            const q = cercaClasse.toLowerCase().replace(/[-\s]/g, '');
            const trovate = q.length < 2 ? (letteraClasse ? CLASSI_CATALOGO.filter((x) => x.codice[0] === letteraClasse) : []) : CLASSI_CATALOGO.filter((x) =>
              x.codice.toLowerCase().includes(q) || x.alias.toLowerCase().replace('-', '').includes(q) || x.nome.toLowerCase().replace(/[-\s]/g, '').includes(q) || x.gruppo.toLowerCase().replace(/[-\s]/g, '').includes(q));
            if (q.length >= 2 && !trovate.length) return <Text style={s.muted}>Nessuna classe trovata: puoi scrivere il codice nel campo «Aggiungi una classe» qui sopra.</Text>;
            return trovate.slice(0, q.length < 2 ? 400 : 40).map((x) => {
              const on = prefs.classi.includes(x.codice);
              return (
                <Pressable key={x.codice} onPress={() => updatePrefs({ classi: on ? prefs.classi.filter((y) => y !== x.codice) : [...prefs.classi, x.codice] })}
                  style={[s.chip, on && s.chipOn, { alignSelf: 'stretch' }]}>
                  <Text style={[s.chipText, on && s.chipTextOn]}>{on ? '★ ' : '☆ '}{x.codice} ({x.alias}) · {x.nome}</Text>
                  <Text style={[s.small, on && s.chipTextOn]}>{x.gruppo}</Text>
                </Pressable>
              );
            });
          })()}
          {cercaClasse.trim().length >= 2 ? null : <Text style={s.muted}>Scrivi almeno 2 caratteri: cerco per codice, per nome o per tipo (sostegno, ATA, lingue, laboratori…).</Text>}
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

const GUIDA: [string, string][] = [
  ['Gli interpelli, appena escono', "Interpellati legge i siti delle scuole e ti avvisa quando c'è un interpello per le tue classi di concorso, spesso prima che altri se ne accorgano."],
  ['Solo cose reali', "Dopo la prova gratuita, scuole e avvisi si aprono solo a chi è verificato: così consigli, alloggi e aiuti vengono da persone vere con la classe che dichiarano."],
  ['I tuoi dati restano tuoi', "Nessun account. L'app funziona solo su questo telefono. Per la verifica chiediamo solo l'essenziale, senza documenti, e i dettagli si cancellano dopo 30 giorni."],
  ['Non resti solo', "Se ti chiamano lontano da casa, l'app ti indica il gruppo d'aiuto di quella provincia, per informazioni e alloggio."],
];

function Accesso({ s, c, srv, registrato, codiceIniziale, errore, onFatto }: {
  s: any; c: Pal; srv: StatoServer | null; registrato: boolean; codiceIniziale: string; errore: string; onFatto: () => void;
}) {
  const [passo, setPasso] = useState<'guida' | 'codice' | 'classi'>(codiceIniziale ? 'codice' : 'guida');
  const [pag, setPag] = useState(0);
  const [codice, setCodice] = useState(codiceIniziale);
  const [classi, setClassi] = useState<string[]>([]);
  const [altra, setAltra] = useState('');
  const [msg, setMsg] = useState('');
  const [prov, setProv] = useState('');
  const [invito, setInvito] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (codiceIniziale) setCodice(codiceIniziale); }, [codiceIniziale]);

  const invia = async (conCodice: boolean) => {
    setBusy(true); setErr('');
    try {
      if (registrato && conCodice) await usaCodice(codice.trim());
      else {
        await registra({ codice: conCodice ? codice.trim() : undefined, classi, provincia: prov.trim().toUpperCase() || undefined, messaggio: msg.trim(), invito });
        if (!conCodice) await savePrefs({ ...(await loadPrefs()), classi });
      }
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
      {errore ? <Text style={[s.small, { color: c.crit }]}>{errore}</Text> : null}
      {passo === 'guida' ? (
        <View style={s.card}>
          <Text style={s.title}>{GUIDA[pag][0]}</Text>
          <Text style={s.body}>{GUIDA[pag][1]}</Text>
          <Text style={s.small}>{pag + 1} di {GUIDA.length}</Text>
          <Pressable style={[s.btn, s.btnPrimary]} onPress={() => (pag < GUIDA.length - 1 ? setPag(pag + 1) : setPasso('classi'))}>
            <Text style={[s.btnText, { color: c.accentInk }]}>{pag < GUIDA.length - 1 ? 'Avanti' : 'Inizia'}</Text>
          </Pressable>
          {pag > 0 ? <Pressable style={s.btn} onPress={() => setPag(pag - 1)}><Text style={s.btnText}>Indietro</Text></Pressable> : null}
          <Pressable style={s.btn} onPress={() => setPasso('codice')}><Text style={s.btnText}>Ho un codice del mio gruppo</Text></Pressable>
        </View>
      ) : passo === 'codice' ? (
        <View style={s.card}>
          <Text style={s.title}>Hai un codice del tuo gruppo?</Text>
          <TextInput value={codice} onChangeText={setCodice} autoCapitalize="characters" placeholder="XXXX-XXXX-XXXX" placeholderTextColor={c.muted} style={s.input} />
          <Pressable disabled={busy || codice.trim().length < 4} style={[s.btn, s.btnPrimary]} onPress={() => invia(true)}>
            <Text style={[s.btnText, { color: c.accentInk }]}>{busy ? 'Attivazione…' : 'Entra con il codice'}</Text>
          </Pressable>
          <Pressable style={s.btn} onPress={() => setPasso('classi')}><Text style={s.btnText}>Non ho un codice: provo gratis 7 giorni</Text></Pressable>
          {err ? <Text style={[s.small, { color: c.crit }]}>{err}</Text> : null}
        </View>
      ) : (
        <View style={s.card}>
          <Text style={s.title}>Quali classi di concorso hai? (massimo 5)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {CLASSI_COMUNI.map(([cl, nome]) => {
              const on = classi.includes(cl);
              return (
                <Pressable key={cl} onPress={() => setClassi(on ? classi.filter((x) => x !== cl) : classi.length < 5 ? [...classi, cl] : classi)} style={[s.chip, on && s.chipOn]}>
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
            <Pressable style={s.btn} onPress={() => { const x = normClasse(altra); if (x.length >= 2 && !classi.includes(x) && classi.length < 5) setClassi([...classi, x]); setAltra(''); }}><Text style={s.btnText}>Aggiungi</Text></Pressable>
          </View>
          <Text style={s.title}>Da quale provincia vieni?</Text>
          <TextInput value={prov} onChangeText={setProv} autoCapitalize="characters" maxLength={2} placeholder="Sigla provincia (es. CT)" placeholderTextColor={c.muted} style={s.input} />
          <Text style={s.small}>Ti serve a trovare il gruppo d’aiuto dove ti chiamano. Nessun dato personale.</Text>
          <TextInput value={invito} onChangeText={setInvito} autoCapitalize="characters" maxLength={12} placeholder="Codice invito di un collega (facoltativo)" placeholderTextColor={c.muted} style={s.input} />
          <Pressable disabled={busy || !classi.length || prov.trim().length !== 2} style={[s.btn, s.btnPrimary, (busy || !classi.length || prov.trim().length !== 2) && { opacity: 0.4 }]} onPress={() => invia(false)}>
            <Text style={[s.btnText, { color: c.accentInk }]}>{busy ? 'Avvio…' : 'Inizia la prova gratuita di 7 giorni'}</Text>
          </Pressable>
          <Pressable style={s.btn} onPress={() => setPasso('guida')}><Text style={s.btnText}>Indietro</Text></Pressable>
          {err ? <Text style={[s.small, { color: c.crit }]}>{err}</Text> : null}
        </View>
      )}
    </ScrollView>
  );
}

/** Dopo la prova: numeri totali e avvisi oscurati. Il server non invia scuola, link ne' indirizzo: qui si disegnano solo segnaposto. */
function LimitatoBox({ s, c, feed, modo, classiUtente, onVerifica }: {
  s: any; c: Pal; feed: Feed | null; modo: 'interpelli' | 'mappa'; classiUtente: string[]; onVerifica: () => void;
}) {
  const r = feed?.riepilogo;
  const barra = (w: number) => ({ height: 10, width: `${w}%` as `${number}%`, borderRadius: 5, backgroundColor: c.muted, opacity: 0.25 });
  const perClasse = Object.entries(r?.per_classe || {}).sort((a, b) => b[1] - a[1]);
  const mie = perClasse.filter(([k]) => classiUtente.includes(k));
  const altre = perClasse.filter(([k]) => !classiUtente.includes(k)).slice(0, 14);
  const perReg = Object.entries(r?.per_regione || {}).sort((a, b) => b[1] - a[1]);
  const perProv = Object.entries(r?.per_provincia || {}).sort((a, b) => b[1] - a[1]).slice(0, 20);
  const max = Math.max(1, ...perReg.map(([, n]) => n));
  const esempi = (feed?.interpelli || []).slice(0, 6);
  return (
    <ScrollView contentContainerStyle={s.list}>
      <View style={s.card}>
        <Text style={[s.h1, { fontSize: 38 }]}>{r?.totale ?? '—'}</Text>
        <Text style={s.body}>interpelli aperti in tutta Italia, per tutte le classi di concorso.</Text>
        <Text style={s.muted}>Scuola, avviso e link si aprono con la verifica del profilo.</Text>
        <Pressable style={[s.btn, s.btnPrimary]} onPress={onVerifica}><Text style={[s.btnText, { color: c.accentInk }]}>Sblocca con la verifica</Text></Pressable>
      </View>
      {modo === 'interpelli' ? (
        <>
          {mie.length ? (
            <View style={s.card}>
              <Text style={s.title}>Per le tue classi</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {mie.map(([k, n]) => <View key={k} style={[s.chip, s.chipOn]}><Text style={[s.chipText, s.chipTextOn]}>{k} · {n}</Text></View>)}
              </View>
            </View>
          ) : null}
          <View style={s.card}>
            <Text style={s.title}>Tutte le classi</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {altre.map(([k, n]) => <View key={k} style={s.chip}><Text style={s.chipText}>{k} · {n}</Text></View>)}
            </View>
          </View>
          {esempi.map((it) => (
            <View key={it.id} style={[s.card, { opacity: 0.9 }]}>
              <Text style={s.title}>{(it.classi || []).join(' · ')}{it.provincia ? '  ·  ' + it.provincia : ''}</Text>
              <View style={barra(70)} /><View style={barra(45)} />
              <Text style={s.small}>{it.scadenza ? 'Scade ' + fmtDate(it.scadenza) : 'Scadenza non indicata'}  ·  🔒 oscurato</Text>
            </View>
          ))}
        </>
      ) : (
        <>
          <View style={s.card}>
            <Text style={s.title}>Interpelli per regione</Text>
            {perReg.map(([k, n]) => (
              <View key={k} style={{ gap: 3, marginTop: 6 }}>
                <Text style={s.body}>{k} · {n}</Text>
                <View style={{ height: 8, width: `${Math.max(4, Math.round((n / max) * 100))}%` as `${number}%`, borderRadius: 4, backgroundColor: c.accent }} />
              </View>
            ))}
          </View>
          <View style={s.card}>
            <Text style={s.title}>Province con più interpelli</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {perProv.map(([k, n]) => <View key={k} style={s.chip}><Text style={s.chipText}>{k} · {n}</Text></View>)}
            </View>
            <Text style={s.small}>La mappa con le scuole si sblocca con la verifica.</Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

/** Verifica del profilo: chiediamo solo cio' che serve e non conserviamo documenti. */
function VerificaBox({ s, c, srv, onFatto }: { s: any; c: Pal; srv: StatoServer; onFatto: () => void }) {
  const [classi, setClassi] = useState<string[]>(srv.classi_dichiarate || []);
  const [altra, setAltra] = useState('');
  const [come, setCome] = useState<'gps' | 'titolo' | 'servizio'>('gps');
  const [prov, setProv] = useState('');
  const [descr, setDescr] = useState('');
  const [email, setEmail] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const COME: [typeof come, string, string][] = [
    ['gps', 'Sono nelle GPS', 'es. prima fascia, provincia di Enna'],
    ['titolo', 'Ho il titolo', 'es. laurea o diploma ITS, e l’ateneo o l’istituto'],
    ['servizio', 'Ho già lavorato', 'es. supplenza come ITP B015 nel 2025/26'],
  ];
  if (srv.verificato) {
    return (
      <ScrollView contentContainerStyle={s.list}>
        <View style={s.card}>
          <Text style={s.title}>Profilo verificato ✔</Text>
          <Text style={s.body}>Classi verificate: {srv.classi.includes('*') ? 'tutte' : srv.classi.join(', ') || '—'}.</Text>
          <Text style={s.muted}>Per aggiungere un’altra classe, torna qui e invia una nuova richiesta.</Text>
        </View>
      </ScrollView>
    );
  }
  const invia = async () => {
    setBusy(true); setErr('');
    try {
      await inviaVerifica({ classi, come, provincia: prov.trim().toUpperCase(), descrizione: descr.trim(), email: email.trim(), consenso: ok });
      toast('Richiesta inviata');
      onFatto();
    } catch (e: any) {
      setErr(e?.message || 'Errore');
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
      <View style={s.card}>
        <Text style={s.title}>Verifica il tuo profilo</Text>
        <Text style={s.body}>Serve a tenere l’app affidabile: chi dà consigli su alloggi e aiuto è una persona reale con la classe di concorso che dichiara. Dopo la verifica si aprono scuole, avvisi e mappa per le tue classi.</Text>
        <Text style={s.muted}>Ti chiediamo solo le quattro cose qui sotto. Non chiediamo codice fiscale, documento d’identità, tessera sindacale né allegati. I dettagli si cancellano 30 giorni dopo la decisione: resta solo l’esito.</Text>
        {srv.richiesta_aperta ? <Text style={[s.body, { color: c.accent }]}>Hai già una richiesta in corso: ti rispondiamo appena possibile.</Text> : null}
      </View>
      <View style={s.card}>
        <Text style={s.title}>1 · Per quali classi? (massimo 5)</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {classi.map((x) => (
            <Pressable key={x} onPress={() => setClassi(classi.filter((y) => y !== x))} style={[s.chip, s.chipOn]}><Text style={[s.chipText, s.chipTextOn]}>{x}  ✕</Text></Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={altra} onChangeText={setAltra} autoCapitalize="characters" placeholder="Aggiungi classe (es. B015)" placeholderTextColor={c.muted} style={[s.input, { flex: 1 }]} />
          <Pressable style={s.btn} onPress={() => { const x = normClasse(altra); if (x.length >= 2 && !classi.includes(x) && classi.length < 5) setClassi([...classi, x]); setAltra(''); }}><Text style={s.btnText}>Aggiungi</Text></Pressable>
        </View>
        <Text style={s.small}>Puoi verificare una classe oggi e le altre dopo.</Text>
      </View>
      <View style={s.card}>
        <Text style={s.title}>2 · Come puoi dimostrarlo?</Text>
        {COME.map(([k, l, es]) => (
          <Pressable key={k} onPress={() => setCome(k)} style={[s.chip, come === k && s.chipOn, { alignSelf: 'stretch' }]}>
            <Text style={[s.chipText, come === k && s.chipTextOn]}>{l}</Text>
            <Text style={[s.small, come === k && { color: c.accentInk }]}>{es}</Text>
          </Pressable>
        ))}
        <TextInput value={descr} onChangeText={setDescr} multiline maxLength={300} placeholder="Scrivi in una riga i dettagli (senza documenti né codice fiscale)" placeholderTextColor={c.muted} style={s.input} />
        <TextInput value={prov} onChangeText={setProv} autoCapitalize="characters" maxLength={2} placeholder="Provincia (es. EN)" placeholderTextColor={c.muted} style={s.input} />
      </View>
      <View style={s.card}>
        <Text style={s.title}>3 · Email per risponderti</Text>
        <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="nome@esempio.it" placeholderTextColor={c.muted} style={s.input} />
        <Text style={s.small}>Non è pubblica: la vede solo l’amministratore, che la usa per risponderti.</Text>
      </View>
      <View style={s.card}>
        <Pressable onPress={() => setOk(!ok)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Text style={[s.title, { fontSize: 22 }]}>{ok ? '☑' : '☐'}</Text>
          <Text style={[s.body, { flex: 1 }]}>Acconsento a trattare questi dati solo per verificare il mio profilo, e so che si cancellano dopo 30 giorni.</Text>
        </Pressable>
        <Pressable disabled={busy || !ok || !classi.length || !descr.trim() || !email.includes('@')} style={[s.btn, s.btnPrimary, (busy || !ok || !classi.length || !descr.trim() || !email.includes('@')) && { opacity: 0.4 }]} onPress={invia}>
          <Text style={[s.btnText, { color: c.accentInk }]}>{busy ? 'Invio…' : 'Invia la richiesta'}</Text>
        </Pressable>
        {err ? <Text style={[s.small, { color: c.crit }]}>{err}</Text> : null}
      </View>
    </ScrollView>
  );
}

function InvitaBox({ s, c, srv }: { s: any; c: Pal; srv: StatoServer | null }) {
  if (!srv?.codice_invito) return null;
  const n = srv.inviti_verificati || 0;
  const testo = `Uso Interpellati per trovare gli interpelli e le supplenze di tutta Italia, gratis. Scaricala qui: ${LINK_APP}\nAl primo avvio scrivi il mio codice invito ${srv.codice_invito}: quando verifichi le tue classi ci guadagniamo entrambi.`;
  return (
    <View style={s.card}>
      <Text style={s.title}>Invita un collega</Text>
      <Text style={s.body}>Per ogni collega che completa la verifica ricevi 7 giorni di prova in più e una classe in più da seguire. Hai portato {n} {n === 1 ? 'collega verificato' : 'colleghi verificati'} (massimo 8).</Text>
      <Text style={[s.title, { letterSpacing: 2 }]} selectable>{srv.codice_invito}</Text>
      <Pressable style={[s.btn, s.btnPrimary]} onPress={() => { Share.share({ message: testo }).catch(() => copia(testo)); }}>
        <Text style={[s.btnText, { color: c.accentInk }]}>Condividi l'app</Text>
      </Pressable>
      <Text style={s.small}>Il premio arriva solo quando il collega completa la verifica, non per la sola installazione.</Text>
    </View>
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
        <Text style={s.title}>Versione dell'app</Text>
        <Text style={s.muted}>Installata: {Constants.expoConfig?.version || ''} (build {String((Constants.expoConfig as any)?.android?.versionCode ?? '')}). Per aggiornare scarica l'ultima versione e aprila: si installa sopra questa senza perdere i tuoi dati.</Text>
        <Pressable style={[s.btn, s.btnPrimary]} onPress={() => Linking.openURL('https://github.com/mhadhbimedwork-crypto/Interpellati/releases/download/apk/Interpellati.apk').catch(() => copia('https://github.com/mhadhbimedwork-crypto/Interpellati/releases/download/apk/Interpellati.apk'))}>
          <Text style={[s.btnText, { color: c.accentInk }]}>Scarica l'ultima versione</Text>
        </Pressable>
      </View>
      <View style={s.card}>
        <Text style={s.title}>Contatta l'amministratore</Text>
        <Text style={s.muted}>Per attivare nuove classi o regioni, segnalare un problema o proporre un'idea.</Text>
        <ContattiBox s={s} c={c} srv={srv} />
      </View>
      {server ? <InvitaBox s={s} c={c} srv={srv} /> : null}
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
      {feed?.copertura ? <CoperturaBox s={s} c={c} cop={feed.copertura} aperta /> : null}
      {!feed?.copertura && feed?.sicilia ? (
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

type ScuolaRiga = [string, string, string, string, string, string, string, string, number, string];
const SCUOLE_URL = 'https://raw.githubusercontent.com/mhadhbimedwork-crypto/Interpellati/main/data/scuole_stato.json';
const K_SCUOLE = 'scuole.cache';

/** Elenco di tutte le scuole statali con lo stato della ricerca: verde = sito letto, arancione = in ricerca, rosso = non si trova. */
function ScuoleTab({ s, c }: { s: any; c: Pal }) {
  const [dati, setDati] = useState<ScuolaRiga[]>([]);
  const [agg, setAgg] = useState('');
  const [q, setQ] = useState('');
  const [stato, setStato] = useState<'' | 'v' | 'a' | 'r'>('');
  const [reg, setReg] = useState('');
  const [max, setMax] = useState(40);
  const [errore, setErrore] = useState('');
  useEffect(() => {
    (async () => {
      try {
        const cache = await AsyncStorage.getItem(K_SCUOLE);
        if (cache) { const j = JSON.parse(cache); setDati(j.scuole); setAgg(j.aggiornato || ''); }
      } catch {}
      try {
        const r = await fetch(SCUOLE_URL + '?t=' + Date.now());
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const t = await r.text();
        const j = JSON.parse(t);
        setDati(j.scuole); setAgg(j.aggiornato || ''); setErrore('');
        AsyncStorage.setItem(K_SCUOLE, t).catch(() => {});
      } catch (e: any) { setErrore(String(e?.message || e)); }
    })();
  }, []);
  const regioni = useMemo(() => Array.from(new Set(dati.map((d) => d[4]))).sort(), [dati]);
  const tot = useMemo(() => ({ v: dati.filter((d) => d[5] === 'v').length, a: dati.filter((d) => d[5] === 'a').length, r: dati.filter((d) => d[5] === 'r').length }), [dati]);
  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    return dati.filter((d) => (!stato || d[5] === stato) && (!reg || d[4] === reg) && (!t || (d[0] + ' ' + d[1] + ' ' + d[2] + ' ' + d[3]).toLowerCase().includes(t)));
  }, [dati, q, stato, reg]);
  const col = (x: string) => (x === 'v' ? c.ok : x === 'a' ? c.warn : c.crit);
  const soft = (x: string) => (x === 'v' ? c.okSoft : x === 'a' ? c.warnSoft : c.critSoft);
  const nome = (x: string) => (x === 'v' ? 'Sito letto' : x === 'a' ? 'Ancora in ricerca' : 'Non si trova');
  return (
    <ScrollView contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
      <Text style={s.body}>
        Tutte le scuole statali italiane e come le sta cercando l'app: verde = sito letto, arancione = ancora in ricerca, rosso = non si trova. Cerca per nome, comune, provincia o codice.
      </Text>
      <TextInput style={s.input} value={q} onChangeText={(v) => { setQ(v); setMax(40); }} placeholder="Cerca scuola, comune, provincia, codice…" placeholderTextColor={c.muted} autoCapitalize="none" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {([['', 'Tutte ' + dati.length], ['v', 'Verdi ' + tot.v], ['a', 'Arancioni ' + tot.a], ['r', 'Rosse ' + tot.r]] as ['' | 'v' | 'a' | 'r', string][]).map(([k, l]) => (
          <Pressable key={k} onPress={() => { setStato(k); setMax(40); }} style={[s.chip, stato === k && s.chipOn]}>
            <Text style={[s.chipText, stato === k && s.chipTextOn]}>{l}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {['', ...regioni].map((r) => (
          <Pressable key={r || 'tutte'} onPress={() => { setReg(r); setMax(40); }} style={[s.chip, reg === r && s.chipOn]}>
            <Text style={[s.chipText, reg === r && s.chipTextOn]}>{r || 'Tutta Italia'}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {!dati.length ? <Text style={s.muted}>{errore ? 'Elenco non raggiungibile: ' + errore : 'Carico l\'elenco delle scuole…'}</Text> : <Text style={s.muted}>{lista.length.toLocaleString('it-IT')} scuole{agg ? ' · aggiornato ' + fmtDate(agg) : ''}</Text>}
      {lista.slice(0, max).map((d) => (
        <View key={d[0]} style={[s.card, { borderLeftWidth: 5, borderLeftColor: col(d[5]), gap: 3 }]}>
          <Text style={s.title}>{d[1]}</Text>
          <Text style={s.muted}>{d[2]} ({d[3]}) · {d[4]} · {d[0]}</Text>
          <Text style={[s.pill, { backgroundColor: soft(d[5]), color: col(d[5]), alignSelf: 'flex-start' }]}>{nome(d[5])}</Text>
          {d[5] !== 'v' ? <Text style={s.small}>{d[7]}</Text> : null}
          {d[8] ? <Text style={s.small}>{d[8]} avvisi trovati in questa scuola</Text> : null}
          <View style={s.actions}>
            {d[6] ? <Pressable onPress={() => Linking.openURL(d[6]).catch(() => {})} style={s.btn}><Text style={s.btnText}>Apri il sito</Text></Pressable> : null}
            {d[9] ? <Pressable onPress={() => Linking.openURL(d[9]).catch(() => {})} style={[s.btn, s.btnPrimary]}><Text style={[s.btnText, { color: c.accentInk }]}>Ultimo avviso</Text></Pressable> : null}
          </View>
        </View>
      ))}
      {lista.length > max ? (
        <Pressable onPress={() => setMax(max + 60)} style={s.btn}><Text style={s.btnText}>Mostra altre ({lista.length - max})</Text></Pressable>
      ) : null}
    </ScrollView>
  );
}

function CoperturaBox({ s, c, cop, aperta = false }: { s: any; c: Pal; cop: NonNullable<Feed['copertura']>; aperta?: boolean }) {
  const [vedi, setVedi] = useState(aperta);
  const reg = Object.entries(cop.perRegione || {}).sort((a, b) => b[1].percentuale - a[1].percentuale);
  return (
    <Pressable onPress={() => setVedi(!vedi)} style={[s.card, { gap: 4 }]} accessibilityRole="button">
      <Text style={s.label}>COPERTURA DELLA RICERCA</Text>
      <Text style={s.title}>{cop.letti.toLocaleString('it-IT')} scuole controllate su {cop.istituti.toLocaleString('it-IT')} · {String(cop.percentuale).replace('.', ',')}%</Text>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: c.line, overflow: 'hidden' }}>
        <View style={{ width: `${Math.min(100, cop.percentuale)}%` as `${number}%`, height: 8, backgroundColor: c.ok }} />
      </View>
      <Text style={s.small}>
        Siti delle scuole statali letti uno per uno{cop.uffici ? ', più ' + cop.uffici + ' uffici scolastici e gli aggregatori nazionali' : ''}. {vedi ? 'Tocca per chiudere.' : 'Tocca per il dettaglio per regione.'}
      </Text>
      {vedi ? reg.map(([r, v]) => (
        <View key={r} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[s.body, { width: 120 }]} numberOfLines={1}>{r}</Text>
          <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: c.line, overflow: 'hidden' }}>
            <View style={{ width: `${Math.min(100, v.percentuale)}%` as `${number}%`, height: 6, backgroundColor: v.percentuale >= 80 ? c.ok : v.percentuale >= 50 ? c.warn : c.crit }} />
          </View>
          <Text style={[s.small, { width: 92, textAlign: 'right' }]}>{v.letti}/{v.istituti} · {Math.round(v.percentuale)}%</Text>
        </View>
      )) : null}
    </Pressable>
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
      {it.riservato === 'interni' ? (
        <Text style={[s.small, { color: c.warn, backgroundColor: c.warnSoft, padding: 8 }]}>
          Riservato ai docenti già in servizio in questa scuola (ore aggiuntive). Se le ore restano scoperte la scuola nomina da graduatoria d'istituto: se sei in graduatoria o hai inviato la MAD, scrivi alla segreteria.
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
      {it.segnalazioni && it.segnalazioni > 1 ? (
        <Text style={s.small}>
          {it.segnalazioni} posti segnalati dal portale regionale per questa scuola e classe
          {it.primaSegnalazione ? ` (dal ${it.primaSegnalazione.split('-').reverse().join('/')})` : ''}
        </Text>
      ) : null}
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
