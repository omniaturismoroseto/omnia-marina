import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "@/components/icons";
import { MarkRead } from "@/components/mark-read";
import { page } from "@/components/page";
import { Badge, Card } from "@/components/ui";
import { requireOwner } from "@/lib/context";
import { formatDateTime } from "@/lib/dates";
import { MESSAGE_KIND_LABEL, MESSAGE_KIND_TONE } from "@/lib/labels";
import { uuidOrNull } from "@/lib/params";
import { ownerMessage } from "@/server/messages";

export const metadata: Metadata = { title: "Messaggio" };

export default page(async function OwnerMessagePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOwner();
  const id = uuidOrNull((await params).id);
  if (!id) notFound();
  const row = await ownerMessage({ marinaId: ctx.marinaId, ownerId: ctx.ownerId }, id);
  if (!row) notFound();
  const m = row.message;
  return (
    <>
      {!row.readAt && <MarkRead messageId={m.id} />}
      <Link href="/diportista/messaggi" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft size={16} aria-hidden="true" />
        Messaggi
      </Link>
      <Card className="mt-3">
        <Badge tone={MESSAGE_KIND_TONE[m.kind]}>{MESSAGE_KIND_LABEL[m.kind]}</Badge>
        <h1 className="mt-2 font-display text-2xl font-semibold text-ink">{m.title}</h1>
        <p className="mt-1 text-xs text-muted">
          {ctx.marinaName} · {formatDateTime(m.createdAt)}
        </p>
        <p className="mt-4 text-[15px] leading-relaxed whitespace-pre-line text-ink">{m.body}</p>
      </Card>
    </>
  );
});
