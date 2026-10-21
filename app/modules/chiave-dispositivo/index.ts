import { requireOptionalNativeModule } from 'expo-modules-core';

/** Chiave EC P-256 generata e conservata nel Keystore Android (hardware quando disponibile).
 *  La chiave privata non esce mai dal telefono: un APK copiato su un altro dispositivo non puo' firmare. */
type Nativo = {
  chiavePubblica(): string;   // SPKI DER in base64
  idDispositivo(): string;    // sha256(SPKI) in esadecimale, primi 32 caratteri
  firma(messaggio: string): string; // firma SHA256withECDSA (DER) in base64
  hardware(): boolean;        // true se la chiave e' protetta da hardware sicuro
};

const N = requireOptionalNativeModule<Nativo>('ChiaveDispositivo');

export const chiaveDisponibile = !!N;
export const chiavePubblica = () => N!.chiavePubblica();
export const idDispositivo = () => N!.idDispositivo();
export const firma = (m: string) => N!.firma(m);
export const protettaDaHardware = () => (N ? N.hardware() : false);
