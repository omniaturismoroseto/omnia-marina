import type { Metadata } from "next";
import { asc, desc, eq } from "drizzle-orm";
import { page } from "@/components/page";
import { Badge, Card, EmptyState, FilterTabs, Notice, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { berthCategories, priceLists, rates, seasonPeriods } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { formatDate, todayRome, yearOf } from "@/lib/dates";
import { formatDimensions, moneyInput } from "@/lib/format";
import { SEASON_LABEL } from "@/lib/labels";
import { uuidOrNull, type SearchParams } from "@/lib/params";
import { DeletePeriodButton, ListActions, PriceListForm, RatesGrid, SeasonPeriodForm, Simulator, type RateGridRow } from "./tariff-forms";

export const metadata: Metadata = { title: "Tariffe" };

export default page(async function TariffsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMarina(OFFICE);
  const admin = ctx.role === "admin";
  const today = todayRome();
  const selectedId = uuidOrNull((await searchParams).listino);

  const [lists, categories] = await Promise.all([
    db.select().from(priceLists).where(eq(priceLists.marinaId, ctx.marinaId)).orderBy(desc(priceLists.validFrom)),
    db.select().from(berthCategories).where(eq(berthCategories.marinaId, ctx.marinaId)).orderBy(asc(berthCategories.sortOrder), asc(berthCategories.maxLengthCm)),
  ]);
  // Senza scelta esplicita si apre il listino in vigore oggi, altrimenti il più recente.
  const list = lists.find((l) => l.id === selectedId) ?? lists.find((l) => l.validFrom <= today && today <= l.validTo) ?? lists[0];

  const [rateRows, periods] = list
    ? await Promise.all([
        db.select().from(rates).where(eq(rates.priceListId, list.id)),
        db.select().from(seasonPeriods).where(eq(seasonPeriods.priceListId, list.id)).orderBy(asc(seasonPeriods.startDate)),
      ])
    : [[], []];

  const grid: RateGridRow[] = categories.map((c) => {
    const r = rateRows.find((row) => row.categoryId === c.id);
    const show = (cents: number | undefined) => (cents ? moneyInput(cents) : "");
    return {
      categoryId: c.id,
      categoryName: c.name,
      size: `fino a ${formatDimensions(c.maxLengthCm, c.maxBeamCm)}`,
      values: {
        dailyLow: show(r?.dailyLow),
        dailyMid: show(r?.dailyMid),
        dailyHigh: show(r?.dailyHigh),
        monthlyLow: show(r?.monthlyLow),
        monthlyMid: show(r?.monthlyMid),
        monthlyHigh: show(r?.monthlyHigh),
        annual: show(r?.annual),
      },
    };
  });
  const empty = rateRows.every((r) => r.dailyLow + r.dailyMid + r.dailyHigh + r.monthlyLow + r.monthlyMid + r.monthlyHigh + r.annual === 0);

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
            {categories.length > 0 && <RatesGrid listId={list.id} rows={grid} editable={admin} />}
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

            <Card title="Simulatore">{categories.length > 0 ? <Simulator key={list.id} listId={list.id} categories={categories.map((c) => ({ id: c.id, name: c.name }))} today={today} /> : <p className="text-sm text-muted">Servono le categorie.</p>}</Card>
          </div>

          {admin && (
            <Card title="Dati del listino" actions={<ListActions listId={list.id} />}>
              <PriceListForm key={list.id} list={list} defaultYear={yearOf(today)} />
            </Card>
          )}
        </div>
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
