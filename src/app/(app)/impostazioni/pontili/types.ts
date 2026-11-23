import type { BerthStatus, ContractType } from "@/db/schema";
import type { BerthState } from "@/server/board";

// Dati che la pagina Pontili e posti passa all'interfaccia (tutti già filtrati per il porto della sessione).

export interface ManagerSection {
  id: string;
  label: string;
}

export interface ManagerPier {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  baseRate: boolean;
  sections: ManagerSection[];
  /** Contratti attivi in corso o futuri sui suoi posti. */
  contracts: number;
}

export interface ManagerOccupant {
  contractId: string;
  number: string | null;
  type: ContractType;
  startDate: string;
  endDate: string;
  boatName: string;
  ownerName: string;
  ownerPhone: string | null;
}

export interface ManagerBerth {
  id: string;
  code: string;
  pierId: string;
  sectionId: string | null;
  side: "sx" | "dx";
  position: number;
  categoryId: string | null;
  lengthCm: number;
  beamCm: number;
  draftCm: number | null;
  hasWater: boolean;
  hasPower: boolean;
  status: BerthStatus;
  notes: string | null;
  /** Stato di oggi, come sulla mappa. */
  state: BerthState;
  occupant: ManagerOccupant | null;
}

export interface ManagerCategory {
  id: string;
  name: string;
  /** «II (8,00 × 2,90 m)» */
  label: string;
}

/** Una struttura della scheda: un tratto, i posti fuori dai tratti o, nei pontili semplici, tutti i posti. */
export interface ManagerUnit {
  /** Id del tratto; null = il pontile. */
  sectionId: string | null;
  title: string;
  label: string;
  berths: ManagerBerth[];
}
