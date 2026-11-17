import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { page } from "@/components/page";
import { Badge, Card, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { memberships, users } from "@/db/schema";
import { requireMarina } from "@/lib/context";
import { ROLE_HINT, ROLE_LABEL } from "@/lib/labels";
import { AddMemberForm, MemberActions, MemberRoleForm } from "../settings-forms";
import { SettingsTabs } from "../tabs";

export const metadata: Metadata = { title: "Utenti" };

export default page(async function UsersPage() {
  const ctx = await requireMarina(["admin"]);
  const rows = await db
    .select({ membershipId: memberships.id, role: memberships.role, userId: users.id, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.marinaId, ctx.marinaId))
    .orderBy(asc(users.name));

  return (
    <>
      <PageHeader help="impostazioni" title="Impostazioni" description="Chi può accedere al porto e con quale ruolo." />
      <SettingsTabs current="utenti" />
      <div className="space-y-5">
        <Card title={`Persone con accesso (${rows.length})`} flush>
          <ul>
            {rows.map((m) => (
              <li key={m.membershipId} className="grid grid-cols-1 gap-3 border-b border-line-soft p-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-start">
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {m.name} {m.userId === ctx.user.id && <Badge tone="sea">tu</Badge>}
                  </p>
                  <p className="truncate text-sm text-muted">{m.email}</p>
                </div>
                <MemberRoleForm membershipId={m.membershipId} role={m.role} />
                <MemberActions membershipId={m.membershipId} self={m.userId === ctx.user.id} />
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Aggiungi una persona">
          <AddMemberForm />
        </Card>

        <Card title="Cosa può fare ogni ruolo">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(["admin", "ufficio", "banchina"] as const).map((role) => (
              <div key={role}>
                <dt className="text-sm font-semibold text-ink">{ROLE_LABEL[role]}</dt>
                <dd className="text-sm text-muted">{ROLE_HINT[role]}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
});
