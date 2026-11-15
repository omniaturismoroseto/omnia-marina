// Logo della società di gestione del porto: controlli sul file caricato e dati per mostrarlo.
// Funzioni pure, provate nei test.

import { imageInfo, type ImageInfo } from "./plan";

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MIN_SIDE = 32;
export const LOGO_MAX_SIDE = 2000;

/**
 * Controlla un logo ricevuto dal browser. Il tipo si riconosce dal contenuto (PNG o JPEG), non dal nome del file:
 * niente SVG, che può contenere codice.
 */
export function checkLogo(bytes: Uint8Array): { ok: true; info: ImageInfo } | { ok: false; message: string } {
  if (bytes.length === 0) return { ok: false, message: "Nessun file ricevuto." };
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, message: "Il logo è troppo pesante (massimo 2 MB)." };
  const info = imageInfo(bytes);
  if (!info) return { ok: false, message: "Il file non è un'immagine PNG o JPEG." };
  if (Math.min(info.width, info.height) < LOGO_MIN_SIDE) {
    return { ok: false, message: `Il logo è troppo piccolo: servono almeno ${LOGO_MIN_SIDE} pixel per lato.` };
  }
  if (Math.max(info.width, info.height) > LOGO_MAX_SIDE) {
    return { ok: false, message: `Il logo è troppo grande: al massimo ${LOGO_MAX_SIDE} pixel per lato.` };
  }
  return { ok: true, info };
}

export interface PortLogoInfo {
  version: number;
  width: number;
  height: number;
}

/** Il logo del porto, se è stato caricato. */
export function portLogo(marina: { logoVersion: number; logoWidth: number | null; logoHeight: number | null }): PortLogoInfo | null {
  if (!marina.logoWidth || !marina.logoHeight) return null;
  return { version: marina.logoVersion, width: marina.logoWidth, height: marina.logoHeight };
}
