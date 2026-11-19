import Link from "next/link";
import type { ReactNode } from "react";
import { berthSizePx } from "@/lib/plan";
import { boatPath, drawingBounds, pierLayout, scaleBarMeters, type LandKind, type LandShape } from "@/lib/plan-drawing";
import { STATE_LABEL, type BerthState, type BoardBerth } from "@/server/board";

/** Quello che serve per disegnare un posto: i posti del tabellone, o quelli dell'anteprima nelle impostazioni. */
export type PlanBerthView = Pick<BoardBerth, "id" | "code" | "pierId" | "side" | "lengthCm" | "beamCm" | "planX" | "planY" | "planAngle" | "state"> & {
  occupant?: { boatName: string } | null;
};

// Aspetto di un posto sulla foto: riempimento semitrasparente, così sotto si intravede la barca.
const PHOTO_STYLE: Record<BerthState, { fill: string; opacity: number; text: string; stroke: string }> = {
  libero: { fill: "#ffffff", opacity: 0.8, text: "#1b6b4f", stroke: "#1b6b4f" },
  occupato: { fill: "#0f6480", opacity: 0.86, text: "#ffffff", stroke: "#ffffff" },
  fuori: { fill: "url(#plan-hatch)", opacity: 1, text: "#0b4d63", stroke: "#0f6480" },
  atteso: { fill: "#fbefd2", opacity: 0.92, text: "#875400", stroke: "#875400" },
  partenza: { fill: "#d4502a", opacity: 0.92, text: "#ffffff", stroke: "#ffffff" },
  ritardo: { fill: "#a93229", opacity: 0.92, text: "#ffffff", stroke: "#ffffff" },
  fermo: { fill: "#d9d6cc", opacity: 0.86, text: "#566876", stroke: "#8794a0" },
};

// Pianta disegnata: lo specchio d'acqua del posto e, se c'è una barca, la sua sagoma.
const DRAWN_STYLE: Record<BerthState, { slot: string; line: string; boat: string | null; text: string }> = {
  libero: { slot: "#f4fbf8", line: "#1b6b4f", boat: null, text: "#1b6b4f" },
  occupato: { slot: "#e6f0f3", line: "#0f6480", boat: "#0f6480", text: "#ffffff" },
  fuori: { slot: "url(#plan-hatch)", line: "#0f6480", boat: null, text: "#0b4d63" },
  atteso: { slot: "#fbefd2", line: "#875400", boat: null, text: "#875400" },
  partenza: { slot: "#fbe6de", line: "#d4502a", boat: "#d4502a", text: "#ffffff" },
  ritardo: { slot: "#f6dedb", line: "#a93229", boat: "#a93229", text: "#ffffff" },
  fermo: { slot: "#e4e1d8", line: "#8794a0", boat: null, text: "#566876" },
};

const LAND_STYLE: Record<LandKind, { fill: string; stroke: string }> = {
  terra: { fill: "#ece6d8", stroke: "#cbbfa6" },
  molo: { fill: "#dcd6c9", stroke: "#a99f8b" },
  diga: { fill: "#cfcabf", stroke: "#9c9483" },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function PlanView({
  mode = "foto",
  berths,
  width,
  height,
  pxPerMeter,
  imageUrl,
  land = [],
  piers = [],
  selectedId = null,
  hrefFor,
}: {
  mode?: "foto" | "disegno";
  berths: PlanBerthView[];
  width: number;
  height: number;
  pxPerMeter: number;
  imageUrl: string;
  land?: LandShape[];
  piers?: { id: string; code: string }[];
  selectedId?: string | null;
  /** Senza: i posti non sono collegamenti (anteprima). */
  hrefFor?: (berthId: string) => string;
}) {
  if (mode === "disegno") {
    return <DrawnPlan berths={berths} width={width} height={height} pxPerMeter={pxPerMeter} land={land} piers={piers} selectedId={selectedId} hrefFor={hrefFor} />;
  }
  // Unità di disegno proporzionata alla foto: spessori e testi non dipendono dalla sua risoluzione.
  const u = width / 1000;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="group" aria-label="Pianta del porto con i posti barca, sulla foto aerea">
      <defs>
        <Hatch u={u} />
      </defs>
      <image href={imageUrl} width={width} height={height} />
      {berths.map((b) => {
        if (b.planX === null || b.planY === null) return null;
        const { w, l } = berthSizePx(b, pxPerMeter);
        const style = PHOTO_STYLE[b.state];
        const selected = b.id === selectedId;
        return (
          <BerthLink key={b.id} berth={b} selected={selected} hrefFor={hrefFor}>
            <g transform={`translate(${b.planX} ${b.planY})`}>
              <g transform={`rotate(${b.planAngle ?? 0})`}>
                {selected && <rect x={-w / 2 - 2.5 * u} y={-l / 2 - 2.5 * u} width={w + 5 * u} height={l + 5 * u} rx={2 * u} fill="none" stroke="#12283a" strokeWidth={2.5 * u} />}
                <rect x={-w / 2} y={-l / 2} width={w} height={l} rx={u} fill={style.fill} fillOpacity={style.opacity} stroke={style.stroke} strokeWidth={1.2 * u} />
              </g>
              <text textAnchor="middle" dominantBaseline="central" fontSize={clamp(w * 0.42, 7 * u, 15 * u)} fontWeight={600} fill={style.text}>
                {b.code}
              </text>
            </g>
          </BerthLink>
        );
      })}
    </svg>
  );
}

function DrawnPlan({
  berths,
  width,
  height,
  pxPerMeter,
  land,
  piers,
  selectedId,
  hrefFor,
}: {
  berths: PlanBerthView[];
  width: number;
  height: number;
  pxPerMeter: number;
  land: LandShape[];
  piers: { id: string; code: string }[];
  selectedId: string | null;
  hrefFor?: (berthId: string) => string;
}) {
  const { walkways, bow } = pierLayout(berths, pxPerMeter, land);
  const view = drawingBounds(berths, walkways, pxPerMeter, width, height);
  const u = view.w / 1000;
  const codeOf = new Map(piers.map((p) => [p.id, p.code]));
  const bar = scaleBarMeters(view.w, pxPerMeter);
  const barPx = bar * pxPerMeter;
  const pad = 18 * u;
  const pts = (list: { x: number; y: number }[]) => list.map((p) => `${p.x},${p.y}`).join(" ");
  // Prima la terra, poi i moli e le dighe che ci stanno sopra.
  const order: LandKind[] = ["terra", "molo", "diga"];
  const shapes = [...land].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));

  return (
    <svg
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      className="block h-auto w-full"
      role="group"
      aria-label="Pianta disegnata del porto con i posti barca"
      style={{ fontFamily: "inherit" }}
    >
      <defs>
        <Hatch u={u} />
        <linearGradient id="plan-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d7e9ef" />
          <stop offset="1" stopColor="#c5dee7" />
        </linearGradient>
        <pattern id="plan-ripple" width={60 * u} height={30 * u} patternUnits="userSpaceOnUse">
          <path d={`M0 ${15 * u} q ${15 * u} ${-6 * u} ${30 * u} 0 t ${30 * u} 0`} fill="none" stroke="#ffffff" strokeOpacity={0.35} strokeWidth={1.2 * u} />
        </pattern>
      </defs>

      <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="url(#plan-water)" />
      <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="url(#plan-ripple)" />

      {shapes.map((shape, i) => (
        <polygon
          key={i}
          points={pts(shape.points)}
          fill={LAND_STYLE[shape.kind].fill}
          stroke={LAND_STYLE[shape.kind].stroke}
          strokeWidth={1.4 * u}
          strokeLinejoin="round"
        />
      ))}

      {walkways.map((w) => (
        <polygon key={w.pierId} points={pts(w.corners)} fill="#f8f5ee" stroke="#8b98a2" strokeWidth={1.1 * u} strokeLinejoin="round" />
      ))}

      {berths.map((b) => {
        if (b.planX === null || b.planY === null) return null;
        const { w, l } = berthSizePx(b, pxPerMeter);
        const style = DRAWN_STYLE[b.state];
        const selected = b.id === selectedId;
        // La sagoma è disegnata con la prua verso -y: si gira se la prua deve andare verso +y.
        const flip = bow.get(b.id) === 1 ? 180 : 0;
        const font = clamp(w * 0.4, 6 * u, 13 * u);
        return (
          <BerthLink key={b.id} berth={b} selected={selected} hrefFor={hrefFor}>
            <g transform={`translate(${b.planX} ${b.planY}) rotate(${b.planAngle ?? 0})`}>
              {selected && <rect x={-w / 2 - 2.5 * u} y={-l / 2 - 2.5 * u} width={w + 5 * u} height={l + 5 * u} rx={2 * u} fill="none" stroke="#12283a" strokeWidth={2.2 * u} />}
              <rect x={-w / 2} y={-l / 2} width={w} height={l} fill={style.slot} stroke={style.line} strokeOpacity={0.55} strokeWidth={0.8 * u} />
              {style.boat && <path d={boatPath(w, l)} transform={`rotate(${flip})`} fill={style.boat} stroke="#ffffff" strokeWidth={0.7 * u} />}
            </g>
            <text
              x={b.planX}
              y={b.planY}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={font}
              fontWeight={600}
              fill={style.boat ? "#ffffff" : style.text}
              stroke={style.boat ? style.boat : "#ffffff"}
              strokeWidth={font * 0.22}
              paintOrder="stroke"
            >
              {b.code}
            </text>
          </BerthLink>
        );
      })}

      {walkways.map((w) => {
        const code = codeOf.get(w.pierId);
        if (!code) return null;
        const r = 9 * u;
        return (
          <g key={`label-${w.pierId}`} aria-hidden="true">
            <circle cx={w.label.x} cy={w.label.y} r={r + code.length * 2 * u} fill="#12283a" stroke="#ffffff" strokeWidth={1.4 * u} />
            <text x={w.label.x} y={w.label.y} textAnchor="middle" dominantBaseline="central" fontSize={10 * u} fontWeight={700} fill="#ffffff">
              {code}
            </text>
          </g>
        );
      })}

      <g transform={`translate(${view.x + pad} ${view.y + view.h - pad})`} aria-hidden="true">
        <rect x={-6 * u} y={-22 * u} width={barPx + 12 * u} height={30 * u} rx={3 * u} fill="#ffffff" fillOpacity={0.85} />
        <rect x={0} y={-4 * u} width={barPx / 2} height={4 * u} fill="#12283a" />
        <rect x={barPx / 2} y={-4 * u} width={barPx / 2} height={4 * u} fill="#ffffff" stroke="#12283a" strokeWidth={0.8 * u} />
        <text x={0} y={-9 * u} fontSize={9 * u} fill="#12283a">
          0
        </text>
        <text x={barPx} y={-9 * u} fontSize={9 * u} textAnchor="end" fill="#12283a">
          {bar} m
        </text>
      </g>
    </svg>
  );
}

function Hatch({ u }: { u: number }) {
  // Tratteggio per i posti assegnati con barca fuori in mare.
  return (
    <pattern id="plan-hatch" width={6 * u} height={6 * u} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width={6 * u} height={6 * u} fill="#ffffff" fillOpacity={0.78} />
      <rect width={2 * u} height={6 * u} fill="#0f6480" fillOpacity={0.75} />
    </pattern>
  );
}

function BerthLink({ berth, selected, hrefFor, children }: { berth: PlanBerthView; selected: boolean; hrefFor?: (id: string) => string; children: ReactNode }) {
  const label = `Posto ${berth.code}: ${STATE_LABEL[berth.state]}${berth.occupant ? `, ${berth.occupant.boatName}` : ""}`;
  if (!hrefFor) {
    return (
      <g>
        <title>{label}</title>
        {children}
      </g>
    );
  }
  return (
    <Link href={hrefFor(berth.id)} aria-label={label} aria-current={selected ? "true" : undefined}>
      <title>{label}</title>
      {children}
    </Link>
  );
}
