import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeftRight, LogOut } from "lucide-react";
import { eq } from "drizzle-orm";
import { Brand, BrandMark } from "@/components/brand";
import { BottomBar, SidebarLinks, type NavItem } from "@/components/nav-links";
import { PortLogoTile } from "@/components/port-logo";
import { db } from "@/db";
import { marinas } from "@/db/schema";
import { requireMarina } from "@/lib/context";
import { portLogo } from "@/lib/logo";
import { ROLE_LABEL } from "@/lib/labels";
import type { Role } from "@/db/schema";
import { logout } from "@/server/auth-actions";

const NAV: (NavItem & { roles: Role[] })[] = [
  { key: "cruscotto", href: "/", label: "Cruscotto", roles: ["admin", "ufficio"] },
  { key: "banchina", href: "/banchina", label: "Banchina", roles: ["admin", "ufficio", "banchina"] },
  { key: "mappa", href: "/mappa", label: "Mappa", roles: ["admin", "ufficio", "banchina"] },
  { key: "clienti", href: "/clienti", label: "Clienti", roles: ["admin", "ufficio"] },
  { key: "barche", href: "/barche", label: "Barche", roles: ["admin", "ufficio", "banchina"] },
  { key: "contratti", href: "/contratti", label: "Contratti", roles: ["admin", "ufficio"] },
  { key: "contabilita", href: "/contabilita", label: "Contabilità", roles: ["admin", "ufficio"] },
  { key: "tariffe", href: "/tariffe", label: "Tariffe", roles: ["admin", "ufficio"] },
  { key: "impostazioni", href: "/impostazioni", label: "Impostazioni", roles: ["admin"] },
  { key: "guida", href: "/guida", label: "Guida", roles: ["admin", "ufficio", "banchina"] },
];

function LogoutButton({ className }: { className: string }) {
  return (
    <form action={logout}>
      <button type="submit" className={className}>
        <LogOut size={16} aria-hidden="true" />
        Esci
      </button>
    </form>
  );
}

// Legge la sessione: per questo sta dietro <Suspense> e non blocca il resto della pagina.
async function Navigation() {
  const ctx = await requireMarina();
  const items = NAV.filter((i) => i.roles.includes(ctx.role)).map(({ key, href, label }) => ({ key, href, label }));
  const canSwitch = ctx.memberships.length > 1;
  const [marina] = await db
    .select({ logoVersion: marinas.logoVersion, logoWidth: marinas.logoWidth, logoHeight: marinas.logoHeight })
    .from(marinas)
    .where(eq(marinas.id, ctx.marinaId));
  // Il logo della società di gestione accompagna il nome del porto; il testo accanto lo rende già leggibile, quindi alt vuoto.
  const logo = marina ? portLogo(marina) : null;

  return (
    <>
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-deep text-white lg:flex">
        <div className="px-5 pt-6 pb-5">
          <Link href="/" className="text-white">
            <Brand onDark />
          </Link>
          <div className="mt-4 border-t border-white/10 pt-4">
            <p className="text-[11px] font-semibold tracking-widest text-white/45 uppercase">Porto</p>
            {logo && <PortLogoTile logo={logo} alt="" className="mt-2 max-w-full" imageClassName="h-12 w-auto max-w-[11.5rem]" />}
            <p className={`${logo ? "mt-2" : "mt-0.5"} leading-snug font-medium text-white`}>{ctx.marinaName}</p>
            {canSwitch && (
              <Link href="/porti" className="mt-1 inline-flex items-center gap-1 text-xs text-white/60 hover:text-white">
                <ArrowLeftRight size={12} aria-hidden="true" />
                Cambia porto
              </Link>
            )}
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2" aria-label="Navigazione principale">
          <SidebarLinks items={items} />
        </nav>
        <div className="border-t border-white/10 px-5 py-4">
          <Link href="/account" className="block truncate text-sm font-medium text-white hover:underline">
            {ctx.user.name}
          </Link>
          <p className="text-xs text-white/55">{ROLE_LABEL[ctx.role]}</p>
          <LogoutButton className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-sm text-white/70 hover:text-white" />
        </div>
      </aside>

      <header className="no-print sticky top-0 z-30 flex items-center gap-2.5 bg-deep px-4 py-2.5 text-white lg:hidden">
        {logo ? (
          <PortLogoTile logo={logo} alt="" className="shrink-0 p-1" imageClassName="h-7 w-auto max-w-[6rem]" />
        ) : (
          <BrandMark size={28} onDark />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-tight font-semibold">{ctx.marinaName}</p>
          <p className="truncate text-[11px] leading-tight text-white/60">
            {ctx.user.name} · {ROLE_LABEL[ctx.role]}
          </p>
        </div>
      </header>

      <BottomBar
        items={items}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="flex gap-1">
              <Link href="/account" className="btn btn-ghost btn-sm">
                Il mio account
              </Link>
              {canSwitch && (
                <Link href="/porti" className="btn btn-ghost btn-sm">
                  <ArrowLeftRight size={16} aria-hidden="true" />
                  Cambia porto
                </Link>
              )}
            </span>
            <LogoutButton className="btn btn-secondary btn-sm" />
          </div>
        }
      />
    </>
  );
}

function NavigationFallback() {
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 bg-deep px-5 pt-6 text-white lg:block">
        <Brand onDark />
      </aside>
      <header className="sticky top-0 z-30 flex h-[52px] items-center bg-deep px-4 text-white lg:hidden">
        <BrandMark size={28} onDark />
      </header>
    </>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:pl-60 print:pl-0">
      <Suspense fallback={<NavigationFallback />}>
        <Navigation />
      </Suspense>
      <main className="mx-auto w-full max-w-6xl px-4 pt-5 pb-28 lg:px-8 lg:pt-8 lg:pb-16 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
