import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { Plus } from "lucide-react";
import { page } from "@/components/page";
import { Badge, ButtonLink, EmptyState, PageHeader, SearchBox } from "@/components/ui";
import { db } from "@/db";
import { boats, owners } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { addDays, formatDate, todayRome } from "@/lib/dates";
import { formatDimensions } from "@/lib/format";
import { BOAT_TYPE_LABEL } from "@/lib/labels";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Barche" };

export default page(async function BoatsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMarina();
  const office = OFFICE.includes(ctx.role);
  const q = one((await searchParams).q).trim();
  const today = todayRome();
  const soon = addDays(today, 30);
  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;

  const rows = await db
    .select({
      id: boats.id,
      name: boats.name,
      registration: boats.registration,
      type: boats.type,
      builder: boats.builder,
      model: boats.model,
      lengthCm: boats.lengthCm,
      beamCm: boats.beamCm,
      insuranceExpiry: boats.insuranceExpiry,
      ownerId: owners.id,
      ownerName: owners.displayName,
      // Posto del contratto attivo che copre oggi (o della barca ancora in porto).
      berthCode: sql<string | null>`(
        select b.code from contracts c join berths b on b.id = c.berth_id
        where c.boat_id = "boats"."id" and c.status = 'attivo' and c.start_date <= ${today}
          and (c.occupied_until > ${today} or c.presence in ('in_porto', 'fuori'))
        order by c.start_date desc limit 1
      )`,
    })
    .from(boats)
    .innerJoin(owners, eq(owners.id, boats.ownerId))
    .where(
      and(
        eq(boats.marinaId, ctx.marinaId),
        q ? or(ilike(boats.name, like), ilike(boats.registration, like), ilike(boats.model, like), ilike(boats.builder, like), ilike(owners.displayName, like)) : undefined,
      ),
    )
    .orderBy(asc(boats.name))
    .limit(300);

  return (
    <>
      <PageHeader help="barche"
        title="Barche"
        description="Unità da diporto registrate, con dimensioni, proprietario e posto assegnato."
        actions={
          office && (
            <ButtonLink href="/barche/nuova" variant="primary">
              <Plus size={16} aria-hidden="true" />
              Nuova barca
            </ButtonLink>
          )
        }
      />

      <div className="mb-4">
        <SearchBox action="/barche" defaultValue={q} placeholder="Nome, matricola, modello, proprietario…" />
      </div>

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState
            title={q ? "Nessuna barca corrisponde alla ricerca" : "Nessuna barca registrata"}
            description={q ? undefined : "Le barche si aggiungono dalla scheda del cliente o da qui."}
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Barca</th>
                <th>Tipo</th>
                <th>Dimensioni</th>
                <th>Proprietario</th>
                <th>Posto</th>
                {office && <th>Assicurazione</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link href={`/barche/${b.id}`} className="link">
                      {b.name}
                    </Link>
                    {b.registration && <span className="block text-xs text-muted">{b.registration}</span>}
                  </td>
                  <td>
                    {BOAT_TYPE_LABEL[b.type]}
                    <span className="block text-xs text-muted">{[b.builder, b.model].filter(Boolean).join(" ")}</span>
                  </td>
                  <td className="whitespace-nowrap tabular-nums">{formatDimensions(b.lengthCm, b.beamCm)}</td>
                  <td>
                    {office ? (
                      <Link href={`/clienti/${b.ownerId}`} className="link">
                        {b.ownerName}
                      </Link>
                    ) : (
                      b.ownerName
                    )}
                  </td>
                  <td>{b.berthCode ? <Badge tone="sea">{b.berthCode}</Badge> : <span className="text-faint">—</span>}</td>
                  {office && (
                    <td>
                      {!b.insuranceExpiry ? (
                        <Badge tone="warn">Non indicata</Badge>
                      ) : b.insuranceExpiry < today ? (
                        <Badge tone="bad">Scaduta il {formatDate(b.insuranceExpiry)}</Badge>
                      ) : b.insuranceExpiry <= soon ? (
                        <Badge tone="warn">Scade il {formatDate(b.insuranceExpiry)}</Badge>
                      ) : (
                        <span className="text-muted tabular-nums">{formatDate(b.insuranceExpiry)}</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {rows.length === 300 && <p className="mt-3 text-sm text-muted">Sono mostrate le prime 300 barche: usa la ricerca per trovare le altre.</p>}
    </>
  );
});
