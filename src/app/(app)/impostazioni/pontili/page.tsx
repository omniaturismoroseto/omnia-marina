import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { page } from "@/components/page";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { berthCategories, berths, piers, tariffZones } from "@/db/schema";
import { requireMarina } from "@/lib/context";
import { formatDimensions } from "@/lib/format";
import { BERTH_STATUS_LABEL } from "@/lib/labels";
import { one, type SearchParams } from "@/lib/params";
import { DeletePierButton, GenerateBerthsForm, PierForm } from "../settings-forms";
import { SettingsTabs } from "../tabs";

export const metadata: Metadata = { title: "Pontili e posti barca" };

// Numero successivo all'ultimo posto con la sigla del pontile (es. C25 → 26).
function nextNumber(prefix: string, list: { code: string }[]): number {
  const numbers = list.map((b) => (b.code.startsWith(prefix) ? Number.parseInt(b.code.slice(prefix.length), 10) : Number.NaN)).filter(Number.isFinite);
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

export default page(async function PiersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMarina(["admin"]);
  const welcome = one((await searchParams).benvenuto) === "1";

  const [pierRows, berthRows, categories, zones] = await Promise.all([
    db.select().from(piers).where(eq(piers.marinaId, ctx.marinaId)).orderBy(asc(piers.sortOrder), asc(piers.code)),
    db.select().from(berths).where(eq(berths.marinaId, ctx.marinaId)).orderBy(asc(berths.code)),
    db.select().from(berthCategories).where(eq(berthCategories.marinaId, ctx.marinaId)).orderBy(asc(berthCategories.sortOrder), asc(berthCategories.maxLengthCm)),
    db.select({ id: tariffZones.id, name: tariffZones.name }).from(tariffZones).where(eq(tariffZones.marinaId, ctx.marinaId)),
  ]);
  const zoneName = new Map(zones.map((z) => [z.id, z.name]));
  const categoryOptions = categories.map((c) => ({ id: c.id, label: `${c.name} (${formatDimensions(c.maxLengthCm, c.maxBeamCm)})` }));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <>
      <PageHeader title="Impostazioni" description="Pontili, banchine e posti barca: è la struttura che compare sulla mappa." />
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

      <div className="space-y-5">
        {pierRows.map((pier) => {
          const list = berthRows.filter((b) => b.pierId === pier.id);
          return (
            <Card
              key={pier.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {pier.name} · {list.length} posti
                  {pier.tariffZoneId && zoneName.has(pier.tariffZoneId) && (
                    <Link href={`/tariffe?zona=${pier.tariffZoneId}`} title="Zona tariffaria" className="no-underline">
                      <Badge tone="sea">{zoneName.get(pier.tariffZoneId)}</Badge>
                    </Link>
                  )}
                </span>
              }
              actions={<DeletePierButton pierId={pier.id} berthCount={list.length} />}
            >
              {list.length > 0 && (
                <ul className="mb-4 flex flex-wrap gap-1.5">
                  {list.map((b) => (
                    <li key={b.id}>
                      <Link
                        href={`/impostazioni/pontili/posto/${b.id}`}
                        title={`${formatDimensions(b.lengthCm, b.beamCm)}${b.categoryId ? ` · ${categoryName.get(b.categoryId) ?? ""}` : ""} · ${BERTH_STATUS_LABEL[b.status]}`}
                        className={`inline-flex min-w-12 items-center justify-center rounded border px-2 py-1 text-sm font-medium tabular-nums hover:border-sea ${
                          b.status === "attivo" ? "border-line bg-white text-ink" : "border-line bg-line-soft text-faint"
                        }`}
                      >
                        {b.code}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {list.some((b) => b.status !== "attivo") && (
                <p className="mb-4 text-sm text-muted">
                  <Badge>In grigio</Badge> i posti in manutenzione o fuori servizio.
                </p>
              )}
              <p className="mb-3 text-sm text-muted">Tocca un posto per modificarne misure, categoria e stato.</p>

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
                    // key: dopo ogni creazione il modulo riparte con il numero successivo già proposto.
                    <GenerateBerthsForm key={list.length} pierId={pier.id} prefix={pier.code} nextNumber={nextNumber(pier.code, list)} categories={categoryOptions} />
                  )}
                </div>
              </section>
              <details className="mt-3 border-t border-line-soft pt-3">
                <summary className="link cursor-pointer text-sm">Rinomina il pontile</summary>
                <div className="mt-3">
                  <PierForm pier={pier} nextOrder={pier.sortOrder} />
                </div>
              </details>
            </Card>
          );
        })}

        <Card title="Nuovo pontile o banchina">
          <PierForm nextOrder={pierRows.length} />
        </Card>
      </div>
    </>
  );
});
