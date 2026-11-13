import Link from "next/link";
import { berthSizePx } from "@/lib/plan";
import { STATE_LABEL, type BerthState, type BoardBerth } from "@/server/board";

// Aspetto di un posto sulla foto: riempimento semitrasparente, così sotto si intravede la barca.
const STYLE: Record<BerthState, { fill: string; opacity: number; text: string; stroke: string }> = {
  libero: { fill: "#ffffff", opacity: 0.8, text: "#1b6b4f", stroke: "#1b6b4f" },
  occupato: { fill: "#0f6480", opacity: 0.86, text: "#ffffff", stroke: "#ffffff" },
  fuori: { fill: "url(#plan-hatch)", opacity: 1, text: "#0b4d63", stroke: "#0f6480" },
  atteso: { fill: "#fbefd2", opacity: 0.92, text: "#875400", stroke: "#875400" },
  partenza: { fill: "#d4502a", opacity: 0.92, text: "#ffffff", stroke: "#ffffff" },
  ritardo: { fill: "#a93229", opacity: 0.92, text: "#ffffff", stroke: "#ffffff" },
  fermo: { fill: "#d9d6cc", opacity: 0.86, text: "#566876", stroke: "#8794a0" },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function PlanView({
  berths,
  width,
  height,
  pxPerMeter,
  imageUrl,
  selectedId,
  hrefFor,
}: {
  berths: BoardBerth[];
  width: number;
  height: number;
  pxPerMeter: number;
  imageUrl: string;
  selectedId: string | null;
  hrefFor: (berthId: string) => string;
}) {
  // Unità di disegno proporzionata alla foto: spessori e testi non dipendono dalla sua risoluzione.
  const u = width / 1000;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="group" aria-label="Pianta del porto con i posti barca">
      <defs>
        {/* Tratteggio per i posti assegnati con barca fuori in mare. */}
        <pattern id="plan-hatch" width={6 * u} height={6 * u} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={6 * u} height={6 * u} fill="#ffffff" fillOpacity={0.78} />
          <rect width={2 * u} height={6 * u} fill="#0f6480" fillOpacity={0.75} />
        </pattern>
      </defs>
      <image href={imageUrl} width={width} height={height} />
      {berths.map((b) => {
        if (b.planX === null || b.planY === null) return null;
        const { w, l } = berthSizePx(b, pxPerMeter);
        const style = STYLE[b.state];
        const selected = b.id === selectedId;
        const label = `Posto ${b.code}: ${STATE_LABEL[b.state]}${b.occupant ? `, ${b.occupant.boatName}` : ""}`;
        return (
          <Link key={b.id} href={hrefFor(b.id)} aria-label={label} aria-current={selected ? "true" : undefined}>
            <title>{label}</title>
            <g transform={`translate(${b.planX} ${b.planY})`}>
              <g transform={`rotate(${b.planAngle ?? 0})`}>
                {selected && <rect x={-w / 2 - 2.5 * u} y={-l / 2 - 2.5 * u} width={w + 5 * u} height={l + 5 * u} rx={2 * u} fill="none" stroke="#12283a" strokeWidth={2.5 * u} />}
                <rect x={-w / 2} y={-l / 2} width={w} height={l} rx={u} fill={style.fill} fillOpacity={style.opacity} stroke={style.stroke} strokeWidth={1.2 * u} />
              </g>
              <text textAnchor="middle" dominantBaseline="central" fontSize={clamp(w * 0.42, 7 * u, 15 * u)} fontWeight={600} fill={style.text}>
                {b.code}
              </text>
            </g>
          </Link>
        );
      })}
    </svg>
  );
}
