import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { page } from "@/components/page";
import { PortLogo } from "@/components/port-logo";
import { PrintButton } from "@/components/print-button";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { marinas, owners } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { formatDate, todayRome } from "@/lib/dates";
import { portLogo } from "@/lib/logo";
import { uuidOrNull } from "@/lib/params";
import { fillTemplate, marinaAddress, textSections } from "@/lib/templates";

export const metadata: Metadata = { title: "Informativa privacy" };

function Choice({ label }: { label: string }) {
  return (
    <div className="mt-3 break-inside-avoid">
      <p className="text-[13px]">{label}</p>
      <p className="mt-1 text-[13px]">
        <span className="mr-6">☐ Acconsento</span>
        <span>☐ Non acconsento</span>
      </p>
    </div>
  );
}

/** Testo dell'informativa: il primo blocco è il titolo, i blocchi numerati hanno il titolo in grassetto e non si separano dal loro testo. */
function NoticeText({ text }: { text: string }) {
  return (
    <>
      {textSections(text).map((section, i) =>
        i === 0 && !section.heading ? (
          <div key={i} className="mb-4 text-center">
            <h1 className="font-bold uppercase">{section.lines[0]}</h1>
            {section.lines.slice(1).map((line, j) => (
              <p key={j} className="text-muted">
                {line}
              </p>
            ))}
          </div>
        ) : (
          <section key={i} className="mt-3 break-inside-avoid">
            {section.heading && <h2 className="font-bold break-after-avoid">{section.heading}</h2>}
            {section.lines.map((line, j) => (
              <p key={j}>{line}</p>
            ))}
          </section>
        ),
      )}
    </>
  );
}

export default page(async function PrivacyNoticePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMarina(OFFICE);
  const id = uuidOrNull((await params).id);
  if (!id) notFound();
  const [owner] = await db
    .select()
    .from(owners)
    .where(and(eq(owners.id, id), eq(owners.marinaId, ctx.marinaId)))
    .limit(1);
  if (!owner) notFound();
  const [marina] = await db.select().from(marinas).where(eq(marinas.id, ctx.marinaId));
  const logo = portLogo(marina);
  const text = marina.privacyPolicyText ? fillTemplate(marina.privacyPolicyText, marina) : null;

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Informativa privacy"
          description="Stampa il modulo, fallo firmare e poi registra i consensi nella scheda del cliente."
          back={{ href: `/clienti/${id}`, label: owner.displayName }}
          actions={<PrintButton />}
        />
      </div>

      <article className="card mx-auto max-w-3xl p-5 text-[13.5px] leading-relaxed sm:p-8 print:max-w-none print:border-0 print:p-0 print:text-[12px] print:leading-normal print:shadow-none">
        {/* Stessa intestazione del contratto: su telefono logo, nome e versione vanno uno sotto l'altro. */}
        <header className="mb-5 flex flex-col gap-3 border-b-2 border-ink pb-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6 print:flex-row print:items-start print:justify-between print:gap-6">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4 print:flex-row print:items-center print:gap-4">
            {logo && <PortLogo logo={logo} alt="" className="h-14 w-auto max-w-[10rem] shrink-0" />}
            <div className="min-w-0">
              <p className="font-display text-xl leading-tight font-semibold">{marina.legalName || marina.name}</p>
              <p className="mt-1 text-xs break-words text-muted">{[marinaAddress(marina), marina.email].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <div className="shrink-0 sm:text-right print:text-right">
            <p className="text-xs tracking-widest text-muted uppercase">Informativa privacy</p>
            <p className="font-display text-lg font-semibold">versione {marina.privacyPolicyVersion}</p>
          </div>
        </header>

        {text ? (
          <NoticeText text={text} />
        ) : (
          <p className="text-bad">Il testo dell&apos;informativa non è stato ancora inserito: aggiungilo in Impostazioni → Porto.</p>
        )}

        <section className="mt-8 break-inside-avoid border-t border-line pt-5">
          <p>
            Il/La sottoscritto/a <strong>{owner.displayName}</strong>
            {owner.fiscalCode ? `, codice fiscale ${owner.fiscalCode}` : ""}, dichiara di aver ricevuto e letto l&apos;informativa sul trattamento dei dati personali.
          </p>
          <Choice label="Invio di comunicazioni commerciali e promozionali:" />
          <Choice label="Comunicazione dei dati a cantieri e fornitori di assistenza da me indicati:" />
          <div className="mt-10 grid grid-cols-1 gap-10 sm:grid-cols-2 print:grid-cols-2">
            <p>Data: {formatDate(todayRome())}</p>
            <p className="border-t border-ink pt-1 text-center text-xs">Firma dell&apos;interessato</p>
          </div>
        </section>
      </article>
    </>
  );
});
