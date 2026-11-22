import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "@/components/icons";
import { page } from "@/components/page";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { EVERYONE, requireMarina } from "@/lib/context";
import { formatDateTime } from "@/lib/dates";
import { MESSAGE_KIND_LABEL, MESSAGE_KIND_TONE } from "@/lib/labels";
import { sentMessages } from "@/server/messages";

export const metadata: Metadata = { title: "Messaggi" };

export default page(async function MessagesPage() {
  const ctx = await requireMarina(EVERYONE);
  const rows = await sentMessages(ctx.marinaId);
  return (
    <>
      <PageHeader
        help="messaggi"
        title="Messaggi"
        description="Avvisi ai diportisti: arrivano nella loro area dell'app e, se le hanno attivate, come notifiche sul telefono."
        actions={
          <ButtonLink href="/messaggi/nuovo" variant="primary">
            <Plus size={16} aria-hidden="true" />
            Nuovo messaggio
          </ButtonLink>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="Nessun messaggio inviato" description="Scrivi a un cliente, a un pontile o a tutti: per esempio lavori, meteo, orari." />
      ) : (
        <Card flush>
          <ul className="divide-y divide-line-soft">
            {rows.map((m) => (
              <li key={m.id}>
                <Link href={`/messaggi/${m.id}`} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-paper">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={MESSAGE_KIND_TONE[m.kind]}>{MESSAGE_KIND_LABEL[m.kind]}</Badge>
                      <span className="truncate font-medium text-ink">{m.title}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {m.audience} · {formatDateTime(m.createdAt)}
                      {m.senderName ? ` · ${m.senderName}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm text-muted tabular-nums">
                    letto {m.read}/{m.total}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
});
