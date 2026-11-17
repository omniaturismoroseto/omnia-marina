import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Phone } from "lucide-react";
import { page } from "@/components/page";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { EVERYONE, requireMarina } from "@/lib/context";
import { formatDateTime } from "@/lib/dates";
import { MESSAGE_KIND_LABEL, MESSAGE_KIND_TONE } from "@/lib/labels";
import { uuidOrNull } from "@/lib/params";
import { messageWithRecipients } from "@/server/messages";

export const metadata: Metadata = { title: "Messaggio" };

export default page(async function MessagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ inviato?: string }>;
}) {
  const ctx = await requireMarina(EVERYONE);
  const id = uuidOrNull((await params).id);
  if (!id) notFound();
  const data = await messageWithRecipients(ctx.marinaId, id);
  if (!data) notFound();
  const { message: m, senderName, recipients } = data;
  const justSent = (await searchParams).inviato === "1";
  const read = recipients.filter((r) => r.readAt).length;
  const withApp = recipients.filter((r) => r.hasApp).length;

  return (
    <>
      <PageHeader title={m.title} back={{ href: "/messaggi", label: "Messaggi" }} description={`${m.audience} · ${formatDateTime(m.createdAt)}${senderName ? ` · ${senderName}` : ""}`} />
      {justSent && (
        <div className="mb-5">
          <Notice tone="ok">
            Messaggio inviato a {recipients.length} {recipients.length === 1 ? "cliente" : "clienti"}
            {withApp < recipients.length ? `: ${withApp} con l'app attiva, gli altri lo vedranno quando attiveranno l'accesso.` : "."}
          </Notice>
        </div>
      )}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card title={<Badge tone={MESSAGE_KIND_TONE[m.kind]}>{MESSAGE_KIND_LABEL[m.kind]}</Badge>}>
          <p className="text-[15px] leading-relaxed whitespace-pre-line text-ink">{m.body}</p>
        </Card>
        <Card title={`Letto da ${read} su ${recipients.length}`} flush>
          <ul className="divide-y divide-line-soft">
            {recipients.map((r) => (
              <li key={r.ownerId} className="flex items-start justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{r.ownerName}</p>
                  <p className="text-xs text-muted">
                    {r.readAt ? `Letto ${formatDateTime(r.readAt)}${r.readerName ? ` da ${r.readerName}` : ""}` : r.hasApp ? "Non ancora letto" : "Senza app"}
                  </p>
                </div>
                {!r.readAt && m.kind === "urgente" && r.phone && (
                  <a href={`tel:${r.phone.replace(/\s/g, "")}`} className="btn btn-secondary btn-sm shrink-0">
                    <Phone size={14} aria-hidden="true" />
                    Chiama
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
});
