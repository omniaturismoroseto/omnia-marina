"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Anchor,
  Ellipsis,
  FileText,
  LayoutDashboard,
  LifeBuoy,
  Map,
  Sailboat,
  Settings,
  Tags,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

// Le icone vivono qui: da un componente server si possono passare solo le chiavi.
const ICONS = {
  cruscotto: LayoutDashboard,
  banchina: Anchor,
  mappa: Map,
  clienti: Users,
  barche: Sailboat,
  contratti: FileText,
  contabilita: Wallet,
  tariffe: Tags,
  impostazioni: Settings,
  guida: LifeBuoy,
} satisfies Record<string, LucideIcon>;

export type NavKey = keyof typeof ICONS;
export interface NavItem {
  key: NavKey;
  href: string;
  label: string;
}

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.key];
        const active = isActive(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center gap-3 rounded-md px-3 py-2 text-[15px] transition-colors ${
                active ? "bg-white/10 font-medium text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
              }`}
            >
              {active && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-buoy" aria-hidden="true" />}
              <Icon size={18} aria-hidden="true" />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// Barra inferiore per telefono: le prime voci in evidenza, le altre nel pannello "Altro".
export function BottomBar({ items, footer }: { items: NavItem[]; footer: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const primary = items.slice(0, 4);
  const rest = items.slice(4);
  const restActive = rest.some((i) => isActive(pathname, i.href));

  const tab = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium";

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" className="absolute inset-0 bg-deep/50" aria-label="Chiudi il menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-card p-4 pb-[calc(env(safe-area-inset-bottom)+5rem)] shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-ink">Altre sezioni</p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Chiudi">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <ul className="grid grid-cols-2 gap-2">
              {rest.map((item) => {
                const Icon = ICONS[item.key];
                return (
                  <li key={item.href}>
                    <Link href={item.href} onClick={() => setOpen(false)} className="flex min-h-12 items-center gap-2.5 rounded-md border border-line px-3 text-[15px] font-medium text-ink">
                      <Icon size={18} className="text-sea" aria-hidden="true" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {/* Un tocco su un link del piede (account, cambia porto) chiude il pannello. */}
            <div className="mt-4 border-t border-line-soft pt-3" onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
              {footer}
            </div>
          </div>
        </div>
      )}
      <nav
        className="no-print fixed inset-x-0 bottom-0 z-50 flex border-t border-line bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label="Navigazione principale"
      >
        {primary.map((item) => {
          const Icon = ICONS[item.key];
          const active = !open && isActive(pathname, item.href);
          return (
            <Link key={item.href} href={item.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} className={`${tab} ${active ? "text-sea-dark" : "text-muted"}`}>
              <Icon size={22} strokeWidth={active ? 2.25 : 1.75} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={`${tab} ${open || restActive ? "text-sea-dark" : "text-muted"}`}>
          <Ellipsis size={22} aria-hidden="true" />
          Altro
        </button>
      </nav>
    </>
  );
}
