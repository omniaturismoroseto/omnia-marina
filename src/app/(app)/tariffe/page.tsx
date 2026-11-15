import type { Metadata } from "next";
import { asc, desc, eq } from "drizzle-orm";
import { page } from "@/components/page";
import { Badge, Card, EmptyState, FilterTabs, Notice, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { berthCategories, piers, priceListExtras, priceLists, rates, seasonPeriods, tariffZones } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { formatDate, todayRome, yearOf } from "@/lib/dates";
import { formatDimensions, moneyInput } from "@/lib/format";
import { SEASON_LABEL } from "@/lib/labels";
import { RATE_FIELDS } from "@/lib/pricing";
import { uuidOrNull, type SearchParams } from "@/lib/params";
import { OFFICIAL_CATEGORIES, OFFICIAL_LIST, OFFICIAL_ZONE } from "@/server/official-price-list";
import {
  DeletePeriodButton,
  DeleteZoneButton,
  ListActions,
  LoadOfficialListButton,
  PierZonesForm,
  PriceListExtras,
  PriceListForm,
  RatesGrid,
  SeasonPeriodForm,
  Simulator,
  ZoneForm,
  type RateGridRow,
} from "./tariff-forms";

export const metadata: Metadata = { title: "Tariffe" };

// «i pontili A, B e D» oppure «nessun pontile».
function listOrNone(names: string[]): string {
  if (names.length === 0) return "nessun pontile";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

export default page(async function TariffsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMarina(OFFICE);
  const admin = ctx.role === "admin";
  const today = todayRome();
  const params = await searchParams;
  const selectedId = uuidOrNull(params.listino);
  const selectedZoneId = uuidOrNull(params.zona);

  const [lists, categories, zones, pierRows] = await Promise.all([
    db.select().from(priceLists).where(eq(priceLists.marinaId, ctx.marinaId)).orderBy(desc(priceLists.validFrom)),
    db.select().from(berthCategories).where(eq(berthCategories.marinaId, ctx.marinaId)).orderBy(asc(berthCategories.sortOrder), asc(berthCategories.maxLengthCm)),
    db.select().from(tariffZones).where(eq(tariffZones.marinaId, ctx.marinaId)).orderBy(asc(tariffZones.sortOrder), asc(tariffZones.name)),
    db
      .select({ id: piers.id, name: piers.name, zoneId: piers.tariffZoneId })
      .from(piers)
      .where(eq(piers.marinaId, ctx.marinaId))
      .orderBy(asc(piers.sortOrder), asc(piers.code)),
  ]);
  // Senza scelta esplicita si apre il listino in vigore oggi, altrimenti il più recente.
  const list = lists.find((l) => l.id === selectedId) ?? lists.find((l) => l.validFrom <= today && today <= l.validTo) ?? lists[0];
  const zone = zones.find((z) => z.id === selectedZoneId) ?? null;
  const pierNames = (zoneId: string | null) => pierRows.filter((p) => p.zoneId === zoneId).map((p) => p.name);

  const [rateRows, periods, extras] = list
    ? await Promise.all([
        db.select().from(rates).where(eq(rates.priceListId, list.id)),
        db.select().from(seasonPeriods).where(eq(seasonPeriods.priceListId, list.id)).orderBy(asc(seasonPeriods.startDate)),
        db.select().from(priceListExtras).where(eq(priceListExtras.priceListId, list.id)).orderBy(asc(priceListExtras.sortOrder), asc(priceListExtras.name)),
      ])
    : [[], [], []];

  const show = (cents: number | undefined) => (cents ? moneyInput(cents) : "");
  const valuesOf = (r: (typeof rateRows)[number] | undefined) => Object.fromEntries(RATE_FIELDS.map((k) => [k, show(r?.[k])])) as RateGridRow["values"];
  const grid: RateGridRow[] = categories.map((c) => {
    const base = rateRows.find((row) => row.categoryId === c.id && row.zoneId === null);
    const own = zone ? rateRows.find((row) => row.categoryId === c.id && row.zoneId === zone.id) : base;
    return {
      categoryId: c.id,
      categoryName: c.name,
      size: `fino a ${formatDimensions(c.maxLengthCm, c.maxBeamCm)}`,
      values: valuesOf(own),
      fallback: zone ? valuesOf(base) : undefined,
    };
  });
  const empty = rateRows.filter((r) => r.zoneId === null).every((r) => RATE_FIELDS.every((k) => r[k] === 0));
  const listHref = (zoneId: string | null) => `/tariffe?listino=${list?.id ?? ""}${zoneId ? `&zona=${zoneId}` : ""}`;

  return (
    <>
      <PageHeader
        title="Tariffe"
        description="Listini per categoria di posto e stagione. Servono a proporre l'importo quando si crea un contratto: l'importo resta sempre modificabile."
      />

      {lists.length > 0 && (
        <div className="mb-5">
          <FilterTabs current={list?.id ?? ""} items={lists.map((l) => ({ value: l.id, label: l.name, href: `/tariffe?listino=${l.id}` }))} />
        </div>
      )}

      {!list ? (
        <div className="card">
          <EmptyState title="Nessun listino" description={admin ? "Crea il primo listino qui sotto." : "La direzione non ha ancora creato un listino."} />
        </div>
      ) : (
        <div className="space-y-5">
          {categories.length === 0 ? (
            <Notice>Per compilare le tariffe servono le categorie dei posti barca: si definiscono in Impostazioni → Categorie.</Notice>
          ) : (
            empty && <Notice>Questo listino non ha ancora tariffe: finché sono vuote, i contratti non avranno un importo proposto.</Notice>
          )}

          <Card
            title={
              <span className="flex flex-wrap items-center gap-2">
                {list.name}
                {list.validFrom <= today && today <= list.validTo ? <Badge tone="ok">In vigore</Badge> : list.validFrom > today ? <Badge tone="sea">Futuro</Badge> : <Badge>Scaduto</Badge>}
                <span className="text-sm font-normal text-muted">
                  dal {formatDate(list.validFrom)} al {formatDate(list.validTo)} · IVA {list.vatRate}% inclusa
                </span>
              </span>
            }
            flush
          >
            {categories.length > 0 && (
              <>
                {zones.length > 0 && (
                  <div className="space-y-2 border-b border-line-soft p-4">
                    <FilterTabs
                      current={zone?.id ?? "base"}
                      items={[{ value: "base", label: "Tariffa base", href: listHref(null) }, ...zones.map((z) => ({ value: z.id, label: z.name, href: listHref(z.id) }))]}
                    />
                    <p className="text-sm text-muted">
                      {zone
                        ? `Prezzi per ${listOrNone(pierNames(zone.id))}. Dove una casella è vuota vale la tariffa base.`
                        : `Vale per ${listOrNone(pierNames(null))} e per le caselle lasciate vuote nelle zone.`}
                    </p>
                  </div>
                )}
                <RatesGrid key={`${list.id}:${zone?.id ?? ""}`} listId={list.id} zoneId={zone?.id ?? ""} rows={grid} editable={admin} />
              </>
            )}
          </Card>

          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
            <Card title="Stagioni">
              <p className="mb-3 text-sm text-muted">Indica i periodi di media e alta stagione. Tutti gli altri giorni sono bassa stagione.</p>
              {periods.length === 0 ? (
                <p className="text-sm text-muted">Nessun periodo: tutto l&apos;anno è bassa stagione.</p>
              ) : (
                <ul className="divide-y divide-line-soft">
                  {periods.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="flex items-center gap-2">
                        <Badge tone={p.season === "alta" ? "buoy" : "warn"}>{SEASON_LABEL[p.season]}</Badge>
                        <span className="tabular-nums">
                          {formatDate(p.startDate)} – {formatDate(p.endDate)}
                        </span>
                      </span>
                      {admin && <DeletePeriodButton periodId={p.id} />}
                    </li>
                  ))}
                </ul>
              )}
              {admin && (
                <div className="mt-4 border-t border-line-soft pt-4">
                  <SeasonPeriodForm listId={list.id} validFrom={list.validFrom} />
                </div>
              )}
            </Card>

            <Card title="Servizi e cauzioni">
              <p className="mb-3 text-sm text-muted">Posti auto, carrelli, cauzioni e altri servizi a prezzo fisso: si scelgono quando si crea un addebito.</p>
              <PriceListExtras listId={list.id} extras={extras} editable={admin} />
            </Card>

            <Card title="Simulatore">
              {categories.length > 0 ? (
                <Simulator
                  key={list.id}
                  listId={list.id}
                  categories={categories.map((c) => ({ id: c.id, name: c.name }))}
                  zones={zones.map((z) => ({ id: z.id, name: z.name }))}
                  today={today}
                />
              ) : (
                <p className="text-sm text-muted">Servono le categorie.</p>
              )}
            </Card>
          </div>

          {admin && (
            <Card title="Dati del listino" actions={<ListActions listId={list.id} />}>
              <PriceListForm key={list.id} list={list} defaultYear={yearOf(today)} />
            </Card>
          )}
        </div>
      )}

      <div className="mt-5">
        <Card title="Zone tariffarie">
          <p className="mb-4 text-sm text-muted">
            Una zona raggruppa i pontili che hanno prezzi diversi dal resto del porto, per esempio una darsena più cara. Ogni listino ha una griglia per
            zona; i pontili senza zona usano la tariffa base.
          </p>
          {zones.length === 0 ? (
            <p className="mb-4 text-sm text-muted">Nessuna zona: tutti i pontili usano la tariffa base.</p>
          ) : admin ? (
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
              <section aria-label="Zone">
                <h3 className="mb-2 text-sm font-semibold text-ink">Zone</h3>
                <ul className="space-y-3">
                  {zones.map((z) => (
                    <li key={z.id} className="rounded-md border border-line-soft p-3">
                      <ZoneForm zone={{ id: z.id, name: z.name }} />
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <span className="text-xs text-muted">{listOrNone(pierNames(z.id))}</span>
                        <DeleteZoneButton zoneId={z.id} name={z.name} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
              <section aria-label="Zona di ogni pontile">
                <h3 className="mb-1 text-sm font-semibold text-ink">Zona di ogni pontile</h3>
                {pierRows.length === 0 ? (
                  <p className="text-sm text-muted">Non ci sono ancora pontili.</p>
                ) : (
                  <PierZonesForm piers={pierRows} zones={zones.map((z) => ({ id: z.id, name: z.name }))} />
                )}
              </section>
            </div>
          ) : (
            <ul className="mb-2 space-y-1 text-sm">
              {zones.map((z) => (
                <li key={z.id}>
                  <span className="font-medium text-ink">{z.name}</span>: <span className="text-muted">{listOrNone(pierNames(z.id))}</span>
                </li>
              ))}
            </ul>
          )}
          {admin && (
            <div className={zones.length > 0 ? "mt-5 border-t border-line-soft pt-4" : ""}>
              <ZoneForm />
            </div>
          )}
        </Card>
      </div>

      {admin && (
        <Card title="Listino ufficiale 2026" className="mt-5">
          <p className="mb-3 text-sm text-muted">
            Dal foglio delle tariffe ufficiali: {OFFICIAL_CATEGORIES.length} categorie per lunghezza, tariffa base per le darsene A, B e D e zona «{OFFICIAL_ZONE}»
            con prezzi propri; canone annuale, quota rifiuti, stagionale maggio – settembre e mensile per le categorie B e C, posti auto, carrelli e cauzioni.
            Dopo il caricamento: assegna la zona ai pontili della darsena C (qui sopra), le categorie ai posti e controlla le larghezze in Impostazioni →
            Categorie, che sono indicative.
          </p>
          <LoadOfficialListButton hasList={lists.some((l) => l.name === OFFICIAL_LIST.name)} />
        </Card>
      )}

      {admin && (
        <details className="card mt-5">
          <summary className="cursor-pointer px-4 py-3 text-[15px] font-semibold text-ink">Nuovo listino</summary>
          <div className="border-t border-line-soft p-4">
            <PriceListForm defaultYear={yearOf(today) + (lists.some((l) => yearOf(l.validFrom) === yearOf(today)) ? 1 : 0)} />
          </div>
        </details>
      )}
    </>
  );
});
