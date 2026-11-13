import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { page } from "@/components/page";
import { PrintButton } from "@/components/print-button";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { marinas, owners } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { formatDate, todayRome } from "@/lib/dates";
import { uuidOrNull } from "@/lib/params";
import { fillTemplate } from "@/lib/templates";

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

      <article className="card mx-auto max-w-3xl p-8 text-[13.5px] leading-relaxed print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <header className="mb-5 flex items-baseline justify-between border-b border-line pb-3">
          <p className="font-display text-xl font-semibold">{marina.legalName || marina.name}</p>
          <p className="text-xs text-muted">Informativa v. {marina.privacyPolicyVersion}</p>
        </header>

        {text ? (
          <div className="whitespace-pre-line">{text}</div>
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
          <div className="mt-10 grid grid-cols-2 gap-10">
            <p>Data: {formatDate(todayRome())}</p>
            <p className="border-t border-ink pt-1 text-center text-xs">Firma dell&apos;interessato</p>
          </div>
        </section>
      </article>
    </>
  );
});
