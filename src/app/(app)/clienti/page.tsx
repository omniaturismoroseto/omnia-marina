import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { Plus } from "lucide-react";
import { page } from "@/components/page";
import { Badge, ButtonLink, EmptyState, FilterTabs, PageHeader, SearchBox } from "@/components/ui";
import { db } from "@/db";
import { owners } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { formatMoney } from "@/lib/format";
import { one, qs, type SearchParams } from "@/lib/params";
import { hasInformativa, latestConsents } from "@/server/owners";

export const metadata: Metadata = { title: "Clienti" };

const PAGE_SIZE = 50;

export default page(async function OwnersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMarina(OFFICE);
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const filter = one(sp.privacy) === "mancante" ? "mancante" : "tutti";
  const pageNumber = Math.max(1, Number.parseInt(one(sp.p), 10) || 1);

  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  const noInformativa = sql`coalesce((
    select pc.granted from privacy_consents pc
    where pc.owner_id = "owners"."id" and pc.kind = 'informativa'
    order by pc.recorded_at desc limit 1
  ), false) = false`;

  const where = and(
    eq(owners.marinaId, ctx.marinaId),
    sql`${owners.anonymizedAt} is null`,
    q ? or(ilike(owners.displayName, like), ilike(owners.fiscalCode, like), ilike(owners.vatNumber, like), ilike(owners.email, like), ilike(owners.phone, like)) : undefined,
    filter === "mancante" ? noInformativa : undefined,
  );

  const [rows, [{ total }], [{ missing }], consents] = await Promise.all([
    db
      .select({
        id: owners.id,
        displayName: owners.displayName,
        type: owners.type,
        phone: owners.phone,
        email: owners.email,
        city: owners.city,
        boatCount: sql<number>`(select count(*) from boats b where b.owner_id = "owners"."id")::int`,
        openCents: sql<number>`(
          select coalesce(sum(c.gross_cents - (select coalesce(sum(p.amount_cents), 0) from payments p where p.charge_id = c.id)), 0)
          from charges c where c.owner_id = "owners"."id" and c.cancelled_at is null
        )::int`,
      })
      .from(owners)
      .where(where)
      .orderBy(asc(owners.displayName))
      .limit(PAGE_SIZE)
      .offset((pageNumber - 1) * PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(owners).where(where),
    db
      .select({ missing: sql<number>`count(*)::int` })
      .from(owners)
      .where(and(eq(owners.marinaId, ctx.marinaId), sql`${owners.anonymizedAt} is null`, noInformativa)),
    latestConsents(ctx.marinaId),
  ]);

  const pages = Math.ceil(total / PAGE_SIZE);

  return (
    <>
      <PageHeader
        title="Clienti"
        description="Proprietari e intestatari dei posti barca, con dati di contatto e consensi privacy."
        actions={
          <ButtonLink href="/clienti/nuovo" variant="primary">
            <Plus size={16} aria-hidden="true" />
            Nuovo cliente
          </ButtonLink>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchBox action="/clienti" defaultValue={q} placeholder="Nome, codice fiscale, telefono…">
          {filter === "mancante" && <input type="hidden" name="privacy" value="mancante" />}
        </SearchBox>
        <FilterTabs
          current={filter}
          items={[
            { value: "tutti", label: "Tutti", href: `/clienti${qs({ q })}` },
            { value: "mancante", label: "Informativa mancante", count: missing, href: `/clienti${qs({ q, privacy: "mancante" })}` },
          ]}
        />
      </div>

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState
            title={q || filter === "mancante" ? "Nessun cliente corrisponde alla ricerca" : "Nessun cliente"}
            description={q || filter === "mancante" ? undefined : "Inizia inserendo il primo proprietario: potrai poi aggiungere le sue barche e i contratti."}
            action={
              q || filter === "mancante" ? undefined : (
                <ButtonLink href="/clienti/nuovo" variant="primary">
                  Nuovo cliente
                </ButtonLink>
              )
            }
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Contatti</th>
                <th className="num">Barche</th>
                <th>Privacy</th>
                <th className="num">Da incassare</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/clienti/${o.id}`} className="link">
                      {o.displayName}
                    </Link>
                    <span className="block text-xs text-muted">
                      {o.type === "azienda" ? "Azienda" : "Persona"}
                      {o.city ? ` · ${o.city}` : ""}
                    </span>
                  </td>
                  <td className="text-muted">
                    <span className="block whitespace-nowrap">{o.phone ?? "—"}</span>
                    <span className="block text-xs">{o.email}</span>
                  </td>
                  <td className="num">{o.boatCount}</td>
                  <td>{hasInformativa(consents.get(o.id)) ? <Badge tone="ok">Informativa firmata</Badge> : <Badge tone="warn">Informativa mancante</Badge>}</td>
                  <td className={`num ${o.openCents > 0 ? "font-medium text-ink" : "text-faint"}`}>{o.openCents > 0 ? formatMoney(o.openCents) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm text-muted" aria-label="Pagine">
          <span>
            {total} clienti · pagina {pageNumber} di {pages}
          </span>
          <span className="flex gap-2">
            {pageNumber > 1 && (
              <Link className="btn btn-secondary btn-sm" href={`/clienti${qs({ q, privacy: filter === "mancante" ? "mancante" : null, p: String(pageNumber - 1) })}`}>
                Precedente
              </Link>
            )}
            {pageNumber < pages && (
              <Link className="btn btn-secondary btn-sm" href={`/clienti${qs({ q, privacy: filter === "mancante" ? "mancante" : null, p: String(pageNumber + 1) })}`}>
                Successiva
              </Link>
            )}
          </span>
        </nav>
      )}
    </>
  );
});
