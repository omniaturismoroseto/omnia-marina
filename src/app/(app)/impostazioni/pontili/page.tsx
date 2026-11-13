import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { page } from "@/components/page";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { berthCategories, berths, piers } from "@/db/schema";
import { requireMarina } from "@/lib/context";
import { formatDimensions } from "@/lib/format";
import { BERTH_STATUS_LABEL } from "@/lib/labels";
import { one, type SearchParams } from "@/lib/params";
import { DeletePierButton, GenerateBerthsForm, PierForm } from "../settings-forms";
import { SettingsTabs } from "../tabs";

export const metadata: Metadata = { title: "Pontili e posti barca" };

export default page(async function PiersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMarina(["admin"]);
  const welcome = one((await searchParams).benvenuto) === "1";

  const [pierRows, berthRows, categories] = await Promise.all([
    db.select().from(piers).where(eq(piers.marinaId, ctx.marinaId)).orderBy(asc(piers.sortOrder), asc(piers.code)),
    db.select().from(berths).where(eq(berths.marinaId, ctx.marinaId)).orderBy(asc(berths.code)),
    db.select().from(berthCategories).where(eq(berthCategories.marinaId, ctx.marinaId)).orderBy(asc(berthCategories.sortOrder), asc(berthCategories.maxLengthCm)),
  ]);
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
            <Card key={pier.id} title={`${pier.name} · ${list.length} posti`} actions={<DeletePierButton pierId={pier.id} berthCount={list.length} />}>
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

              <details className="border-t border-line-soft pt-3" open={list.length === 0}>
                <summary className="link cursor-pointer text-sm">Crea posti in blocco</summary>
                <div className="mt-3">
                  {categoryOptions.length === 0 ? (
                    <p className="text-sm text-warn">
                      Servono prima le <Link href="/impostazioni/categorie" className="link">categorie</Link>.
                    </p>
                  ) : (
                    <GenerateBerthsForm pierId={pier.id} prefix={pier.code} categories={categoryOptions} />
                  )}
                </div>
              </details>
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
