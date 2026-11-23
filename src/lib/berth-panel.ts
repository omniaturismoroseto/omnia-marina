// Calcoli del riquadro del posto sulla mappa: permanenza, spazio attorno alla barca, iniziali. Funzioni pure, provate nei test.

import { diffDays } from "./dates";

export interface Stay {
  /** Quanto del periodo è già passato, da 0 a 1. */
  progress: number;
  /** Frase breve: «parte domani», «ancora 12 giorni», «arriva tra 3 giorni»… */
  label: string;
  /** Il contratto è finito ma la barca è ancora sul posto. */
  late: boolean;
}

const days = (n: number) => (n === 1 ? "1 giorno" : `${n} giorni`);

/** Dove si trova la barca nel suo periodo, guardando il giorno mostrato sulla mappa. */
export function stayOf(startDate: string, endDate: string, date: string): Stay {
  const total = Math.max(1, diffDays(startDate, endDate));
  const progress = Math.min(1, Math.max(0, diffDays(startDate, date) / total));
  const toStart = diffDays(date, startDate);
  if (toStart > 0) return { progress: 0, label: toStart === 1 ? "arriva domani" : `arriva tra ${days(toStart)}`, late: false };
  const left = diffDays(date, endDate);
  if (left < 0) return { progress: 1, label: `scaduto da ${days(-left)}`, late: true };
  if (left === 0) return { progress, label: "parte oggi", late: false };
  if (left === 1) return { progress, label: "parte domani", late: false };
  return { progress, label: `ancora ${days(left)}`, late: false };
}

/** Spazio che resta attorno alla barca nel posto, in centimetri (negativo se la barca è più grande). */
export function boatFit(berth: { lengthCm: number; beamCm: number }, boat: { lengthCm: number; beamCm: number }) {
  const lengthCm = berth.lengthCm - boat.lengthCm;
  const beamCm = berth.beamCm - boat.beamCm;
  return { lengthCm, beamCm, fits: lengthCm >= 0 && beamCm >= 0 };
}

/** Iniziali di un nome per il tondo del proprietario: «Albertazzi Vittorio» → «AV», «Nautica Ionio S.r.l.» → «NI». */
export function initials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w.length > 1 || /\p{L}/u.test(w))
    .filter((w) => !/^(srl|spa|snc|sas|srls)$/i.test(w));
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Il modello da mostrare sotto il nome, se dice qualcosa in più del nome stesso. */
export function boatModelLabel(boat: { name: string; builder: string | null; model: string | null }): string | null {
  const model = [boat.builder, boat.model].filter(Boolean).join(" ").trim();
  if (!model || model.toLowerCase() === boat.name.trim().toLowerCase()) return null;
  return model;
}
