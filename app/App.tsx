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
  Feed,
  fmtDate,
  Interpello,
  isNew,
  isOpen,
  loadCachedFeed,
  parseDate,
  registerBackground,
  takeNew,
  notifyNew,
} from './src/feed';

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
type Tab = 'interpelli' | 'candidature' | 'preferenze' | 'profilo';

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
      (it.pubblicato ? ' pubblicato il ' + fmtDate(it.pubblicato) : '') +
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
  const [fRegione, setFRegione] = useState('');
  const [q, setQ] = useState('');
  const [fOre, setFOre] = useState<'tutte' | 'poche' | 'medie' | 'piene'>('tutte');
  const [fDurata, setFDurata] = useState<'tutte' | 'breve' | 'intermedia' | 'fino_a_fine_anno'>('tutte');
  const [conND, setConND] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [bg, setBg] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const f = await fetchFeed();
      setFeed(f);
      setError('');
      const fresh = await takeNew(f, await loadPrefs());
      if (fresh.length) await notifyNew(fresh);
    } catch (e: any) {
      setError(e?.message || 'Connessione assente');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const cached = await loadCachedFeed();
      if (cached) setFeed(cached);
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
        if (fVista === 'aperti') return isOpen(it);
        if (fVista === 'nonrisposti') return isOpen(it) && !(cand[it.id] && cand[it.id].stato);
        return true;
      })
      .sort((a, b) => {
        const oa = isOpen(a), ob = isOpen(b);
        if (oa !== ob) return oa ? -1 : 1;
        const pa = parseDate(a.pubblicato)?.getTime() || 0, pb = parseDate(b.pubblicato)?.getTime() || 0;
        if (oa) {
          const da = parseDate(a.scadenza)?.getTime() ?? 9e15, db = parseDate(b.scadenza)?.getTime() ?? 9e15;
          if (da !== db) return da - db;
        }
        return pb - pa;
      });
  }, [base, fClasse, fVista, fRegione, q, cand, fOre, fDurata, conND]);

  const inviate = Object.values(cand).filter((x) => x.stato === 'inviata' || x.stato === 'convocato').length;
  const topPad = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 44;

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      <ExpoStatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <View style={s.header}>
        <Text style={s.h1}>Interpellati</Text>
        <Text style={s.who} numberOfLines={1}>
          {(prefs.classi.length ? prefs.classi.join(' · ') : 'Tutte le classi') + ' — ' + (prefs.regioni.length ? prefs.regioni.length + ' regioni' : 'tutta Italia')}
        </Text>
      </View>
      <View style={s.tabs}>
        {([
          ['interpelli', 'Interpelli', open.length],
          ['candidature', 'Candidature', inviate],
          ['preferenze', 'Preferenze', null],
          ['profilo', 'Profilo', null],
        ] as [Tab, string, number | null][]).map(([k, l, n]) => (
          <Pressable key={k} onPress={() => setTab(k)} style={[s.tab, tab === k && s.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}>
            <Text style={[s.tabText, tab === k && s.tabTextOn]}>
              {l}
              {n !== null ? '  ' + n : ''}
            </Text>
          </Pressable>
        ))}
      </View>

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
                {bg === false ? ' · controllo in background non disponibile su questo telefono' : ''}
              </Text>
              <Chips s={s} value={soloMie ? 'mie' : 'tutto'} set={(v) => { setSoloMie(v === 'mie'); setFClasse('tutte'); }} opts={[['mie', 'Le mie preferenze'], ['tutto', 'Tutte le classi e regioni']]} />
              {soloMie && prefs.classi.length > 1 ? (
                <Chips s={s} value={fClasse} set={setFClasse} opts={[['tutte', 'Tutte le mie'], ...prefs.classi.map((c) => [c, c] as [string, string])]} />
              ) : null}
              <Chips s={s} value={fVista} set={setFVista} opts={[['aperti', 'Aperti'], ['nonrisposti', 'Senza risposta'], ['tutti', 'Anche scaduti']]} />
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
            />
          )}
        />
      )}

      {tab === 'candidature' && (
        <ScrollView contentContainerStyle={s.list}>
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
    </View>
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
  it, s, c, cand, expanded, onToggle, profilo, saveCand,
}: {
  it: Interpello; s: any; c: Pal; cand?: Cand; expanded: boolean; onToggle: () => void;
  profilo: Record<string, string>; saveCand: (id: string, p: Partial<Cand>) => void;
}) {
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
        {cand?.stato ? (
          <Text style={[s.pill, { backgroundColor: c.okSoft, color: c.ok }]}>
            {cand.stato === 'inviata' ? 'Inviata' : cand.stato === 'convocato' ? 'Convocato' : 'Scartata'}
          </Text>
        ) : null}
      </View>
      <Text style={s.title}>{it.scuola || 'Interpello'}</Text>
      {place ? <Text style={s.muted}>{place}</Text> : null}
      <Text style={s.muted}>
        {[d ? 'Scadenza ' + fmtDate(d) + (it.oraScadenza ? ' ore ' + it.oraScadenza : '') : '', it.ore ? it.ore + ' ore/sett.' : '', it.periodo || '', it.pubblicato ? 'Pubblicato ' + fmtDate(it.pubblicato) : '']
          .filter(Boolean)
          .join(' · ')}
      </Text>
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
                onPress={() =>
                  Linking.openURL('mailto:' + it.email + '?subject=' + encodeURIComponent(m.subject) + '&body=' + encodeURIComponent(m.body)).catch(() => toast('Nessuna app di posta'))
                }
                style={[s.btn, s.btnPrimary]}>
                <Text style={[s.btnText, { color: c.accentInk }]}>Apri nella mail</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => copia(m.subject)} style={s.btn}><Text style={s.btnText}>Copia oggetto</Text></Pressable>
            <Pressable onPress={() => copia(m.body)} style={s.btn}><Text style={s.btnText}>Copia testo</Text></Pressable>
          </View>
          {!profilo.titolo ? <Text style={s.small}>Completa il Profilo per riempire i campi tra parentesi quadre.</Text> : null}
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
    tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: c.line, paddingHorizontal: 8, marginTop: 6 },
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
