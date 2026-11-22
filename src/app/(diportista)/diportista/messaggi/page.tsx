import type { Metadata } from "next";
import Link from "next/link";
import { page } from "@/components/page";
import { PushToggle } from "@/components/push-toggle";
import { Badge, Card } from "@/components/ui";
import { requireOwner } from "@/lib/context";
import { formatDateTime } from "@/lib/dates";
import { MESSAGE_KIND_LABEL, MESSAGE_KIND_TONE } from "@/lib/labels";
import { ownerMessages } from "@/server/messages";
import { pushPublicKey } from "@/server/push";

export const metadata: Metadata = { title: "Messaggi" };

export default page(async function OwnerMessagesPage() {
  const ctx = await requireOwner();
  const rows = await ownerMessages({ marinaId: ctx.marinaId, ownerId: ctx.ownerId });
  return (
    <>
      <h1 className="font-display text-3xl font-semibold text-ink">Messaggi</h1>
      <p className="mt-1 text-[15px] text-muted">Avvisi e comunicazioni di {ctx.marinaName}.</p>
      <div className="mt-6 space-y-5">
        {/* L'account manager che prova l'area non attiva le notifiche del cliente. */}
        {!ctx.preview && <PushToggle publicKey={pushPublicKey()} />}
        <Card flush>
          {rows.length === 0 ? (
            <p className="p-4 text-sm text-muted">Nessun messaggio, per ora.</p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {rows.map((m) => (
                <li key={m.id}>
                  <Link href={`/diportista/messaggi/${m.id}`} prefetch={false} className="block px-4 py-3 hover:bg-paper">
                    <div className="flex items-center gap-2">
                      {!m.readAt && <span className="size-2 shrink-0 rounded-full bg-buoy" aria-label="Da leggere" />}
                      <span className={`min-w-0 flex-1 truncate ${m.readAt ? "text-ink" : "font-semibold text-ink"}`}>{m.title}</span>
                      {m.kind !== "info" && <Badge tone={MESSAGE_KIND_TONE[m.kind]}>{MESSAGE_KIND_LABEL[m.kind]}</Badge>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted">{m.body}</p>
                    <p className="mt-1 text-xs text-faint">{formatDateTime(m.createdAt)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
});
