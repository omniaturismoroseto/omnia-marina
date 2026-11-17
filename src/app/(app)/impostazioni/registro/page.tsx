import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { page } from "@/components/page";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { requireMarina } from "@/lib/context";
import { formatDateTime } from "@/lib/dates";
import { SettingsTabs } from "../tabs";

export const metadata: Metadata = { title: "Registro delle operazioni" };

export default page(async function AuditPage() {
  const ctx = await requireMarina(["admin"]);
  const rows = await db
    .select({ id: auditLog.id, at: auditLog.at, action: auditLog.action, entity: auditLog.entity, summary: auditLog.summary, userName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(eq(auditLog.marinaId, ctx.marinaId))
    .orderBy(desc(auditLog.at))
    .limit(300);

  return (
    <>
      <PageHeader help="impostazioni" title="Impostazioni" description="Chi ha creato, modificato, esportato o cancellato dati personali e contabili. Sono mostrate le ultime 300 operazioni." />
      <SettingsTabs current="registro" />
      <Card flush>
        {rows.length === 0 ? (
          <EmptyState title="Nessuna operazione registrata" />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Data e ora</th>
                <th>Utente</th>
                <th>Operazione</th>
                <th>Dettaglio</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap tabular-nums">{formatDateTime(r.at)}</td>
                  <td>{r.userName ?? "—"}</td>
                  <td className="first-letter:uppercase">
                    {r.action} · {r.entity}
                  </td>
                  <td className="text-muted">{r.summary ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
});
