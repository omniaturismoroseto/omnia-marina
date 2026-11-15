import Image from "next/image";
import type { PortLogoInfo } from "@/lib/logo";

/**
 * Logo della società di gestione, servito da /logo. L'indirizzo contiene la versione, così dopo un nuovo caricamento
 * il browser non mostra quello vecchio. Altezza e larghezza massime si danno con le classi: l'immagine non si deforma.
 */
export function PortLogo({ logo, alt, className }: { logo: PortLogoInfo; alt: string; className?: string }) {
  return <Image src={`/logo?v=${logo.version}`} alt={alt} width={logo.width} height={logo.height} unoptimized className={`object-contain ${className ?? ""}`} />;
}

/**
 * Sugli sfondi scuri (menu dell'app) il logo sta su un riquadro chiaro: un logo blu scuro o nero resterebbe invisibile.
 */
export function PortLogoTile({ logo, alt, className, imageClassName }: { logo: PortLogoInfo; alt: string; className?: string; imageClassName?: string }) {
  return (
    <span className={`inline-flex items-center justify-center rounded-md bg-white p-1.5 ${className ?? ""}`}>
      <PortLogo logo={logo} alt={alt} className={imageClassName} />
    </span>
  );
}
