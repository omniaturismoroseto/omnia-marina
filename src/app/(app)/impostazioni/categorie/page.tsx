import type { Metadata } from "next";
import { asc, eq, sql } from "drizzle-orm";
import { page } from "@/components/page";
import { Card, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { berthCategories } from "@/db/schema";
import { requireMarina } from "@/lib/context";
import { metersInput } from "@/lib/format";
import { CategoryForm, DeleteCategoryButton } from "../settings-forms";
import { SettingsTabs } from "../tabs";

export const metadata: Metadata = { title: "Categorie dei posti" };

export default page(async function CategoriesPage() {
  const ctx = await requireMarina(["admin"]);
  const rows = await db
    .select({
      category: berthCategories,
      berthCount: sql<number>`(select count(*) from berths b where b.category_id = "berth_categories"."id")::int`,
    })
    .from(berthCategories)
    .where(eq(berthCategories.marinaId, ctx.marinaId))
    .orderBy(asc(berthCategories.sortOrder), asc(berthCategories.maxLengthCm));

  return (
    <>
      <PageHeader help="impostazioni" title="Impostazioni" description="Le categorie raggruppano i posti per dimensione: a ogni categoria corrisponde una riga del listino." />
      <SettingsTabs current="categorie" />
      <div className="space-y-5">
        <Card title={`Categorie (${rows.length})`}>
          {rows.length === 0 ? (
            <p className="text-sm text-muted">Nessuna categoria: aggiungine una qui sotto.</p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {rows.map(({ category: c, berthCount }) => (
                <li key={c.id} className="py-4 first:pt-0 last:pb-0">
                  <CategoryForm category={{ id: c.id, name: c.name, length: metersInput(c.maxLengthCm), beam: metersInput(c.maxBeamCm), sortOrder: c.sortOrder }} nextOrder={c.sortOrder} />
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted">
                    <span>
                      {berthCount} {berthCount === 1 ? "posto" : "posti"} in questa categoria
                    </span>
                    {berthCount === 0 && <DeleteCategoryButton categoryId={c.id} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Nuova categoria">
          <CategoryForm nextOrder={rows.length} />
        </Card>
      </div>
    </>
  );
});
