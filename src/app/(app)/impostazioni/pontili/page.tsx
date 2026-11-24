import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, count, eq, gte } from "drizzle-orm";
import { page } from "@/components/page";
import { Notice, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { berthCategories, berthModules, berths, contracts, marinas, pierSections, piers, rates } from "@/db/schema";
import { requireMarina } from "@/lib/context";
import { todayRome } from "@/lib/dates";
import { formatDimensions } from "@/lib/format";
import { one, uuidOrNull, type SearchParams } from "@/lib/params";
import { groupPiersByName } from "@/lib/pricing";
import { getBoard } from "@/server/board";
import { MergePiersButton } from "../settings-forms";
import { SettingsTabs } from "../tabs";
import { PiersManager } from "./piers-manager";
import type { ManagerBerth, ManagerPier } from "./types";
import { byBerthCode } from "@/server/berth-order";
import { assignModules } from "@/lib/plan-modules";
import { berthSizePx } from "@/lib/plan";
import { loadPlanEditor } from "@/server/plan-editor";
import { moduleKey } from "./types";

export const metadata: Metadata = { title: "Pontili e posti barca" };

export default page(async function PiersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMarina(["admin"]);
  const params = await searchParams;
  const welcome = one(params.benvenuto) === "1";
  const today = todayRome();

  const [pierRows, berthRows, categories, board, contractRows, sectionRows, [marina], [rateCount], moduleRows, editor] = await Promise.all([
    db.select().from(piers).where(eq(piers.marinaId, ctx.marinaId)).orderBy(asc(piers.sortOrder), asc(piers.code)),
    db.select().from(berths).where(eq(berths.marinaId, ctx.marinaId)).orderBy(...byBerthCode),
    db.select().from(berthCategories).where(eq(berthCategories.marinaId, ctx.marinaId)).orderBy(asc(berthCategories.sortOrder), asc(berthCategories.maxLengthCm)),
    getBoard(ctx.marinaId, today, today),
    // Contratti attivi in corso o che devono ancora iniziare, per pontile.
    db
      .select({ pierId: berths.pierId, n: count() })
      .from(contracts)
      .innerJoin(berths, eq(berths.id, contracts.berthId))
      .where(and(eq(contracts.marinaId, ctx.marinaId), eq(contracts.status, "attivo"), gte(contracts.endDate, today)))
      .groupBy(berths.pierId),
    db.select().from(pierSections).where(eq(pierSections.marinaId, ctx.marinaId)).orderBy(asc(pierSections.sortOrder)),
    db.select({ width: marinas.planWidth, pxPerMeter: marinas.planPxPerMeter }).from(marinas).where(eq(marinas.id, ctx.marinaId)),
    db.select({ n: count() }).from(rates).where(eq(rates.marinaId, ctx.marinaId)),
    db.select().from(berthModules).where(eq(berthModules.marinaId, ctx.marinaId)),
    // L'editor della pianta si apre sotto la scheda del pontile («Mostra sulla mappa»).
    loadPlanEditor(ctx.marinaId),
  ]);
  const moduleNames = Object.fromEntries(moduleRows.map((r) => [moduleKey(r.pierId, r.sectionId, r.module), r.name]));
  const hasPlan = Boolean(marina?.pxPerMeter);
  const contractsByPier = new Map(contractRows.map((r) => [r.pierId, r.n]));
  const boardBerths = new Map(board.flatMap((p) => p.berths).map((b) => [b.id, b]));

  const managerPiers: ManagerPier[] = pierRows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    sortOrder: p.sortOrder,
    baseRate: p.baseRate,
    sections: sectionRows.filter((sec) => sec.pierId === p.id).map((sec) => ({ id: sec.id, label: sec.label })),
    contracts: contractsByPier.get(p.id) ?? 0,
  }));
  // Moduli della pianta: quelli salvati dall'editor; per i posti disposti che non ne hanno ancora uno si riconoscono come nell'editor.
  const modules =
    marina?.pxPerMeter
      ? assignModules(
          berthRows.flatMap((b) =>
            b.planX !== null && b.planY !== null
              ? [{ id: b.id, unit: b.sectionId ?? b.pierId, x: b.planX, y: b.planY, angle: b.planAngle ?? 0, ...berthSizePx(b, marina.pxPerMeter!), module: b.planModule }]
              : [],
          ),
          marina.pxPerMeter,
        )
      : new Map<string, number>();
  const managerBerths: ManagerBerth[] = berthRows.map((b) => {
    const now = boardBerths.get(b.id);
    const o = now?.occupant;
    return {
      id: b.id,
      code: b.code,
      pierId: b.pierId,
      sectionId: b.sectionId,
      side: b.side,
      position: b.position,
      module: modules.get(b.id) ?? null,
      categoryId: b.categoryId,
      lengthCm: b.lengthCm,
      beamCm: b.beamCm,
      draftCm: b.draftCm,
      hasWater: b.hasWater,
      hasPower: b.hasPower,
      status: b.status,
      notes: b.notes,
      state: now?.state ?? (b.status === "attivo" ? "libero" : "fermo"),
      occupant: o
        ? {
            contractId: o.contractId,
            number: o.number,
            type: o.type,
            startDate: o.startDate,
            endDate: o.endDate,
            boatName: o.boatName,
            ownerName: o.ownerName,
            ownerPhone: o.ownerPhone,
          }
        : null,
    };
  });
  const managerCategories = categories.map((c) => ({ id: c.id, name: c.name, label: `${c.name} (${formatDimensions(c.maxLengthCm, c.maxBeamCm)})` }));

  // Pontili con lo stesso nome: si propone di unirli.
  const duplicates = groupPiersByName(pierRows).filter((g) => g.piers.length > 1);

  // Esito di un'unione appena fatta (vedi mergedUrl in settings-actions).
  const mergedId = uuidOrNull(one(params.unito));
  const mergedPier = mergedId ? pierRows.find((p) => p.id === mergedId) : undefined;
  const mergedCodes = one(params.da).split(",").filter(Boolean);
  const mergedFrom = mergedCodes.length ? `${mergedCodes.length === 1 ? "il pontile" : "i pontili"} ${mergedCodes.join(", ")}` : "";
  const mergedCount = Number.parseInt(one(params.posti), 10);
  const requested = uuidOrNull(one(params.pontile));
  const initialPierId = requested && pierRows.some((p) => p.id === requested) ? requested : null;

  // Primi passi: si mostrano finché ne manca qualcuno.
  const steps = [
    { label: "Categorie", done: categories.length > 0, href: "/impostazioni/categorie" },
    { label: "Pontili", done: pierRows.length > 0, href: "/impostazioni/pontili" },
    { label: "Posti", done: berthRows.length > 0, href: "/impostazioni/pontili" },
    { label: "Tariffe", done: (rateCount?.n ?? 0) > 0, href: "/tariffe" },
    { label: "Mappa del porto", done: Boolean(marina?.width) && berthRows.some((b) => b.planX !== null), href: "/impostazioni/pianta" },
  ];
  const next = steps.find((x) => !x.done);

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

      {next && (
        <section className="card mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" aria-label="Primi passi del porto">
          <h2 className="text-sm font-semibold text-ink">Primi passi del porto</h2>
          <ol className="flex flex-wrap gap-1.5">
            {steps.map((x, i) => (
              <li key={x.label}>
                <Link
                  href={x.href}
                  className={`inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-1 text-sm no-underline ${
                    x.done ? "bg-ok-soft text-ok" : x === next ? "bg-sea-soft font-medium text-sea-dark" : "bg-line-soft text-muted"
                  }`}
                >
                  <span
                    className={`inline-flex size-5 items-center justify-center rounded-full text-[11px] font-bold ${x.done ? "bg-ok text-white" : "border border-line bg-white text-faint"}`}
                    aria-hidden="true"
                  >
                    {x.done ? "✓" : i + 1}
                  </span>
                  {x.label}
                  <span className="sr-only">{x.done ? " (fatto)" : " (da fare)"}</span>
                </Link>
              </li>
            ))}
          </ol>
          <p className="text-sm text-muted">Prossimo passo: {next.label.toLowerCase()}.</p>
        </section>
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
                    {g.name}: {g.piers.map((p) => `${p.code} (${berthRows.filter((x) => x.pierId === p.id).length} posti)`).join(", ")}
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

      <PiersManager
        piers={managerPiers}
        berths={managerBerths}
        categories={managerCategories}
        hasPlan={hasPlan}
        initialPierId={initialPierId}
        moduleNames={moduleNames}
        editor={hasPlan ? editor : null}
      />
    </>
  );
});
