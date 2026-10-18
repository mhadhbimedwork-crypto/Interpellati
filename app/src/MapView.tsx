import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { daysLeft, Interpello, isOpen, parseDate } from './feed';
import { MAP_HTML } from './mapHtml';

type Pt = { id: string; lat: number; lon: number; st: 'o' | 's' | 'x'; g: 'i' | 'c' | 'p' };

/** Stato del punto: aperto (verde), scade entro 48 h (arancione), scaduto (grigio). */
export function statoPunto(it: Interpello): 'o' | 's' | 'x' {
  if (!isOpen(it)) return 'x';
  const l = daysLeft(parseDate(it.scadenza));
  return l !== null && l <= 1 ? 's' : 'o';
}

export function conCoordinate(it: Interpello): boolean {
  return typeof it.lat === 'number' && typeof it.lon === 'number';
}

export function MappaInterpelli({
  items, dark, fitKey, onSelect, onView, muted,
}: {
  items: Interpello[]; dark: boolean; fitKey: string;
  onSelect: (ids: string[]) => void; onView: (ids: string[], n: number) => void; muted: string;
}) {
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [late, setLate] = useState(false);
  const [errore, setErrore] = useState('');
  const [chiave, setChiave] = useState(0);
  const ultimoFit = useRef('');

  const punti = useMemo<Pt[]>(
    () =>
      items.filter(conCoordinate).map((i) => ({
        id: i.id, lat: i.lat as number, lon: i.lon as number, st: statoPunto(i), g: (i.geo as Pt['g']) || 'p',
      })),
    [items],
  );

  useEffect(() => {
    const t = setTimeout(() => setLate(true), 8000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!ready || !ref.current) return;
    const fit = ultimoFit.current !== fitKey;
    ultimoFit.current = fitKey;
    ref.current.injectJavaScript(`window.setTheme(${dark ? 'true' : 'false'});window.setData(${JSON.stringify(punti)},${fit ? 'true' : 'false'});true;`);
  }, [ready, punti, dark, fitKey]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.type === 'ready') setReady(true);
      else if (m.type === 'select') onSelect(m.ids || []);
      else if (m.type === 'err') setErrore(String(m.m || 'errore'));
      else if (m.type === 'view') onView(m.ids || [], m.n || 0);
    } catch {
      /* messaggio non valido: ignoro */
    }
  }, [onSelect, onView]);

  return (
    <View style={st.box}>
      <WebView
        key={chiave}
        ref={ref}
        onError={(e) => setErrore('WebView: ' + (e.nativeEvent?.description || 'errore'))}
        onRenderProcessGone={() => { setReady(false); setErrore('La mappa si è fermata: riprovo'); setChiave((k) => k + 1); }}
        onContentProcessDidTerminate={() => setChiave((k) => k + 1)}
        originWhitelist={['*']}
        source={{ html: MAP_HTML, baseUrl: 'https://interpellati.local/' }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled={false}
        mixedContentMode="always"
        androidLayerType="hardware"
        cacheEnabled
        setSupportMultipleWindows={false}
        overScrollMode="never"
        style={{ flex: 1, backgroundColor: dark ? '#27394a' : '#cfe3f1' }}
      />
      {ready && errore ? (
        <View style={st.err} pointerEvents="none"><Text style={{ color: '#fff', fontSize: 11 }}>{errore}</Text></View>
      ) : null}
      {!ready ? (
        <View style={st.over} pointerEvents="none">
          <ActivityIndicator />
          {late ? <Text style={{ color: muted, marginTop: 8 }}>La mappa si sta caricando…{errore ? ' ' + errore : ''}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  box: { flex: 1, overflow: 'hidden' },
  err: { position: 'absolute', left: 8, right: 8, top: 8, backgroundColor: 'rgba(160,30,30,.9)', borderRadius: 6, padding: 6 },
  over: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
