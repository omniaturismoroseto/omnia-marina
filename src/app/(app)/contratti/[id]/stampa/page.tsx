import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { page } from "@/components/page";
import { PrintButton } from "@/components/print-button";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { berths, boats, contracts, marinas, owners } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { formatDate, todayRome } from "@/lib/dates";
import { formatDimensions, formatMoney, splitVat } from "@/lib/format";
import { BOAT_TYPE_LABEL, CONTRACT_TYPE_LABEL } from "@/lib/labels";
import { uuidOrNull } from "@/lib/params";
import { marinaAddress } from "@/lib/templates";
import { listCharges } from "@/server/charges";

export const metadata: Metadata = { title: "Stampa contratto" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th className="w-44 py-1 pr-3 text-left align-top font-normal text-muted">{label}</th>
      <td className="py-1">{children}</td>
    </tr>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 break-inside-avoid">
      <h2 className="mb-1.5 border-b border-line pb-1 text-xs font-semibold tracking-widest text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

export default page(async function ContractPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMarina(OFFICE);
  const id = uuidOrNull((await params).id);
  if (!id) notFound();

  const [row] = await db
    .select({ contract: contracts, owner: owners, boat: boats, berth: berths })
    .from(contracts)
    .innerJoin(owners, eq(owners.id, contracts.ownerId))
    .innerJoin(boats, eq(boats.id, contracts.boatId))
    .leftJoin(berths, eq(berths.id, contracts.berthId))
    .where(and(eq(contracts.id, id), eq(contracts.marinaId, ctx.marinaId)))
    .limit(1);
  if (!row) notFound();
  const { contract: c, owner, boat, berth } = row;

  const [[marina], chargeRows] = await Promise.all([
    db.select().from(marinas).where(eq(marinas.id, ctx.marinaId)),
    listCharges(ctx.marinaId, todayRome(), { contractId: id }),
  ]);
  const instalments = chargeRows.filter((ch) => ch.status !== "annullato");
  const { netCents, vatCents } = splitVat(c.amountCents, c.vatRate);
  const ownerAddress = [owner.address, [owner.zip, owner.city].filter(Boolean).join(" "), owner.province ? `(${owner.province})` : null].filter(Boolean).join(", ");

  return (
    <>
      <div className="no-print">
        <PageHeader title={`Contratto ${c.number}`} description="Anteprima di stampa." back={{ href: `/contratti/${id}`, label: "Scheda contratto" }} actions={<PrintButton />} />
      </div>

      <article className="card mx-auto max-w-3xl p-8 text-[13.5px] leading-relaxed print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-2 border-ink pb-4">
          <div>
            <p className="font-display text-2xl leading-tight font-semibold">{marina.legalName || marina.name}</p>
            <p className="mt-1 text-xs text-muted">
              {[marinaAddress(marina), marina.vatNumber ? `P. IVA ${marina.vatNumber}` : null, marina.phone, marina.email].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs tracking-widest text-muted uppercase">Contratto di ormeggio</p>
            <p className="font-display text-2xl font-semibold tabular-nums">{c.number}</p>
            {c.status === "bozza" && <p className="text-xs font-semibold text-bad uppercase">Bozza</p>}
          </div>
        </header>

        <Section title="Utente">
          <table className="w-full">
            <tbody>
              <Row label={owner.type === "azienda" ? "Ragione sociale" : "Cognome e nome"}>
                <strong>{owner.displayName}</strong>
              </Row>
              {owner.fiscalCode && <Row label="Codice fiscale">{owner.fiscalCode}</Row>}
              {owner.vatNumber && <Row label="Partita IVA">{owner.vatNumber}</Row>}
              {ownerAddress && <Row label="Residenza / sede">{ownerAddress}</Row>}
              {(owner.phone || owner.email) && <Row label="Contatti">{[owner.phone, owner.email].filter(Boolean).join(" · ")}</Row>}
              {owner.idDocType && (
                <Row label="Documento">
                  {owner.idDocType} {owner.idDocNumber}
                </Row>
              )}
            </tbody>
          </table>
        </Section>

        <Section title="Unità da diporto">
          <table className="w-full">
            <tbody>
              <Row label="Nome">
                <strong>{boat.name}</strong>
                {boat.registration ? ` · matricola ${boat.registration}` : ""}
              </Row>
              <Row label="Tipo">{[BOAT_TYPE_LABEL[boat.type], boat.builder, boat.model].filter(Boolean).join(" · ")}</Row>
              <Row label="Lunghezza × larghezza">{formatDimensions(boat.lengthCm, boat.beamCm)}</Row>
              {boat.insuranceCompany && (
                <Row label="Assicurazione">
                  {boat.insuranceCompany}
                  {boat.insurancePolicy ? `, polizza ${boat.insurancePolicy}` : ""}
                  {boat.insuranceExpiry ? `, scadenza ${formatDate(boat.insuranceExpiry)}` : ""}
                </Row>
              )}
            </tbody>
          </table>
        </Section>

        <Section title="Posto barca e periodo">
          <table className="w-full">
            <tbody>
              <Row label="Tipo di contratto">{CONTRACT_TYPE_LABEL[c.type]}</Row>
              <Row label="Posto barca">
                {berth ? (
                  <>
                    <strong>{berth.code}</strong> · {formatDimensions(berth.lengthCm, berth.beamCm)}
                  </>
                ) : (
                  "da assegnare"
                )}
              </Row>
              <Row label="Periodo">
                dal <strong>{formatDate(c.startDate)}</strong> al <strong>{formatDate(c.endDate)}</strong>
              </Row>
            </tbody>
          </table>
        </Section>

        <Section title="Corrispettivo">
          <table className="w-full">
            <tbody>
              <Row label="Imponibile">{formatMoney(netCents)}</Row>
              <Row label={`IVA ${c.vatRate}%`}>{formatMoney(vatCents)}</Row>
              <Row label="Totale">
                <strong>{formatMoney(c.amountCents)}</strong>
              </Row>
            </tbody>
          </table>
          {instalments.length > 0 && (
            <table className="mt-2 w-full border-t border-line-soft">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 font-normal">Scadenze di pagamento</th>
                  <th className="py-1 text-right font-normal">Importo</th>
                </tr>
              </thead>
              <tbody>
                {instalments.map((ch) => (
                  <tr key={ch.id}>
                    <td className="py-0.5 tabular-nums">{formatDate(ch.dueDate)}</td>
                    <td className="py-0.5 text-right tabular-nums">{formatMoney(ch.grossCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {marina.contractTerms && (
          <Section title="Condizioni">
            <div className="text-[12.5px] leading-snug whitespace-pre-line">{marina.contractTerms}</div>
          </Section>
        )}

        <section className="mt-8 break-inside-avoid">
          <p>
            {marina.city ?? "Luogo"}, {formatDate(c.signedOn ?? todayRome())}
          </p>
          <div className="mt-12 grid grid-cols-2 gap-12 text-center text-xs">
            <p className="border-t border-ink pt-1">Per il Porto</p>
            <p className="border-t border-ink pt-1">L&apos;Utente</p>
          </div>
          <p className="mt-8 text-[12px] text-muted">
            L&apos;Utente dichiara di aver ricevuto l&apos;informativa sul trattamento dei dati personali (versione {marina.privacyPolicyVersion}) ai sensi del Regolamento (UE) 2016/679.
          </p>
          <div className="mt-8 ml-auto w-1/2 border-t border-ink pt-1 text-center text-xs">L&apos;Utente</div>
        </section>
      </article>
    </>
  );
});
