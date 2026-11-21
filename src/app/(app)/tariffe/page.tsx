import type { Metadata } from "next";
import { asc, desc, eq } from "drizzle-orm";
import { page } from "@/components/page";
import { Badge, Card, EmptyState, FilterTabs, Notice, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { berthCategories, piers, priceListExtras, priceLists, rates, seasonPeriods } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { formatDate, todayRome, yearOf } from "@/lib/dates";
import { formatDimensions, moneyInput } from "@/lib/format";
import { SEASON_LABEL } from "@/lib/labels";
import { RATE_FIELDS, groupPiersByName } from "@/lib/pricing";
import { uuidOrNull, type SearchParams } from "@/lib/params";
import { OFFICIAL_CATEGORIES, OFFICIAL_LIST } from "@/server/official-price-list";
import {
  BaseRatePiersForm,
  CopyPierRatesForm,
  DeletePeriodButton,
  ListActions,
  LoadOfficialListButton,
  PierBaseRateButton,
  PriceListExtras,
  PriceListForm,
  RatesGrid,
  SeasonPeriodForm,
  Simulator,
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
  const selectedPierId = uuidOrNull(params.pontile);

  const [lists, categories, pierRows] = await Promise.all([
    db.select().from(priceLists).where(eq(priceLists.marinaId, ctx.marinaId)).orderBy(desc(priceLists.validFrom)),
    db.select().from(berthCategories).where(eq(berthCategories.marinaId, ctx.marinaId)).orderBy(asc(berthCategories.sortOrder), asc(berthCategories.maxLengthCm)),
    db
      .select({ id: piers.id, name: piers.name, baseRate: piers.baseRate })
      .from(piers)
      .where(eq(piers.marinaId, ctx.marinaId))
      .orderBy(asc(piers.sortOrder), asc(piers.code)),
  ]);
  // Senza scelta esplicita si apre il listino in vigore oggi, altrimenti il più recente.
  const list = lists.find((l) => l.id === selectedId) ?? lists.find((l) => l.validFrom <= today && today <= l.validTo) ?? lists[0];
  // Pontili con lo stesso nome: una scheda sola, prezzi condivisi.
  const groups = groupPiersByName(pierRows);
  const group = groups.find((g) => selectedPierId !== null && g.ids.includes(selectedPierId)) ?? null;
  const basePierNames = groups.filter((g) => g.baseRate).map((g) => g.name);

  const [rateRows, periods, extras] = list
    ? await Promise.all([
        db.select().from(rates).where(eq(rates.priceListId, list.id)),
        db.select().from(seasonPeriods).where(eq(seasonPeriods.priceListId, list.id)).orderBy(asc(seasonPeriods.startDate)),
        db.select().from(priceListExtras).where(eq(priceListExtras.priceListId, list.id)).orderBy(asc(priceListExtras.sortOrder), asc(priceListExtras.name)),
      ])
    : [[], [], []];
  // Dentro un gruppo i prezzi si leggono dal primo pontile che ne ha in questo listino (salvando valgono per tutti).
  const pier = group
    ? { id: group.ids.find((id) => rateRows.some((r) => r.pierId === id)) ?? group.ids[0], name: group.name, baseRate: group.baseRate, count: group.ids.length }
    : null;

  const show = (cents: number | undefined) => (cents ? moneyInput(cents) : "");
  const valuesOf = (r: (typeof rateRows)[number] | undefined) => Object.fromEntries(RATE_FIELDS.map((k) => [k, show(r?.[k])])) as RateGridRow["values"];
  const grid: RateGridRow[] = categories.map((c) => {
    const base = rateRows.find((row) => row.categoryId === c.id && row.pierId === null);
    const own = pier ? rateRows.find((row) => row.categoryId === c.id && row.pierId === pier.id) : base;
    return {
      categoryId: c.id,
      categoryName: c.name,
      size: `fino a ${formatDimensions(c.maxLengthCm, c.maxBeamCm)}`,
      values: valuesOf(own),
      fallback: pier ? valuesOf(base) : undefined,
    };
  });
  const empty = rateRows.every((r) => RATE_FIELDS.every((k) => r[k] === 0));
  const listHref = (pierId: string | null | undefined) => `/tariffe?listino=${list?.id ?? ""}${pierId ? `&pontile=${pierId}` : ""}`;
  const pierHasPrices = (pierId: string) => rateRows.some((r) => r.pierId === pierId && RATE_FIELDS.some((k) => r[k] > 0));

  return (
    <>
      <PageHeader help="tariffe"
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
                {groups.length > 0 && (
                  <div className="space-y-3 border-b border-line-soft p-4">
                    <FilterTabs
                      current={group?.key ?? "base"}
                      items={[
                        { value: "base", label: "Tariffa base", href: listHref(null) },
                        ...groups.map((g) => ({ value: g.key, label: g.baseRate ? `${g.name} · base` : g.name, href: listHref(g.ids[0]) })),
                      ]}
                    />
                    {!pier ? (
                      admin ? (
                        <BaseRatePiersForm piers={groups.map((g) => ({ id: g.ids[0], name: g.name, baseRate: g.baseRate }))} />
                      ) : (
                        <p className="text-sm text-muted">
                          La tariffa base vale per {listOrNone(basePierNames)} e per le caselle lasciate vuote nei prezzi degli altri pontili.
                        </p>
                      )
                    ) : (
                      <div className="space-y-3">
                        {pier.count > 1 && (
                          <p className="text-sm text-muted">
                            Ci sono {pier.count} pontili chiamati «{pier.name}»: hanno un&apos;unica tariffa e i prezzi salvati qui valgono per tutti.
                          </p>
                        )}
                        {pier.baseRate ? (
                          <Notice>
                            {pier.name} usa la tariffa base: i prezzi qui sotto non si applicano finché non la spegni.
                            {!pierHasPrices(pier.id) && " Compilali, oppure copiali dalla tariffa base o da un altro pontile."}
                          </Notice>
                        ) : (
                          <p className="text-sm text-muted">
                            {pier.name} usa i suoi prezzi, in tutti i listini. Dove una casella è vuota vale la tariffa base, mostrata in grigio.
                          </p>
                        )}
                        {admin && (
                          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                            <PierBaseRateButton pierId={pier.id} name={pier.name} baseRate={pier.baseRate} />
                            <CopyPierRatesForm
                              key={`${list.id}:${pier.id}`}
                              listId={list.id}
                              pierId={pier.id}
                              sources={groups.filter((g) => g !== group).map((g) => ({ id: g.ids.find((id) => rateRows.some((r) => r.pierId === id)) ?? g.ids[0], name: g.name }))}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <RatesGrid key={`${list.id}:${pier?.id ?? ""}`} listId={list.id} pierId={pier?.id ?? ""} rows={grid} editable={admin} />
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
                  piers={groups.map((g) => ({ id: g.ids[0], name: g.baseRate ? `${g.name} (tariffa base)` : g.name }))}
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

      {admin && (
        <Card title="Listino ufficiale 2026" className="mt-5">
          <p className="mb-3 text-sm text-muted">
            Dal foglio delle tariffe ufficiali: {OFFICIAL_CATEGORIES.length} categorie per lunghezza, tariffa base per le darsene A, B e D e prezzi propri
            per la darsena C (il pontile con codice «C» o con il nome che finisce per «C»); canone annuale, quota rifiuti, stagionale maggio – settembre e
            mensile per le categorie B e C, posti auto, carrelli e cauzioni. Dopo il caricamento: se la darsena C ha più pontili, copia i suoi prezzi negli
            altri dalla loro scheda qui sopra, assegna le categorie ai posti e controlla le larghezze in Impostazioni → Categorie, che sono indicative.
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
