"use client";

import { useState, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";

const ZOOMS = [1, 1.5, 2, 3, 4];

// Riquadro scorrevole con ingrandimento per la pianta dal vero.
export function PlanZoom({ children }: { children: ReactNode }) {
  const [zoom, setZoom] = useState(1);
  const index = ZOOMS.indexOf(zoom);
  return (
    <div>
      <div className="no-print mb-2 flex items-center justify-end gap-1">
        <button type="button" className="btn btn-secondary btn-sm" aria-label="Riduci" disabled={index === 0} onClick={() => setZoom(ZOOMS[index - 1])}>
          <Minus size={15} aria-hidden="true" />
        </button>
        <span className="w-12 text-center text-sm text-muted tabular-nums">{Math.round(zoom * 100)}%</span>
        <button type="button" className="btn btn-secondary btn-sm" aria-label="Ingrandisci" disabled={index === ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[index + 1])}>
          <Plus size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="max-h-[78vh] overflow-auto rounded-lg border border-sea/20 bg-sea-soft">
        <div style={{ width: `${zoom * 100}%` }}>{children}</div>
      </div>
    </div>
  );
}
