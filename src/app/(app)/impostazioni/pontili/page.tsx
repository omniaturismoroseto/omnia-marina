import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, count, eq, gte } from "drizzle-orm";
import { page } from "@/components/page";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { berthCategories, berths, contracts, piers } from "@/db/schema";
import { requireMarina } from "@/lib/context";
import { todayRome } from "@/lib/dates";
import { formatDimensions } from "@/lib/format";
import { BERTH_STATUS_LABEL } from "@/lib/labels";
import { one, uuidOrNull, type SearchParams } from "@/lib/params";
import { groupPiersByName } from "@/lib/pricing";
import { countStates, getBoard } from "@/server/board";
import { DeletePierButton, GenerateBerthsForm, MergePiersButton, MovePierButtons, PierForm } from "../settings-forms";
import { BerthList } from "./berth-list";
import { SettingsTabs } from "../tabs";

export const metadata: Metadata = { title: "Pontili e posti barca" };

// Numero successivo all'ultimo posto con la sigla del pontile (es. C25 → 26).
function nextNumber(prefix: string, list: { code: string }[]): number {
  const numbers = list.map((b) => (b.code.startsWith(prefix) ? Number.parseInt(b.code.slice(prefix.length), 10) : Number.NaN)).filter(Number.isFinite);
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

export default page(async function PiersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMarina(["admin"]);
  const params = await searchParams;
  const welcome = one(params.benvenuto) === "1";
  const today = todayRome();

  const [pierRows, berthRows, categories, board, contractRows] = await Promise.all([
    db.select().from(piers).where(eq(piers.marinaId, ctx.marinaId)).orderBy(asc(piers.sortOrder), asc(piers.code)),
    db.select().from(berths).where(eq(berths.marinaId, ctx.marinaId)).orderBy(asc(berths.code)),
    db.select().from(berthCategories).where(eq(berthCategories.marinaId, ctx.marinaId)).orderBy(asc(berthCategories.sortOrder), asc(berthCategories.maxLengthCm)),
    getBoard(ctx.marinaId, today, today),
    // Contratti attivi in corso o che devono ancora iniziare, per pontile.
    db
      .select({ pierId: berths.pierId, n: count() })
      .from(contracts)
      .innerJoin(berths, eq(berths.id, contracts.berthId))
      .where(and(eq(contracts.marinaId, ctx.marinaId), eq(contracts.status, "attivo"), gte(contracts.endDate, today)))
      .groupBy(berths.pierId),
  ]);
  const categoryOptions = categories.map((c) => ({ id: c.id, label: `${c.name} (${formatDimensions(c.maxLengthCm, c.maxBeamCm)})` }));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const pierRefs = pierRows.map((p) => ({ id: p.id, code: p.code, name: p.name }));
  const contractsByPier = new Map(contractRows.map((r) => [r.pierId, r.n]));

  // Riepilogo di oggi per pontile, come sulla mappa.
  const summary = new Map(
    board.map((p) => {
      const c = countStates([p]);
      return [p.id, { total: c.total, free: c.libero, stopped: c.fermo, busy: c.total - c.libero - c.fermo }];
    }),
  );
  const totals = [...summary.values()].reduce(
    (t, s) => ({ total: t.total + s.total, free: t.free + s.free, stopped: t.stopped + s.stopped, busy: t.busy + s.busy }),
    { total: 0, free: 0, stopped: 0, busy: 0 },
  );
  const totalContracts = contractRows.reduce((t, r) => t + r.n, 0);

  // Pontili con lo stesso nome: si propone di unirli.
  const duplicates = groupPiersByName(pierRows).filter((g) => g.piers.length > 1);

  // Esito di un'unione appena fatta (vedi mergedUrl in settings-actions).
  const mergedId = uuidOrNull(one(params.unito));
  const mergedPier = mergedId ? pierRows.find((p) => p.id === mergedId) : undefined;
  const mergedCodes = one(params.da).split(",").filter(Boolean);
  const mergedFrom = mergedCodes.length ? `${mergedCodes.length === 1 ? "il pontile" : "i pontili"} ${mergedCodes.join(", ")}` : "";
  const mergedCount = Number.parseInt(one(params.posti), 10);

  return (
    <>
      <PageHeader help="impostazioni" title="Impostazioni" description="Pontili, banchine e posti barca: è la struttura che compare sulla mappa." />
      <SettingsTabs current="pontili" />

      {welcome && (
        <div className="mb-5">
          <Notice tone="ok">
            Il porto è stato creato. Per cominciare: aggiungi un pontile, crea i suoi posti barca, poi compila le{" "}
            <Link href="/tariffe" className="link">
              tariffe
            </Link>
            .
          </Notice>
        </div>
      )}

      {mergedPier && (
        <div className="mb-5">
          <Notice tone="ok">
            Uniti in «{mergedPier.name}» (sigla {mergedPier.code}){mergedFrom && <> {mergedFrom}</>}
            {Number.isFinite(mergedCount) && (
              <>
                : {mergedCount} {mergedCount === 1 ? "posto spostato" : "posti spostati"} con i loro codici, misure e contratti
              </>
            )}
            .
            {" "}
            Sulla pianta ogni pontile di prima resta un tratto a sé: in{" "}
            <Link href="/impostazioni/pianta" className="link">
              Mappa del porto
            </Link>{" "}
            lo sposti, ruoti e tracci da solo.
          </Notice>
        </div>
      )}

      {duplicates.length > 0 && (
        <div className="mb-5">
          <Notice tone="warn">
            <p className="font-medium">Ci sono pontili con lo stesso nome.</p>
            <p className="mt-0.5">
              Unendoli, i posti passano al pontile scelto con codici, misure e contratti, e gli altri spariscono dagli elenchi. Sulla
              pianta ogni pontile di prima resta un tratto che si sposta e si traccia da solo.
            </p>
            <ul className="mt-2 space-y-2">
              {duplicates.map((g) => (
                <li key={g.key} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">
                    {g.name}: {g.piers.map((p) => `${p.code} (${summary.get(p.id)?.total ?? 0} posti)`).join(", ")}
                  </span>
                  {g.piers.map((p) => (
                    <MergePiersButton
                      key={p.id}
                      targetId={p.id}
                      label={`Unisci in ${p.code}`}
                      confirm={`Unire in ${p.code} i pontili ${g.piers
                        .filter((o) => o.id !== p.id)
                        .map((o) => o.code)
                        .join(", ")}? I loro posti passano a ${p.code}.`}
                    />
                  ))}
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      {pierRows.length > 0 && (
        <div className="mb-5">
          <Card title={`Riepilogo di oggi · ${totals.total} posti`} flush>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Pontile</th>
                  <th className="num">Posti</th>
                  <th className="num">Occupati</th>
                  <th className="num">Liberi</th>
                  <th className="num" title="In manutenzione o fuori servizio, senza barca">
                    Non disponibili
                  </th>
                  <th className="num" title="Contratti attivi in corso o che devono ancora iniziare">
                    Contratti attivi
                  </th>
                </tr>
              </thead>
              <tbody>
                {pierRows.map((p) => {
                  const s = summary.get(p.id) ?? { total: 0, free: 0, stopped: 0, busy: 0 };
                  return (
                    <tr key={p.id}>
                      <td>
                        <a href={`#pontile-${p.id}`} className="link">
                          {p.name}
                        </a>{" "}
                        <span className="text-faint">{p.code}</span>
                      </td>
                      <td className="num">{s.total}</td>
                      <td className="num">{s.busy}</td>
                      <td className="num">{s.free}</td>
                      <td className="num">{s.stopped}</td>
                      <td className="num">{contractsByPier.get(p.id) ?? 0}</td>
                    </tr>
                  );
                })}
                {pierRows.length > 1 && (
                  <tr className="font-semibold">
                    <td>Totale</td>
                    <td className="num">{totals.total}</td>
                    <td className="num">{totals.busy}</td>
                    <td className="num">{totals.free}</td>
                    <td className="num">{totals.stopped}</td>
                    <td className="num">{totalContracts}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      <div className="space-y-5">
        {pierRows.map((pier, index) => {
          const list = berthRows.filter((b) => b.pierId === pier.id);
          // Posti per categoria, nell'ordine delle categorie; in fondo quelli senza.
          const byCategory = [
            ...categories.map((c) => ({ name: c.name, n: list.filter((b) => b.categoryId === c.id).length })),
            { name: "Senza categoria", n: list.filter((b) => !b.categoryId || !categoryName.has(b.categoryId)).length },
          ].filter((c) => c.n > 0);
          return (
            <div key={pier.id} id={`pontile-${pier.id}`} className="scroll-mt-4">
              <Card
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {pier.name} · {list.length} posti
                    <Link href={`/tariffe?pontile=${pier.id}`} title="Tariffa del pontile" className="no-underline">
                      <Badge tone={pier.baseRate ? "neutral" : "sea"}>{pier.baseRate ? "Tariffa base" : "Prezzi propri"}</Badge>
                    </Link>
                  </span>
                }
                actions={
                  <>
                    <MovePierButtons pierId={pier.id} first={index === 0} last={index === pierRows.length - 1} />
                    <DeletePierButton pierId={pier.id} berthCount={list.length} />
                  </>
                }
              >
                {byCategory.length > 0 && (
                  <p className="mb-3 text-sm text-muted">
                    {byCategory.map((c, i) => (
                      <span key={c.name}>
                        {i > 0 && " · "}
                        {c.name}: <span className="font-medium text-ink tabular-nums">{c.n}</span>
                      </span>
                    ))}
                  </p>
                )}
                <BerthList
                  pierId={pier.id}
                  pierCode={pier.code}
                  categories={categoryOptions}
                  berths={list.map((b) => ({
                    id: b.id,
                    code: b.code,
                    title: `${formatDimensions(b.lengthCm, b.beamCm)}${b.categoryId ? ` · ${categoryName.get(b.categoryId) ?? ""}` : ""} · ${BERTH_STATUS_LABEL[b.status]}`,
                    inactive: b.status !== "attivo",
                  }))}
                />
                {list.some((b) => b.status !== "attivo") && (
                  <p className="mb-4 text-sm text-muted">
                    <Badge>In grigio</Badge> i posti in manutenzione o fuori servizio.
                  </p>
                )}
                {list.length > 0 && (
                  <p className="mb-3 text-sm text-muted">Tocca un posto per modificarne misure, categoria e stato, o «Scegli più posti» per cambiarli insieme.</p>
                )}

                {/* Sempre aperto: un pontile con numeri diversi di posti per lato si crea in due passaggi. */}
                <section className="border-t border-line-soft pt-3" aria-label={`Aggiungi posti a ${pier.name}`}>
                  <h3 className="text-sm font-semibold text-ink">Aggiungi posti</h3>
                  <p className="mt-0.5 text-xs text-muted">
                    Se i due lati hanno un numero diverso di posti, crea prima quelli di sinistra («Solo lato sinistro»), poi quelli di destra
                    proseguendo con la numerazione: si dispongono comunque uno di fronte all&apos;altro a partire dalla radice.
                  </p>
                  <div className="mt-3">
                    {categoryOptions.length === 0 ? (
                      <p className="text-sm text-warn">
                        Servono prima le <Link href="/impostazioni/categorie" className="link">categorie</Link>.
                      </p>
                    ) : (
                      <GenerateBerthsForm pierId={pier.id} prefix={pier.code} nextNumber={nextNumber(pier.code, list)} categories={categoryOptions} />
                    )}
                  </div>
                </section>
                <details className="mt-3 border-t border-line-soft pt-3">
                  <summary className="link cursor-pointer text-sm">Rinomina il pontile</summary>
                  <div className="mt-3">
                    <PierForm pier={pier} nextOrder={pier.sortOrder} others={pierRefs} />
                  </div>
                </details>
              </Card>
            </div>
          );
        })}

        <Card title="Nuovo pontile o banchina">
          <PierForm nextOrder={pierRows.length} others={pierRefs} />
        </Card>
      </div>
    </>
  );
});
