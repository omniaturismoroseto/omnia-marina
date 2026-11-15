import Image from "next/image";
import logo from "@/assets/brand/logo.png";
import logoOnDark from "@/assets/brand/logo-on-dark.png";
import mark from "@/assets/brand/mark.png";
import markOnDark from "@/assets/brand/mark-on-dark.png";

/*
 * Marchio di Omnia Marina. Originali a piena risoluzione in /marchio.
 * Sugli sfondi scuri si usa la versione in negativo (il blu scuro diventa bianco), altrimenti il simbolo sparirebbe.
 * Le immagini sono già alla misura giusta: nessuna ottimizzazione al volo.
 */

/** Solo il simbolo (barche e onde nel cerchio). Decorativo: accanto c'è sempre un testo. */
export function BrandMark({ size = 32, onDark = false, className }: { size?: number; onDark?: boolean; className?: string }) {
  return <Image src={onDark ? markOnDark : mark} alt="" width={size} height={size} unoptimized className={className} />;
}

/** Simbolo e nome, in orizzontale: barra laterale e intestazioni. */
export function Brand({ onDark = false, className }: { onDark?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <BrandMark size={36} onDark={onDark} />
      <span className="font-display text-xl font-semibold">Omnia Marina</span>
    </span>
  );
}

/** Logo completo, in verticale con la scritta: pagine di accesso. */
export function BrandLogo({ onDark = false, className }: { onDark?: boolean; className?: string }) {
  return (
    <Image
      src={onDark ? logoOnDark : logo}
      alt="Omnia Marina — app di gestione portuale"
      unoptimized
      className={`h-auto ${className ?? ""}`}
    />
  );
}
