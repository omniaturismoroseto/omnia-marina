import type { BoatType } from "@/lib/labels";
import { boatPhotoUrl } from "@/lib/boat-photo";

// Immagine della barca: la foto vera se c'è, altrimenti una sagoma di profilo del suo tipo, su cielo e mare.

const HULL = "var(--color-ink)";
const DECK = "#f4f6f9";
const GLASS = "var(--color-deep-2)";

function Silhouette({ type }: { type: BoatType }) {
  switch (type) {
    case "gommone":
      return (
        <g>
          <path d="M20 50 Q14 60 28 63 L166 63 Q190 61 193 49 L188 44 L32 44 Q22 44 20 50Z" fill={HULL} />
          <path d="M30 44 L184 44 L177 39 L38 39Z" fill={DECK} stroke={HULL} strokeWidth="1.5" />
          <rect x="94" y="21" width="28" height="18" rx="3" fill={DECK} stroke={HULL} strokeWidth="2" />
          <path d="M98 21 L104 11 L120 11 L122 21" fill="none" stroke={HULL} strokeWidth="2" />
          <rect x="14" y="33" width="10" height="23" rx="2" fill={GLASS} />
        </g>
      );
    case "vela":
      return (
        <g>
          <path d="M30 50 L178 48 Q171 60 150 63 L52 63 Q36 60 30 50Z" fill={DECK} stroke={HULL} strokeWidth="2" />
          <path d="M30 50 L178 48 L176 52 L32 54Z" fill={HULL} />
          <path d="M96 3 L96 48" stroke={HULL} strokeWidth="2.5" />
          <path d="M98 6 L152 46 L98 46Z" fill="#fff" stroke={HULL} strokeWidth="1.5" />
          <path d="M94 10 L56 46 L94 46Z" fill="#e3e9f1" stroke={HULL} strokeWidth="1.5" />
        </g>
      );
    case "catamarano":
      return (
        <g>
          <path d="M22 48 L182 46 Q178 58 160 61 L40 61 Q28 58 22 48Z" fill={DECK} stroke={HULL} strokeWidth="2" />
          <path d="M48 46 L58 31 L150 29 L168 44Z" fill={DECK} stroke={HULL} strokeWidth="2" />
          <path d="M66 34 L146 32 L157 42 L60 43Z" fill={GLASS} />
          <path d="M100 1 L100 29" stroke={HULL} strokeWidth="2" />
          <path d="M40 61 L48 54 L66 54 L72 61Z M128 61 L134 54 L152 54 L160 61Z" fill={HULL} />
        </g>
      );
    default:
      return (
        <g>
          <path d="M14 41 L186 36 Q193 45 176 59 L30 61 Q17 57 14 41Z" fill={DECK} stroke={HULL} strokeWidth="2" />
          <path d="M60 38 L70 22 L140 20 L160 36Z" fill={DECK} stroke={HULL} strokeWidth="2" />
          <path d="M76 25 L136 24 L150 34 L72 35Z" fill={GLASS} />
          <path d="M30 53 L176 51" stroke="var(--color-sea)" strokeWidth="3" />
        </g>
      );
  }
}

export function BoatPicture({
  boat,
  className = "",
}: {
  boat: { id: string; name: string; type: BoatType; hasPhoto: boolean; photoVersion: number };
  className?: string;
}) {
  const url = boatPhotoUrl(boat);
  if (url) {
    // La foto arriva dal nostro indirizzo, già ridotta nel browser: niente ottimizzazione di Next.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={`Foto di ${boat.name}`} className={`aspect-video w-full bg-line-soft object-cover ${className}`} />;
  }
  return (
    <div className={`aspect-video w-full bg-[linear-gradient(180deg,#e9eef5_0%,#e9eef5_75%,#cfdbea_75%)] ${className}`}>
      <svg viewBox="0 -14 200 90" className="h-full w-full" role="img" aria-label={`Sagoma di ${boat.name}: nessuna foto`}>
        <Silhouette type={boat.type} />
      </svg>
    </div>
  );
}
