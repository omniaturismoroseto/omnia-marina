import type { KeyboardEvent, ReactNode } from "react";

/** Posto auto da disegnare sulla pianta (in pixel della foto, come i posti barca). */
export interface ParkingMark {
  id: string;
  code: string;
  x: number;
  y: number;
  /** Gradi; a 0° il lato lungo è verticale. */
  angle: number;
  lengthCm: number;
  widthCm: number;
  covered: boolean;
  /** libero, occupato (assegnato a un contratto), fermo (fuori servizio o non sceglibile). */
  state: "libero" | "occupato" | "fermo";
  /** Testo del suggerimento (es. a chi è assegnato). */
  note?: string;
}

// Colori dei posti auto: grigio ardesia, per distinguerli a colpo d'occhio dai posti barca (verdi e blu).
const STYLE = {
  libero: { fill: "#eef1f4", stroke: "#4f5f6f", text: "#33414f" },
  occupato: { fill: "#4f5f6f", stroke: "#ffffff", text: "#ffffff" },
  fermo: { fill: "#dcd9d0", stroke: "#8794a0", text: "#566876" },
} as const;

/**
 * I posti auto sulla pianta: un rettangolo alla misura vera con il codice scritto lungo il posto (e una «P» se c'è spazio),
 * tratteggiato se coperto. Con `onSelect` i posti non fermi si scelgono con un clic o con Invio.
 */
export function ParkingMarks({
  spaces,
  pxPerMeter,
  selectedId = null,
  onSelect,
}: {
  spaces: ParkingMark[];
  pxPerMeter: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const m = pxPerMeter;
  return (
    <>
      {spaces.map((s) => {
        const w = (s.widthCm / 100) * m;
        const l = (s.lengthCm / 100) * m;
        const style = STYLE[s.state];
        const selected = s.id === selectedId;
        const label = `Posto auto ${s.code} (${s.covered ? "coperto" : "scoperto"}): ${s.note ?? (s.state === "libero" ? "libero" : s.state === "occupato" ? "assegnato" : "non disponibile")}`;
        let textAngle = s.angle + 90;
        textAngle = ((((textAngle + 180) % 360) + 360) % 360) - 180;
        if (textAngle >= 90) textAngle -= 180;
        else if (textAngle <= -90) textAngle += 180;
        const fontSize = Math.max(0.4 * m, Math.min(w * 0.6, (l * 0.75) / (0.62 * Math.max(2, s.code.length))));
        const body: ReactNode = (
          <>
            <title>{label}</title>
            <g transform={`translate(${s.x} ${s.y}) rotate(${s.angle})`}>
              {selected && (
                <rect x={-w / 2 - 0.3 * m} y={-l / 2 - 0.3 * m} width={w + 0.6 * m} height={l + 0.6 * m} rx={0.3 * m} fill="none" stroke="#15243a" strokeWidth={0.25 * m} />
              )}
              <rect
                x={-w / 2}
                y={-l / 2}
                width={w}
                height={l}
                rx={0.15 * m}
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth={0.08 * m}
                strokeDasharray={s.covered ? undefined : `${0.3 * m} ${0.2 * m}`}
              />
            </g>
            <text
              x={s.x}
              y={s.y}
              transform={`rotate(${textAngle} ${s.x} ${s.y})`}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={fontSize}
              fontWeight={600}
              fill={style.text}
              pointerEvents="none"
            >
              {s.code}
            </text>
          </>
        );
        if (!onSelect) return <g key={s.id}>{body}</g>;
        const choosable = s.state !== "fermo";
        const choose = () => choosable && onSelect(s.id);
        return (
          <g
            key={s.id}
            role="button"
            tabIndex={choosable ? 0 : -1}
            aria-label={label}
            aria-pressed={selected}
            aria-disabled={!choosable}
            className={choosable ? "cursor-pointer focus:outline-none" : "cursor-not-allowed"}
            onClick={choose}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                choose();
              }
            }}
          >
            {body}
          </g>
        );
      })}
    </>
  );
}
