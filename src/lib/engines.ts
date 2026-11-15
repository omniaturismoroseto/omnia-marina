export interface EngineData {
  count: number | null;
  type: string | null;
  brand: string | null;
  powerHp: number | null;
}

/** Descrizione di una motorizzazione, es. "2 × entrobordo Volvo Penta, 150 HP". Vuota se non ci sono dati. */
export function describeEngine(e: EngineData): string {
  const what = [e.type, e.brand].filter(Boolean).join(" ");
  const parts = [e.count && e.count > 1 ? `${e.count} × ${what || "motori"}` : what, e.powerHp ? `${e.powerHp} HP` : null].filter(Boolean);
  return parts.join(", ");
}

export function mainEngine(b: { engineCount: number | null; engineType: string | null; engineBrand: string | null; enginePowerHp: number | null }): EngineData {
  return { count: b.engineCount, type: b.engineType, brand: b.engineBrand, powerHp: b.enginePowerHp };
}

export function auxEngine(b: { auxEngineCount: number | null; auxEngineType: string | null; auxEngineBrand: string | null; auxEnginePowerHp: number | null }): EngineData {
  return { count: b.auxEngineCount, type: b.auxEngineType, brand: b.auxEngineBrand, powerHp: b.auxEnginePowerHp };
}
