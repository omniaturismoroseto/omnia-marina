import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeftRight, LogOut } from "lucide-react";
import { eq } from "drizzle-orm";
import { BrandWide } from "@/components/brand";
import { PortLogoTile } from "@/components/port-logo";
import { db } from "@/db";
import { marinas } from "@/db/schema";
import { requireOwner } from "@/lib/context";
import { portLogo } from "@/lib/logo";
import { logout } from "@/server/auth-actions";

// Barra in alto dell'area diportista: porto, cliente, cambio area ed uscita. Niente menu del gestionale.
async function TopBar() {
  const ctx = await requireOwner();
  const [marina] = await db
    .select({ logoVersion: marinas.logoVersion, logoWidth: marinas.logoWidth, logoHeight: marinas.logoHeight })
    .from(marinas)
    .where(eq(marinas.id, ctx.marinaId));
  const logo = marina ? portLogo(marina) : null;
  return (
    <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
      {logo && <PortLogoTile logo={logo} alt="" className="h-11 w-auto shrink-0" imageClassName="h-full w-auto max-w-[7rem]" />}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{ctx.marinaName}</p>
        <p className="truncate text-xs text-white/60">Area diportista · {ctx.ownerName}</p>
      </div>
      {ctx.canSwitch && (
        <Link href="/porti" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-white/80 hover:bg-white/10" title="Cambia area">
          <ArrowLeftRight size={16} aria-hidden="true" />
          <span className="hidden sm:inline">Cambia</span>
        </Link>
      )}
      <form action={logout}>
        <button type="submit" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-white/80 hover:bg-white/10">
          <LogOut size={16} aria-hidden="true" />
          Esci
        </button>
      </form>
    </div>
  );
}

export default function OwnerAreaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="bg-deep text-white">
        <Suspense fallback={<div className="h-[68px]" />}>
          <TopBar />
        </Suspense>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      <footer className="mx-auto max-w-3xl px-4 pb-8 sm:px-6">
        <div className="w-28 opacity-60">
          <BrandWide />
        </div>
      </footer>
    </div>
  );
}
