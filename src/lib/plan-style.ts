import type { FeatureKind } from "./plan-features";

// Colori dello schema della mappa, sul modello delle mappe illustrate dei marina.
export const WATER = "#eaf2f6";
export const PIER = { fill: "#c4c9cd", stroke: "#a7aeb4" };

export const SHAPE: Record<Exclude<FeatureKind, "servizio">, { fill: string; stroke: string }> = {
  terra: { fill: "#e2e4e6", stroke: "#c5cacf" },
  acqua: { fill: WATER, stroke: "none" },
  verde: { fill: "#d4e6cb", stroke: "#b8d1ab" },
  edificio: { fill: "#c9ced3", stroke: "#a6adb4" },
};
