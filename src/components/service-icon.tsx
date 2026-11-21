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
  WashingMachine,
  Waves,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import type { PortServiceKey } from "@/lib/port-services";

const ICONS: Record<PortServiceKey, LucideIcon> = {
  carburante: Fuel,
  bar: Coffee,
  ristorante: UtensilsCrossed,
  parcheggio: SquareParking,
  cantiere: Hammer,
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

export function serviceIcon(key: string): LucideIcon {
  return ICONS[key as PortServiceKey] ?? Info;
}

// createElement: l'icona cambia con il tipo di servizio, ma è sempre uno dei componenti fissi di ICONS.
export function ServiceIcon({ service, size = 16, className }: { service: string; size?: number; className?: string }) {
  return createElement(serviceIcon(service), { size, className, "aria-hidden": true });
}

/**
 * Segnaposto di un servizio dentro un SVG: cerchio blu scuro con l'icona bianca, centrato in (x, y), raggio r.
 */
export function ServiceMarker({ service, x, y, r, selected = false }: { service: string; x: number; y: number; r: number; selected?: boolean }) {
  const s = r * 1.15;
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#1d3f63" stroke={selected ? "#d4502a" : "#ffffff"} strokeWidth={r * (selected ? 0.22 : 0.14)} />
      {createElement(serviceIcon(service), { x: x - s / 2, y: y - s / 2, width: s, height: s, color: "#ffffff", strokeWidth: 2.2, "aria-hidden": true })}
    </g>
  );
}
