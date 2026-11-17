import type { Metadata } from "next";
import { asc, eq, and } from "drizzle-orm";
import { page } from "@/components/page";
import { Card, Details } from "@/components/ui";
import { db } from "@/db";
import { boats } from "@/db/schema";
import { requireOwner } from "@/lib/context";
import { formatDimensions } from "@/lib/format";
import { OwnPasswordForm } from "../../(app)/impostazioni/settings-forms";

export const metadata: Metadata = { title: "Area diportista" };

export default page(async function OwnerHomePage() {
  const ctx = await requireOwner();
  const boatRows = await db
    .select({ id: boats.id, name: boats.name, lengthCm: boats.lengthCm, beamCm: boats.beamCm })
    .from(boats)
    .where(and(eq(boats.ownerId, ctx.ownerId), eq(boats.marinaId, ctx.marinaId)))
    .orderBy(asc(boats.name));
  const firstName = ctx.user.name.split(" ")[0];

  return (
    <>
      <h1 className="font-display text-3xl font-semibold text-ink">Ciao {firstName}</h1>
      <p className="mt-1 text-[15px] text-muted">
        Benvenuto nell&apos;area diportista di {ctx.marinaName}. Presto qui troverai contratto, scadenze, pagamenti e documenti.
      </p>

      <div className="mt-6 grid grid-cols-1 items-start gap-5 sm:grid-cols-2">
        <Card title={boatRows.length === 1 ? "La tua barca" : "Le tue barche"}>
          {boatRows.length === 0 ? (
            <p className="text-sm text-muted">Nessuna barca registrata.</p>
          ) : (
            <ul className="space-y-2">
              {boatRows.map((b) => (
                <li key={b.id} className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-ink">{b.name}</span>
                  <span className="text-sm text-muted tabular-nums">{formatDimensions(b.lengthCm, b.beamCm)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Il tuo accesso">
          <Details
            columns={1}
            items={[
              ["Nome", ctx.user.name],
              ["Email", ctx.user.email],
              ["Intestatario", ctx.ownerName],
            ]}
          />
        </Card>

        <Card title="Cambia password" className="sm:col-span-2">
          <OwnPasswordForm />
        </Card>
      </div>
    </>
  );
});
