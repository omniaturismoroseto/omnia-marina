import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import QRCode from "qrcode";
import { DocumentTitle } from "@/components/document-title";
import { page } from "@/components/page";
import { PortLogo } from "@/components/port-logo";
import { PrintButton } from "@/components/print-button";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { marinas, ownerInvites, owners } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { formatDate, todayRome } from "@/lib/dates";
import { portLogo } from "@/lib/logo";
import { activationUrl, formatInviteCode } from "@/lib/owner-access";
import { uuidOrNull } from "@/lib/params";
import { marinaAddress } from "@/lib/templates";
import { appBaseUrl } from "@/server/app-url";

export const metadata: Metadata = { title: "Foglio di benvenuto" };

// Foglio da consegnare al diportista (di solito insieme al contratto): codice, QR code e istruzioni.
export default page(async function InviteSheetPage({ params }: { params: Promise<{ id: string; inviteId: string }> }) {
  const ctx = await requireMarina(OFFICE);
  const p = await params;
  const ownerId = uuidOrNull(p.id);
  const inviteId = uuidOrNull(p.inviteId);
  if (!ownerId || !inviteId) notFound();

  const [row] = await db
    .select({ invite: ownerInvites, ownerType: owners.type, ownerName: owners.displayName })
    .from(ownerInvites)
    .innerJoin(owners, eq(owners.id, ownerInvites.ownerId))
    .where(and(eq(ownerInvites.id, inviteId), eq(ownerInvites.ownerId, ownerId), eq(ownerInvites.marinaId, ctx.marinaId), gt(ownerInvites.expiresAt, new Date())))
    .limit(1);
  if (!row) notFound();
  const { invite } = row;

  const [[marina], baseUrl] = await Promise.all([db.select().from(marinas).where(eq(marinas.id, ctx.marinaId)), appBaseUrl()]);
  const url = activationUrl(baseUrl, invite.code);
  const qr = await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0b2239", light: "#ffffff" } });
  const logo = portLogo(marina);
  const company = row.ownerType === "azienda";

  return (
    <>
      <DocumentTitle title={`Benvenuto - ${invite.name}`} />
      <div className="no-print">
        <PageHeader
          title="Foglio di benvenuto"
          description="Stampalo e consegnalo insieme al contratto. Il codice vale una volta sola: chi lo riceve sceglie email e password."
          back={{ href: `/clienti/${ownerId}`, label: row.ownerName }}
          actions={<PrintButton />}
        />
      </div>

      <article className="card mx-auto max-w-2xl p-6 text-[14px] leading-relaxed sm:p-10 print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-col gap-3 border-b-2 border-ink pb-4 sm:flex-row sm:items-center sm:gap-4 print:flex-row print:items-center print:gap-4">
          {logo && <PortLogo logo={logo} alt="" className="h-14 w-auto max-w-[10rem] shrink-0" />}
          <div className="min-w-0">
            <p className="font-display text-xl leading-tight font-semibold">{marina.name}</p>
            <p className="mt-1 text-xs break-words text-muted">{[marinaAddress(marina), marina.phone, marina.email].filter(Boolean).join(" · ")}</p>
          </div>
        </header>

        <h1 className="mt-6 font-display text-3xl font-semibold text-ink">Benvenuto a bordo, {invite.name}</h1>
        <p className="mt-2 text-muted">
          Con l&apos;app del porto hai la tua area personale da diportista, dal telefono o dal computer. Per entrare la prima volta ti
          bastano pochi minuti.
        </p>

        <div className="mt-6 grid grid-cols-1 items-center gap-6 rounded-lg border border-line p-5 sm:grid-cols-[minmax(0,1fr)_10rem] print:grid-cols-[minmax(0,1fr)_10rem]">
          <div>
            <p className="text-xs tracking-widest text-muted uppercase">Il tuo codice di attivazione</p>
            <p className="mt-1 font-mono text-4xl font-semibold tracking-[0.15em] text-ink">{formatInviteCode(invite.code)}</p>
            <p className="mt-2 text-sm text-muted">Vale fino al {formatDate(todayRome(invite.expiresAt))}, una volta sola.</p>
          </div>
          <div className="mx-auto w-40 sm:mx-0 print:mx-0" aria-label="QR code per attivare l'accesso" dangerouslySetInnerHTML={{ __html: qr }} />
        </div>

        <h2 className="mt-8 text-lg font-semibold text-ink">Come si attiva</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5">
          <li>
            Inquadra il QR code con la fotocamera del telefono, oppure apri <span className="font-medium break-all text-ink">{baseUrl}/attiva</span> e scrivi il
            codice.
          </li>
          <li>
            Scrivi {company ? "la partita IVA o il codice fiscale della società" : `il codice fiscale dell'intestatario del contratto (${row.ownerName})`}: è
            la prova che l&apos;invito è arrivato alla persona giusta.
          </li>
          <li>Scegli l&apos;email e una password di almeno 10 caratteri.</li>
          <li>Apri l&apos;email di conferma che ti arriva (guarda anche nella posta indesiderata), poi accedi.</li>
        </ol>

        <p className="mt-6 text-sm text-muted">
          Hai già un account Omnia Marina? Usa la stessa email e la sua password: l&apos;area diportista si aggiunge al tuo account. Il codice è personale:
          non darlo ad altri. Per un familiare o uno skipper chiedi al porto un invito a parte.
        </p>
        {(marina.phone || marina.email) && (
          <p className="mt-3 text-sm text-muted">Serve aiuto? Contatta il porto: {[marina.phone, marina.email].filter(Boolean).join(" · ")}.</p>
        )}
      </article>
    </>
  );
});
