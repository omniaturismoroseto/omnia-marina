import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, gte, ilike, lte, ne, or, sql } from "drizzle-orm";
import { Plus } from "@/components/icons";
import { page } from "@/components/page";
import { ContractStatusBadge } from "@/components/status";
import { ButtonLink, EmptyState, FilterTabs, Notice, PageHeader, SearchBox } from "@/components/ui";
import { db } from "@/db";
import { berths, boats, contracts, owners } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { addDays, formatDate, todayRome } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { CONTRACT_TYPE_LABEL } from "@/lib/labels";
import { one, qs, type SearchParams } from "@/lib/params";
import { contractNumberLabel } from "@/lib/contract-numbers";
import { contractNumberGaps } from "@/server/contracts";

export const metadata: Metadata = { title: "Contratti" };

const FILTERS = ["attivi", "scadenza", "bozze", "conclusi", "annullati", "tutti"] as const;
type Filter = (typeof FILTERS)[number];

export default page(async function ContractsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMarina(OFFICE);
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const filter: Filter = FILTERS.includes(one(sp.stato) as Filter) ? (one(sp.stato) as Filter) : "attivi";
  const today = todayRome();
  const horizon = addDays(today, 60);
  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;

  // "In scadenza": contratti non di transito che finiscono entro 60 giorni.
  const expiring = and(eq(contracts.status, "attivo"), ne(contracts.type, "transito"), gte(contracts.endDate, today), lte(contracts.endDate, horizon));
  const byFilter = {
    attivi: eq(contracts.status, "attivo"),
    scadenza: expiring,
    bozze: eq(contracts.status, "bozza"),
    conclusi: eq(contracts.status, "concluso"),
    annullati: eq(contracts.status, "annullato"),
    tutti: undefined,
  }[filter];

  const [rows, [counts], numberGaps] = await Promise.all([
    db
      .select({
        id: contracts.id,
        number: contracts.number,
        type: contracts.type,
        status: contracts.status,
        startDate: contracts.startDate,
        endDate: contracts.endDate,
        amountCents: contracts.amountCents,
        ownerId: owners.id,
        ownerName: owners.displayName,
        boatName: boats.name,
        berthCode: berths.code,
      })
      .from(contracts)
      .innerJoin(owners, eq(owners.id, contracts.ownerId))
      .innerJoin(boats, eq(boats.id, contracts.boatId))
      .leftJoin(berths, eq(berths.id, contracts.berthId))
      .where(
        and(
          eq(contracts.marinaId, ctx.marinaId),
          byFilter,
          q ? or(ilike(contracts.number, like), ilike(owners.displayName, like), ilike(boats.name, like), ilike(berths.code, like)) : undefined,
        ),
      )
      .orderBy(filter === "scadenza" ? asc(contracts.endDate) : desc(contracts.startDate), sql`${contracts.seq} desc nulls last`)
      .limit(300),
    db
      .select({
        attivi: sql<number>`count(*) filter (where ${contracts.status} = 'attivo')::int`,
        bozze: sql<number>`count(*) filter (where ${contracts.status} = 'bozza')::int`,
        scadenza: sql<number>`count(*) filter (where ${contracts.status} = 'attivo' and ${contracts.type} <> 'transito' and ${contracts.endDate} between ${today} and ${horizon})::int`,
      })
      .from(contracts)
      .where(eq(contracts.marinaId, ctx.marinaId)),
    contractNumberGaps(ctx.marinaId),
  ]);

  const tab = (value: Filter, label: string, count?: number) => ({ value, label, count, href: `/contratti${qs({ q, stato: value === "attivi" ? null : value })}` });

  return (
    <>
      <PageHeader help="contratti"
        title="Contratti"
        description="Contratti di ormeggio annuali, stagionali, mensili e transiti."
        actions={
          <ButtonLink href="/contratti/nuovo" variant="primary">
            <Plus size={16} aria-hidden="true" />
            Nuovo contratto
          </ButtonLink>
        }
      />

      {numberGaps.length > 0 && (
        <div className="mb-4">
          <Notice>
            {numberGaps.length === 1 ? "Nella numerazione dei contratti è rimasto libero il numero " : "Nella numerazione dei contratti sono rimasti liberi i numeri "}
            <strong>{numberGaps.join(", ")}</strong> (contratti tornati in bozza).{" "}
            {numberGaps.length === 1 ? "Lo riprenderà il primo contratto che verrà attivato." : "Li riprenderanno, nell'ordine, i prossimi contratti attivati."}
          </Notice>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchBox action="/contratti" defaultValue={q} placeholder="Numero, cliente, barca, posto…">
          {filter !== "attivi" && <input type="hidden" name="stato" value={filter} />}
        </SearchBox>
        <FilterTabs
          current={filter}
          items={[
            tab("attivi", "Attivi", counts.attivi),
            tab("scadenza", "In scadenza", counts.scadenza),
            tab("bozze", "Bozze", counts.bozze),
            tab("conclusi", "Conclusi"),
            tab("annullati", "Annullati"),
            tab("tutti", "Tutti"),
          ]}
        />
      </div>

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState
            title={q ? "Nessun contratto corrisponde alla ricerca" : filter === "scadenza" ? "Nessun contratto in scadenza nei prossimi 60 giorni" : "Nessun contratto in questo elenco"}
            action={
              !q && filter === "attivi" ? (
                <ButtonLink href="/contratti/nuovo" variant="primary">
                  Nuovo contratto
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Numero</th>
                <th>Cliente</th>
                <th>Barca</th>
                <th>Posto</th>
                <th>Periodo</th>
                <th>Stato</th>
                <th className="num">Importo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/contratti/${c.id}`} className="link whitespace-nowrap">
                      {contractNumberLabel(c.number)}
                    </Link>
                    <span className="block text-xs text-muted">{CONTRACT_TYPE_LABEL[c.type]}</span>
                  </td>
                  <td>
                    <Link href={`/clienti/${c.ownerId}`} className="hover:underline">
                      {c.ownerName}
                    </Link>
                  </td>
                  <td>{c.boatName}</td>
                  <td>{c.berthCode ?? <span className="text-warn">da assegnare</span>}</td>
                  <td className="whitespace-nowrap tabular-nums">
                    {formatDate(c.startDate)} – {formatDate(c.endDate)}
                  </td>
                  <td>
                    <ContractStatusBadge status={c.status} />
                  </td>
                  <td className="num">{formatMoney(c.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {rows.length === 300 && <p className="mt-3 text-sm text-muted">Sono mostrati i primi 300 contratti: usa la ricerca o i filtri per restringere.</p>}
    </>
  );
});
