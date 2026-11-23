import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ArrowDownToLine, ArrowUpFromLine, Clock, Waves, Wrench } from "@/components/icons";
import { page } from "@/components/page";
import { ButtonLink, EmptyState, FilterTabs, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { marinaPlanBases, marinas, planFeatures } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { formatDateLong, isValidISODate, todayRome } from "@/lib/dates";
import { one, qs, uuidOrNull, type SearchParams } from "@/lib/params";
import { countStates, getBoard, STATE_LABEL, type BerthState, type BoardBerth, type BoardPier } from "@/server/board";
import { ServiceIcon } from "@/components/service-icon";
import { buildDrawing } from "@/lib/plan-drawing";
import { planUnits } from "@/lib/plan-units";
import { drawingOrder, extendBounds } from "@/lib/plan-features";
import { serviceTitle } from "@/lib/port-services";
import { PlanView } from "./plan-view";
import { PlanZoom } from "./plan-zoom";
import { ScrollIntoViewOnPhone } from "./scroll-into-view";
import { BerthPanel } from "./berth-panel";

export const metadata: Metadata = { title: "Mappa dei posti barca" };

const CELL: Record<BerthState, string> = {
  libero: "border-ok/50 bg-ok-soft text-ok",
  occupato: "border-sea-dark bg-sea text-white",
  fuori: "hatch border-sea/60 bg-card text-sea-dark",
  atteso: "border-warn/60 bg-warn-soft text-warn",
  partenza: "border-buoy-dark bg-buoy text-white",
  ritardo: "border-bad bg-bad text-white",
  fermo: "border-line bg-line-soft text-faint",
};

const STATE_ORDER: BerthState[] = ["libero", "occupato", "fuori", "atteso", "partenza", "ritardo", "fermo"];
function StateGlyph({ state }: { state: BerthState }) {
  const props = { size: 12, "aria-hidden": true } as const;
  if (state === "fuori") return <Waves {...props} />;
  if (state === "atteso") return <ArrowDownToLine {...props} />;
  if (state === "partenza") return <ArrowUpFromLine {...props} />;
  if (state === "ritardo") return <Clock {...props} />;
  if (state === "fermo") return <Wrench {...props} />;
  return null;
}

function BerthCell({ berth, href, selected }: { berth: BoardBerth; href: string; selected: boolean }) {
  // L'altezza segue la lunghezza del posto: i posti grandi "sporgono" di più dal pontile.
  const height = 40 + Math.round(berth.lengthCm / 100) * 3;
  const label = `Posto ${berth.code}: ${STATE_LABEL[berth.state]}${berth.occupant ? `, ${berth.occupant.boatName}` : ""}`;
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={selected ? "true" : undefined}
      title={label}
      style={{ height, gridColumn: berth.position + 1, gridRow: berth.side === "sx" ? 1 : 3 }}
      className={`flex w-16 flex-col justify-between overflow-hidden rounded border px-1.5 py-1 text-left transition-transform hover:-translate-y-px ${CELL[berth.state]} ${
        berth.side === "sx" ? "self-end" : "self-start"
      } ${selected ? "ring-2 ring-ink ring-offset-2 ring-offset-sea-soft" : ""}`}
    >
      <span className="flex items-center justify-between text-[13px] leading-none font-semibold">
        {berth.code}
        <StateGlyph state={berth.state} />
      </span>
      <span className="truncate text-[10.5px] leading-tight opacity-90">{berth.occupant?.boatName ?? (berth.state === "libero" ? "libero" : "")}</span>
    </Link>
  );
}

function Pier({ pier, hrefFor, selectedId }: { pier: BoardPier; hrefFor: (berthId: string) => string; selectedId: string | null }) {
  const columns = Math.max(1, ...pier.berths.map((b) => b.position + 1));
  const free = pier.berths.filter((b) => b.state === "libero").length;
  return (
    <div className="overflow-x-auto pb-1">
      <div className="inline-grid gap-x-1 gap-y-1" style={{ gridTemplateColumns: `repeat(${columns}, 4rem)` }}>
        {pier.berths.map((b) => (
          <BerthCell key={b.id} berth={b} href={hrefFor(b.id)} selected={b.id === selectedId} />
        ))}
        <div className="pier-deck flex h-6 items-center justify-between rounded-sm px-2 text-[11px] font-semibold tracking-wide whitespace-nowrap text-ink/75 uppercase" style={{ gridRow: 2, gridColumn: `1 / span ${columns}` }}>
          <span>{pier.name}</span>
          <span className="font-medium normal-case">
            {free} liber{free === 1 ? "o" : "i"} su {pier.berths.length}
          </span>
        </div>
      </div>
    </div>
  );
}

export default page(async function MapPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMarina();
  const sp = await searchParams;
  const today = todayRome();
  const date = isValidISODate(one(sp.data)) ? one(sp.data) : today;
  const selectedId = uuidOrNull(sp.posto);

  const [board, [plan], featureRows, [base]] = await Promise.all([
    getBoard(ctx.marinaId, date, today),
    db
      .select({ width: marinas.planWidth, height: marinas.planHeight, pxPerMeter: marinas.planPxPerMeter, version: marinas.planVersion })
      .from(marinas)
      .where(eq(marinas.id, ctx.marinaId)),
    db
      .select({ id: planFeatures.id, kind: planFeatures.kind, service: planFeatures.service, name: planFeatures.name, points: planFeatures.points, source: planFeatures.source })
      .from(planFeatures)
      .where(eq(planFeatures.marinaId, ctx.marinaId))
      .orderBy(asc(planFeatures.sortOrder)),
    db.select({ updatedAt: marinaPlanBases.updatedAt }).from(marinaPlanBases).where(eq(marinaPlanBases.marinaId, ctx.marinaId)),
  ]);
  const baseUrl = base ? `/pianta/base?v=${base.updatedAt.getTime()}` : null;
  const features = drawingOrder(featureRows);
  const services = features.filter((f) => f.kind === "servizio" && f.service);
  const counts = countStates(board);
  const allBerths = board.flatMap((p) => p.berths);
  const selected = allBerths.find((b) => b.id === selectedId) ?? null;
  const office = OFFICE.includes(ctx.role);

  // La pianta dal vero è disponibile quando ci sono foto, scala e almeno un posto disposto.
  const offPlan = allBerths.filter((b) => b.planX === null);
  const hasPlan = plan.width !== null && plan.height !== null && plan.pxPerMeter !== null && offPlan.length < allBerths.length;
  // Con la pianta disposta lo schema è il disegno del porto ricavato dalla foto; senza, la griglia dei pontili.
  const drawing = hasPlan
    ? buildDrawing(
        // Una striscia per pontile, o per tratto nei pontili uniti.
        planUnits(board, allBerths).map((p) => ({
          id: p.id,
          name: p.pierName,
          trace: p.trace,
          berths: p.berths.flatMap((b) =>
            b.planX === null || b.planY === null
              ? []
              : [{ id: b.id, side: b.side, x: b.planX, y: b.planY, angle: b.planAngle ?? 0, lengthCm: b.lengthCm, beamCm: b.beamCm }],
          ),
        })),
        plan.pxPerMeter!,
      )
    : null;
  // Lo schema mostra tutto il porto disegnato: posti, pontili e sfondo.
  // Con la base disegnata lo schema mostra tutta la base, che ha l'inquadratura della foto.
  const schemaBounds = drawing
    ? baseUrl
      ? { x: 0, y: 0, width: plan.width!, height: plan.height! }
      : extendBounds(drawing.bounds, features, plan.width!, plan.height!)
    : null;
  const view = drawing && one(sp.vista) === "foto" ? "foto" : "schema";
  const vista = view === "foto" ? "foto" : null;
  // Con la pianta il riquadro del posto si apre sopra la mappa (su schermi grandi): niente salto di pagina.
  const hrefFor = (berthId: string) => `/mappa${qs({ data: date === today ? null : date, vista, posto: berthId })}${drawing ? "" : "#dettaglio"}`;
  const closeHref = `/mappa${qs({ data: date === today ? null : date, vista })}`;

  return (
    <>
      <PageHeader help="mappa"
        title="Mappa dei posti barca"
        description={date === today ? `Situazione di oggi, ${formatDateLong(today)}.` : `Posti assegnati il ${formatDateLong(date)}.`}
        actions={
          <form action="/mappa" className="flex items-center gap-2">
            {vista && <input type="hidden" name="vista" value={vista} />}
            <label htmlFor="data" className="text-sm text-muted">
              Data
            </label>
            <input id="data" type="date" name="data" defaultValue={date} className="input w-auto" />
            <button type="submit" className="btn btn-secondary">
              Mostra
            </button>
            {date !== today && (
              <Link href={`/mappa${qs({ vista })}`} className="btn btn-ghost">
                Oggi
              </Link>
            )}
          </form>
        }
      />

      {counts.total === 0 ? (
        <div className="card">
          <EmptyState
            title="Nessun posto barca configurato"
            description="Per vedere la mappa servono almeno un pontile e i suoi posti barca."
            action={ctx.role === "admin" ? <ButtonLink href="/impostazioni/pontili" variant="primary">Configura pontili e posti</ButtonLink> : undefined}
          />
        </div>
      ) : (
        <>
          {drawing && (
            <div className="mb-4">
              <FilterTabs
                current={view}
                items={[
                  { value: "schema", label: "Schema", href: `/mappa${qs({ data: date === today ? null : date, posto: selectedId })}` },
                  { value: "foto", label: "Foto dal vero", href: `/mappa${qs({ data: date === today ? null : date, vista: "foto", posto: selectedId })}` },
                ]}
              />
            </div>
          )}

          <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="Legenda">
            {STATE_ORDER.filter((s) => counts[s] > 0 || s === "libero" || s === "occupato").map((s) => (
              <li key={s} className="inline-flex items-center gap-1.5">
                <span className={`inline-block size-3.5 rounded-sm border ${CELL[s]}`} aria-hidden="true" />
                <span className="text-ink">{STATE_LABEL[s]}</span>
                <span className="text-muted tabular-nums">{counts[s]}</span>
              </li>
            ))}
          </ul>

          {drawing ? (
            // data-wide: la mappa usa tutta la larghezza della pagina (vedi il layout).
            <div data-wide>
              <div className="relative">
                <PlanZoom
                  key={view}
                  fillScreen
                  width={view === "schema" ? schemaBounds!.width : plan.width!}
                  height={view === "schema" ? schemaBounds!.height : plan.height!}
                >
                  <PlanView
                    mode={view}
                    drawing={drawing}
                    features={features}
                    bounds={schemaBounds!}
                    baseUrl={baseUrl}
                    berths={allBerths}
                    width={plan.width!}
                    height={plan.height!}
                    pxPerMeter={plan.pxPerMeter!}
                    imageUrl={`/pianta/immagine?v=${plan.version}`}
                    selectedId={selectedId}
                    hrefFor={hrefFor}
                  />
                </PlanZoom>
                {selected && (
                  <div
                    id="dettaglio"
                    className="mt-4 scroll-mt-20 lg:absolute lg:top-3 lg:right-3 lg:z-10 lg:mt-0 lg:max-h-[calc(100%-1.5rem)] lg:w-80 lg:overflow-y-auto lg:rounded-lg lg:shadow-xl"
                  >
                    <ScrollIntoViewOnPhone key={selected.id} />
                    <BerthPanel
                      berth={selected}
                      pierName={board.find((p) => p.id === selected.pierId)?.name ?? null}
                      date={date}
                      today={today}
                      marinaId={ctx.marinaId}
                      office={office}
                      closeHref={closeHref}
                    />
                  </div>
                )}
              </div>
              {!selected && <p className="mt-2 text-sm text-muted">Tocca un posto sulla mappa per vedere chi lo occupa e registrare arrivi e partenze.</p>}
              {services.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="Servizi del porto">
                  {services.map((f) => (
                    <li key={f.id} className="inline-flex items-center gap-1.5 text-ink">
                      <span className="grid size-6 place-items-center rounded-full bg-[#1d3f63] text-white" aria-hidden="true">
                        <ServiceIcon service={f.service!} size={13} />
                      </span>
                      {serviceTitle(f.service!, f.name)}
                    </li>
                  ))}
                </ul>
              )}
              {offPlan.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm text-muted">Posti non ancora disposti sulla foto:</p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {offPlan.map((b) => (
                      <li key={b.id}>
                        <Link
                          href={hrefFor(b.id)}
                          title={`Posto ${b.code}: ${STATE_LABEL[b.state]}`}
                          className={`inline-flex min-w-11 justify-center rounded border px-1.5 py-0.5 text-[13px] font-semibold ${CELL[b.state]} ${b.id === selectedId ? "ring-2 ring-ink ring-offset-1" : ""}`}
                        >
                          {b.code}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="chart-water space-y-6 rounded-lg border border-sea/20 p-4">
                {board.map((pier) => (pier.berths.length > 0 ? <Pier key={pier.id} pier={pier} hrefFor={hrefFor} selectedId={selectedId} /> : null))}
              </div>
              <div id="dettaglio" className="scroll-mt-20 lg:sticky lg:top-6">
                {selected ? (
                  <BerthPanel
                    berth={selected}
                    pierName={board.find((p) => p.id === selected.pierId)?.name ?? null}
                    date={date}
                    today={today}
                    marinaId={ctx.marinaId}
                    office={office}
                    closeHref={null}
                  />
                ) : (
                  <div className="card p-4 text-sm text-muted">Tocca un posto sulla mappa per vedere chi lo occupa e registrare arrivi e partenze.</div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
})
