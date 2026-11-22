import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, ilike, isNull, sql } from "drizzle-orm";
import { ActionButton } from "@/components/form";
import { db } from "@/db";
import { marinas, owners } from "@/db/schema";
import { requireUser } from "@/lib/context";
import { one, uuidOrNull, type SearchParams } from "@/lib/params";
import { previewOwnerArea } from "@/server/auth-actions";

export const metadata: Metadata = { title: "Prova come diportista" };

const LIMIT = 50;

// Solo l'account manager: sceglie il cliente di cui vedere l'area diportista. Prima i clienti con un contratto attivo.
async function OwnerPicker({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireUser();
  if (!ctx.accountManager) redirect("/porti");
  const params = await searchParams;
  const marinaId = uuidOrNull(params.porto);
  const q = one(params.q).trim().slice(0, 80);
  if (!marinaId) notFound();
  const [marina] = await db.select({ name: marinas.name }).from(marinas).where(eq(marinas.id, marinaId));
  if (!marina) notFound();

  const active = sql<boolean>`exists (select 1 from contracts c where c.owner_id = "owners"."id" and c.status = 'attivo')`;
  const rows = await db
    .select({ id: owners.id, name: owners.displayName, city: owners.city, active })
    .from(owners)
    .where(and(eq(owners.marinaId, marinaId), isNull(owners.anonymizedAt), q ? ilike(owners.displayName, `%${q.replace(/[%_\\]/g, "\\$&")}%`) : undefined))
    .orderBy(sql`${active} desc`, asc(owners.displayName))
    .limit(LIMIT);

  return (
    <>
      <p className="mt-1 text-[15px] text-muted">
        {marina.name}: scegli il cliente di cui vedere l&apos;area, come la vede lui. Non segni messaggi come letti e non ricevi le sue notifiche.
      </p>
      <form className="mt-5 flex gap-2" action="/porti/diportista">
        <input type="hidden" name="porto" value={marinaId} />
        <input name="q" defaultValue={q} placeholder="Cerca per nome" className="input min-w-0 flex-1" aria-label="Cerca il cliente per nome" />
        <button type="submit" className="btn btn-secondary">
          Cerca
        </button>
      </form>
      {rows.length === 0 ? (
        <p className="mt-5 text-sm text-muted">Nessun cliente{q ? ` con «${q}» nel nome` : " in questo porto"}.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((o) => (
            <li key={o.id} className="card flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{o.name}</p>
                <p className="truncate text-xs text-muted">{[o.active ? "Contratto attivo" : "Nessun contratto attivo", o.city].filter(Boolean).join(" · ")}</p>
              </div>
              <ActionButton action={previewOwnerArea} fields={{ marinaId, ownerId: o.id }} variant="primary" size="sm">
                Entra
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
      {rows.length === LIMIT && <p className="mt-3 text-xs text-muted">Sono mostrati i primi {LIMIT}: cerca per nome per trovare gli altri.</p>}
    </>
  );
}

export default function OwnerPreviewPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <Link href="/porti" className="link text-sm">
        ← Tutti i porti
      </Link>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Prova come diportista</h1>
      <Suspense fallback={<p className="mt-5 text-sm text-muted">Caricamento…</p>}>
        <OwnerPicker searchParams={searchParams} />
      </Suspense>
    </>
  );
}
