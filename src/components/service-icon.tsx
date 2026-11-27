import { createElement } from "react";
import {
  Accessibility,
  Anchor,
  Banknote,
  Building2,
  Bus,
  CarTaxiFront,
  Coffee,
  Cross,
  Droplets,
  Forklift,
  Fuel,
  Hammer,
  Hotel,
  Info,
  Pill,
  Plug,
  Sailboat,
  ShoppingCart,
  ShowerHead,
  SquareParking,
  Store,
  Toilet,
  Trash2,
  UtensilsCrossed,
  Warehouse,
  WashingMachine,
  Waves,
  Wifi,
  type AppIcon,
} from "@/components/icons";
import type { PortServiceKey } from "@/lib/port-services";

const ICONS: Record<PortServiceKey, AppIcon> = {
  carburante: Fuel,
  bar: Coffee,
  ristorante: UtensilsCrossed,
  parcheggio: SquareParking,
  cantiere: Hammer,
  porto_secco: Warehouse,
  gru: Forklift,
  scivolo: Waves,
  servizi: Toilet,
  docce: ShowerHead,
  lavanderia: WashingMachine,
  ufficio: Building2,
  ormeggiatori: Anchor,
  market: ShoppingCart,
  nautica: Store,
  rifiuti: Trash2,
  acqua: Droplets,
  elettricita: Plug,
  soccorso: Cross,
  informazioni: Info,
  noleggio: Sailboat,
  hotel: Hotel,
  farmacia: Pill,
  bancomat: Banknote,
  bus: Bus,
  taxi: CarTaxiFront,
  wifi: Wifi,
  accessibile: Accessibility,
};

export function serviceIcon(key: string): AppIcon {
  return ICONS[key as PortServiceKey] ?? Info;
}

// createElement: l'icona cambia con il tipo di servizio, ma è sempre uno dei componenti fissi di ICONS.
export function ServiceIcon({ service, size = 16, className }: { service: string; size?: number; className?: string }) {
  return createElement(serviceIcon(service), { size, className, "aria-hidden": true });
}

/**
 * Segnaposto di un servizio dentro un SVG: cerchio blu scuro con l'icona bianca, centrato in (x, y), raggio r.
 */
/** Raggio dei segnaposto dei servizi sullo schermo, in pixel: si vedono bene anche sul telefono. */
const MARKER_SCREEN_RADIUS = 12;

export function ServiceMarker({ service, x, y, r, selected = false }: { service: string; x: number; y: number; r: number; selected?: boolean }) {
  const s = r * 1.15;
  // --plan-px lo imposta PlanZoom (pixel dello schermo per pixel della pianta): il segnaposto ha sempre lo stesso raggio sullo schermo,
  // MARKER_SCREEN_RADIUS, a qualunque ingrandimento e su qualunque schermo. Fuori da PlanZoom resta com'è disegnato.
  const k = `calc(${MARKER_SCREEN_RADIUS} / (${r} * var(--plan-px, ${MARKER_SCREEN_RADIUS / r})))`;
  return (
    <g style={{ transform: `scale(${k})`, transformBox: "fill-box", transformOrigin: "center" }}>
      <circle cx={x} cy={y} r={r} fill="#1d3f63" stroke={selected ? "#d4502a" : "#ffffff"} strokeWidth={r * (selected ? 0.22 : 0.14)} />
      {createElement(serviceIcon(service), { x: x - s / 2, y: y - s / 2, width: s, height: s, color: "#ffffff", strokeWidth: 2.2, "aria-hidden": true })}
    </g>
  );
}
