import type { BerthStatus, ContractStatus, ContractType, PaymentMethod, Presence, Role, Season } from "@/db/schema";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Direzione",
  ufficio: "Ufficio",
  banchina: "Operatore di banchina",
};

export const ROLE_HINT: Record<Role, string> = {
  admin: "Accesso completo, incluse impostazioni, tariffe e utenti.",
  ufficio: "Anagrafiche, contratti e contabilità.",
  banchina: "Mappa, arrivi e partenze, segnalazioni. Nessun dato contabile.",
};

export const CONTRACT_TYPE_LABEL: Record<ContractType, string> = {
  annuale: "Annuale",
  stagionale: "Stagionale",
  mensile: "Mensile",
  transito: "Transito",
};

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  bozza: "Bozza",
  attivo: "Attivo",
  concluso: "Concluso",
  annullato: "Annullato",
};

export const PRESENCE_LABEL: Record<Presence, string> = {
  atteso: "In arrivo",
  in_porto: "In porto",
  fuori: "Fuori in mare",
  partito: "Partito",
};

export const BERTH_STATUS_LABEL: Record<BerthStatus, string> = {
  attivo: "In servizio",
  manutenzione: "In manutenzione",
  fuori_servizio: "Fuori servizio",
};

export const SEASON_LABEL: Record<Season, string> = { bassa: "Bassa", media: "Media", alta: "Alta" };

export const BOAT_TYPE_LABEL = {
  vela: "Barca a vela",
  motore: "Barca a motore",
  gommone: "Gommone",
  catamarano: "Catamarano",
  altro: "Altro",
} as const;

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  contanti: "Contanti",
  bonifico: "Bonifico",
  pos: "POS / carta",
  assegno: "Assegno",
  altro: "Altro",
};

export const CHARGE_KIND_LABEL = {
  ormeggio: "Ormeggio",
  servizi: "Servizi",
  utenze: "Utenze",
  altro: "Altro",
} as const;

export const CONSENT_LABEL = {
  informativa: "Presa visione dell'informativa privacy",
  marketing: "Comunicazioni commerciali e promozionali",
  terzi: "Comunicazione dei dati a terzi (cantieri, assistenza)",
} as const;

export const CONSENT_SHORT = { informativa: "Informativa", marketing: "Marketing", terzi: "Terzi" } as const;

export const CONSENT_METHOD_LABEL = { cartaceo: "Modulo cartaceo firmato", digitale: "Modulo digitale", verbale: "Verbale" } as const;

export const TASK_KIND_LABEL = {
  assistenza: "Assistenza all'ormeggio",
  manutenzione: "Manutenzione",
  segnalazione: "Segnalazione",
  servizio: "Servizio richiesto",
} as const;

export const TASK_PRIORITY_LABEL = { bassa: "Bassa", normale: "Normale", alta: "Urgente" } as const;
export const TASK_STATUS_LABEL = { aperta: "Aperta", in_corso: "In corso", chiusa: "Chiusa" } as const;

export const MOVEMENT_LABEL = { arrivo: "Arrivo", partenza: "Partenza", uscita: "Uscita in mare", rientro: "Rientro" } as const;

export const LEDGER_CATEGORIES = {
  entrata: ["Ormeggi", "Servizi", "Utenze", "Altre entrate"],
  uscita: ["Personale", "Manutenzioni", "Utenze", "Canoni e concessioni", "Forniture", "Imposte e tasse", "Altre uscite"],
} as const;

export const CHARGE_TO_LEDGER_CATEGORY = { ormeggio: "Ormeggi", servizi: "Servizi", utenze: "Utenze", altro: "Altre entrate" } as const;
