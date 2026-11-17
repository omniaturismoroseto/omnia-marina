import type { Metadata } from "next";
import { and, asc, eq, isNull } from "drizzle-orm";
import { page } from "@/components/page";
import { Card, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { owners, piers } from "@/db/schema";
import { EVERYONE, requireMarina } from "@/lib/context";
import { canSendTo } from "@/server/messages";
import { MessageForm } from "../message-form";

export const metadata: Metadata = { title: "Nuovo messaggio" };

const ALL = ["tutti", "pontile", "tipo", "in_porto", "cliente"] as const;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default page(async function NewMessagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireMarina(EVERYONE);
  const sp = await searchParams;
  const [pierRows, ownerRows] = await Promise.all([
    db.select({ id: piers.id, name: piers.name }).from(piers).where(eq(piers.marinaId, ctx.marinaId)).orderBy(asc(piers.sortOrder), asc(piers.code)),
    db
      .select({ id: owners.id, name: owners.displayName })
      .from(owners)
      .where(and(eq(owners.marinaId, ctx.marinaId), isNull(owners.anonymizedAt)))
      .orderBy(asc(owners.displayName)),
  ]);
  const ownerId = one(sp.cliente);
  return (
    <>
      <PageHeader help="messaggi" title="Nuovo messaggio" back={{ href: "/messaggi", label: "Messaggi" }} />
      <Card className="max-w-2xl">
        <MessageForm
          audiences={ALL.filter((a) => canSendTo(ctx.role, a))}
          piers={pierRows.map((p) => ({ value: p.id, label: p.name }))}
          owners={ownerRows.map((o) => ({ value: o.id, label: o.name }))}
          defaults={{
            audienceType: ownerId ? "cliente" : one(sp.a),
            ownerId,
            kind: one(sp.tipo),
            title: one(sp.titolo),
            body: one(sp.testo),
            windAlert: one(sp.allerta) === "1",
          }}
        />
      </Card>
    </>
  );
});
