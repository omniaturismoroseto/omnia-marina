// Foto della barca: controlli sul file ricevuto e indirizzo per mostrarla. Funzioni pure, provate nei test.

import { imageInfo, type ImageInfo } from "./plan";

export const BOAT_PHOTO_MAX_BYTES = 3 * 1024 * 1024;
export const BOAT_PHOTO_MIN_SIDE = 160;
export const BOAT_PHOTO_MAX_SIDE = 2400;

/** Controlla una foto ricevuta dal browser: PNG o JPEG riconosciuti dal contenuto, mai SVG. */
export function checkBoatPhoto(bytes: Uint8Array): { ok: true; info: ImageInfo } | { ok: false; message: string } {
  if (bytes.length === 0) return { ok: false, message: "Nessun file ricevuto." };
  if (bytes.length > BOAT_PHOTO_MAX_BYTES) return { ok: false, message: "La foto è troppo pesante (massimo 3 MB)." };
  const info = imageInfo(bytes);
  if (!info) return { ok: false, message: "Il file non è una foto JPEG o PNG." };
  if (Math.min(info.width, info.height) < BOAT_PHOTO_MIN_SIDE) {
    return { ok: false, message: `La foto è troppo piccola: servono almeno ${BOAT_PHOTO_MIN_SIDE} pixel per lato.` };
  }
  if (Math.max(info.width, info.height) > BOAT_PHOTO_MAX_SIDE) {
    return { ok: false, message: `La foto è troppo grande: al massimo ${BOAT_PHOTO_MAX_SIDE} pixel per lato.` };
  }
  return { ok: true, info };
}

/** Indirizzo della foto, con la versione per la cache del browser; null se la barca non ha foto. */
export function boatPhotoUrl(boat: { id: string; hasPhoto: boolean; photoVersion: number }): string | null {
  return boat.hasPhoto ? `/barche/${boat.id}/foto?v=${boat.photoVersion}` : null;
}
