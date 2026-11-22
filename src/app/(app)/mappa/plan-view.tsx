import Link from "next/link";
import { berthSizePx } from "@/lib/plan";
import { ServiceMarker } from "@/components/service-icon";
import { boatPath, cabinPath, type Drawing } from "@/lib/plan-drawing";
import { pathOf, type PlanFeature } from "@/lib/plan-features";
import { PIER, SHAPE, WATER } from "@/lib/plan-style";
import { serviceTitle } from "@/lib/port-services";
import { STATE_LABEL, type BerthState, type BoardBerth } from "@/server/board";

// Colori della barca per stato; «sagoma» = barca assegnata ma non in porto (tratteggiata).
const BOAT: Record<BerthState, { fill: string; stroke: string; text: string; ghost?: boolean } | null> = {
  libero: null,
  fermo: null,
  occupato: { fill: "#0f6480", stroke: "#ffffff", text: "#ffffff" },
  partenza: { fill: "#d4502a", stroke: "#ffffff", text: "#ffffff" },
  ritardo: { fill: "#a93229", stroke: "#ffffff", text: "#ffffff" },
  atteso: { fill: "#fbefd2", stroke: "#875400", text: "#875400", ghost: true },
  fuori: { fill: "#ffffff", stroke: "#0f6480", text: "#0b4d63", ghost: true },
};

// Aspetto del posto (lo specchio d'acqua) sotto la barca.
function slotStyle(state: BerthState, mode: "foto" | "schema") {
  if (state === "libero") return { fill: mode === "foto" ? "#ffffff" : "#dff1e9", fillOpacity: mode === "foto" ? 0.75 : 1, stroke: "#1b6b4f", text: "#1b6b4f" };
  if (state === "fermo") return { fill: "#d9d6cc", fillOpacity: 0.9, stroke: "#8794a0", text: "#566876" };
  return mode === "foto"
    ? { fill: "#ffffff", fillOpacity: 0.18, stroke: "#ffffff", text: "#12283a" }
    : { fill: "#ffffff", fillOpacity: 0.55, stroke: "#b5c4ce", text: "#12283a" };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Il porto con i posti barca. `foto`: sopra la foto aerea; `schema`: disegno pulito con i pontili grigi.
 * In entrambi ogni posto mostra la barca che lo occupa, con le sue misure e la poppa verso il pontile.
 */
export function PlanView({
  mode,
  berths,
  drawing,
  width,
  height,
  pxPerMeter,
  imageUrl,
  selectedId,
  hrefFor,
  features,
  bounds,
  baseUrl,
}: {
  mode: "foto" | "schema";
  // Sfondo (terra, acqua, verde, edifici) e servizi, già nell'ordine di disegno.
  features: PlanFeature[];
  // Area mostrata nello schema: tutto il porto disegnato.
  bounds: { x: number; y: number; width: number; height: number };
  // Base disegnata (stessa inquadratura della foto): nello schema sostituisce il disegno automatico di terra e pontili.
  baseUrl: string | null;
  berths: BoardBerth[];
  drawing: Drawing;
  width: number;
  height: number;
  pxPerMeter: number;
  imageUrl: string;
  selectedId: string | null;
  hrefFor: (berthId: string) => string;
}) {
  const view = mode === "schema" && !baseUrl ? bounds : { x: 0, y: 0, width, height };
  // Unità di disegno proporzionata all'area mostrata: spessori e testi non dipendono dalla risoluzione della foto.
  const u = Math.max(view.width, view.height) / 1000;
  const m = pxPerMeter;
  const markerSize = clamp(11 * u, 1.5 * m, 8 * m);

  return (
    <svg
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      className="block h-auto w-full"
      role="group"
      aria-label={mode === "schema" ? "Schema del porto con i posti barca" : "Pianta del porto con i posti barca"}
    >
      {mode === "foto" ? (
        <image href={imageUrl} width={width} height={height} />
      ) : baseUrl ? (
        <image href={baseUrl} width={width} height={height} preserveAspectRatio="none" />
      ) : (
        <>
          <rect x={view.x} y={view.y} width={view.width} height={view.height} fill={WATER} />
          {features.map((f) =>
            f.kind === "servizio" ? null : (
              <path key={f.id} d={pathOf(f.points)} strokeLinejoin="round" strokeWidth={0.15 * m} {...SHAPE[f.kind]}>
                {f.name && <title>{f.name}</title>}
              </path>
            ),
          )}
          {drawing.piers.map((p) => (
            <polygon
              key={p.id}
              points={p.outline.map((q) => `${q.x},${q.y}`).join(" ")}
              fill={PIER.fill}
              stroke={PIER.stroke}
              strokeWidth={0.12 * m}
              strokeLinejoin="round"
            />
          ))}
        </>
      )}

      {berths.map((b) => {
        if (b.planX === null || b.planY === null) return null;
        const { w, l } = berthSizePx(b, m);
        const slot = slotStyle(b.state, mode);
        const boat = BOAT[b.state];
        const o = b.occupant;
        const sternSign = drawing.stern.get(b.id) ?? 1;
        const selected = b.id === selectedId;
        const label = `Posto ${b.code}: ${STATE_LABEL[b.state]}${o ? `, ${o.boatName}` : ""}`;

        // La barca vera: lunga e larga quanto dichiarato (un poco di sporgenza al massimo), con la poppa al pontile.
        let boatShape: { d: string; y: number; l: number; w: number } | null = null;
        if (boat && o) {
          const bl = clamp((o.boatLengthCm / 100) * m, 2 * m, l * 1.1);
          const bw = clamp((o.boatBeamCm / 100) * m, 1 * m, w * 0.94);
          const sternGap = Math.min(0.4 * m, l * 0.04);
          boatShape = { d: boatPath(bl, bw), y: sternSign * (l / 2 - sternGap - bl / 2), l: bl, w: bw };
        }
        const textColor = boatShape && boat ? boat.text : slot.text;
        // Il codice sta al centro della barca (che è spostata verso la poppa), altrimenti al centro del posto.
        const angle = ((b.planAngle ?? 0) * Math.PI) / 180;
        const shift = boatShape?.y ?? 0;
        const tx = b.planX - Math.sin(angle) * shift;
        const ty = b.planY + Math.cos(angle) * shift;
        // Il codice si scrive lungo il posto (nel verso della barca), girato in modo da leggersi da sinistra a destra.
        const fontSize = clamp(Math.min(w * 0.62, (l * 0.7) / (0.62 * Math.max(2, b.code.length))), 0.5 * m, 2.2 * m);
        let textAngle = (b.planAngle ?? 0) + 90;
        textAngle = ((((textAngle + 180) % 360) + 360) % 360) - 180;
        if (textAngle >= 90) textAngle -= 180;
        else if (textAngle <= -90) textAngle += 180;

        return (
          <Link key={b.id} href={hrefFor(b.id)} aria-label={label} aria-current={selected ? "true" : undefined}>
            <title>{label}</title>
            <g transform={`translate(${b.planX} ${b.planY}) rotate(${b.planAngle ?? 0})`}>
              {selected && (
                <rect x={-w / 2 - 0.35 * m} y={-l / 2 - 0.35 * m} width={w + 0.7 * m} height={l + 0.7 * m} rx={0.3 * m} fill="none" stroke="#12283a" strokeWidth={0.3 * m} />
              )}
              <rect
                x={-w / 2}
                y={-l / 2}
                width={w}
                height={l}
                rx={0.12 * m}
                fill={b.state === "fermo" ? "url(#plan-fermo)" : slot.fill}
                fillOpacity={slot.fillOpacity}
                stroke={slot.stroke}
                strokeWidth={0.08 * m}
              />
              {boatShape && boat && (
                <g transform={`translate(0 ${boatShape.y}) scale(1 ${sternSign})`}>
                  <path
                    d={boatShape.d}
                    fill={boat.fill}
                    fillOpacity={boat.ghost ? 0.85 : 1}
                    stroke={boat.stroke}
                    strokeWidth={0.1 * m}
                    strokeDasharray={boat.ghost ? `${0.35 * m} ${0.25 * m}` : undefined}
                    strokeLinejoin="round"
                  />
                  {!boat.ghost && <path d={cabinPath(boatShape.l, boatShape.w)} fill="#ffffff" fillOpacity={0.28} />}
                </g>
              )}
            </g>
            <text
              x={tx}
              y={ty}
              transform={`rotate(${textAngle} ${tx} ${ty})`}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={fontSize}
              fontWeight={600}
              fill={textColor}
              pointerEvents="none"
            >
              {b.code}
            </text>
          </Link>
        );
      })}

      {features.map((f) =>
        f.kind === "servizio" && f.service ? (
          <g key={f.id}>
            <title>{serviceTitle(f.service, f.name)}</title>
            <ServiceMarker service={f.service} x={f.points[0].x} y={f.points[0].y} r={markerSize} />
          </g>
        ) : null,
      )}


      <defs>
        <pattern id="plan-fermo" width={0.8 * m} height={0.8 * m} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={0.8 * m} height={0.8 * m} fill="#e4e1d8" />
          <rect width={0.25 * m} height={0.8 * m} fill="#b9b4a6" />
        </pattern>
      </defs>
    </svg>
  );
}
