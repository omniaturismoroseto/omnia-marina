import type { BerthState } from "@/server/board";

// Nomi degli stati dei posti sulla mappa: qui, fuori dal codice solo-server, perché li usa anche il disegno della mappa.
export const STATE_LABEL: Record<BerthState, string> = {
  libero: "Libero",
  occupato: "Occupato",
  fuori: "Barca fuori",
  atteso: "In arrivo",
  partenza: "In partenza",
  ritardo: "Oltre scadenza",
  fermo: "Non disponibile",
};
