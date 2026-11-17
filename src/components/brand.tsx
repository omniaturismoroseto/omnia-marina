import Image from "next/image";
import logo from "@/assets/brand/logo.png";
import logoOnDark from "@/assets/brand/logo-on-dark.png";
import logoWide from "@/assets/brand/logo-wide.png";
import logoWideOnDark from "@/assets/brand/logo-wide-on-dark.png";
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

/**
 * Logo completo in orizzontale: simbolo a sinistra, OMNIA / MARINA / APP DI GESTIONE PORTUALE a destra.
 * In alto nel menu dell'app. Composto dagli originali in /marchio (omnia-marina-logo-orizzontale*.png).
 */
export function BrandWide({ onDark = false, className }: { onDark?: boolean; className?: string }) {
  return (
    <Image
      src={onDark ? logoWideOnDark : logoWide}
      alt="Omnia Marina Gestionale"
      unoptimized
      priority
      className={`h-auto w-full ${className ?? ""}`}
    />
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
