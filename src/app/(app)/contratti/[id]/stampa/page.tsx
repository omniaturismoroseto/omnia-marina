import { Fragment } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { DocumentTitle } from "@/components/document-title";
import { page } from "@/components/page";
import { PortLogo } from "@/components/port-logo";
import { PrintButton } from "@/components/print-button";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { berths, boats, contractItems, contracts, marinas, owners } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { SERVICE_ITEM_KIND, itemHasPeriod, itemTitle, sortItems } from "@/lib/contract-items";
import { formatDate, todayRome } from "@/lib/dates";
import { auxEngine, describeEngine, mainEngine } from "@/lib/engines";
import { formatDimensions, formatMoney } from "@/lib/format";
import { portLogo } from "@/lib/logo";
import { CONTRACT_ITEM_LABEL, CONTRACT_TYPE_LABEL } from "@/lib/labels";
import { uuidOrNull } from "@/lib/params";
import { marinaAddress } from "@/lib/templates";
import { listCharges } from "@/server/charges";

export const metadata: Metadata = { title: "Stampa contratto" };

/** Valore in evidenza, oppure una riga da compilare a mano se il dato manca. */
function V({ children, blank = "____________" }: { children?: React.ReactNode; blank?: string }) {
  const empty = children === null || children === undefined || children === "";
  return empty ? <span className="text-muted">{blank}</span> : <strong>{children}</strong>;
}

/** Testo libero delle condizioni: ogni riga che inizia con "N)" apre un articolo con il numero in grassetto. */
function Terms({ text }: { text: string }) {
  return (
    <>
      {text
        .replace(/\r\n/g, "\n")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line, i) => {
          const m = /^(\d+\))\s*(.*)$/.exec(line.trim());
          return (
            <p key={i} className={m ? "mt-2" : "mt-1"}>
              {m ? (
                <>
                  <strong>{m[1]}</strong> {m[2]}
                </>
              ) : (
                line
              )}
            </p>
          );
        })}
    </>
  );
}

function Signatures() {
  return (
    <div className="mt-10 grid grid-cols-2 gap-16 text-center text-xs">
      <p className="border-t border-ink pt-1">Il Conduttore</p>
      <p className="border-t border-ink pt-1">Il Locatore</p>
    </div>
  );
}

/** Una voce del riquadro riassuntivo in testa al contratto. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.8em] tracking-wider text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 font-semibold">{children}</dd>
    </div>
  );
}

const SPACE_PHRASE: Record<"secca" | "auto_coperto" | "auto_scoperto" | "carrello", (ref: string | null) => string> = {
  secca: () => "uno spazio all'aperto nelle aree portuali per la sosta a terra dell'unità da diporto",
  auto_coperto: (ref) => `uno spazio destinato a posto auto coperto${ref ? ` n. ${ref}` : ""} nelle aree portuali`,
  auto_scoperto: (ref) => `uno spazio destinato a posto auto scoperto${ref ? ` n. ${ref}` : ""} nelle aree portuali`,
  carrello: () => "uno spazio all'aperto nelle aree portuali per la sosta del carrello e/o invasatura",
};

const TITLE_PART: Record<"secca" | "auto_coperto" | "auto_scoperto" | "carrello", string> = {
  secca: "sosta a terra",
  auto_coperto: "posto auto coperto",
  auto_scoperto: "posto auto scoperto",
  carrello: "sosta carrelli/invasi",
};

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

  const [[marina], itemRows, chargeRows] = await Promise.all([
    db.select().from(marinas).where(eq(marinas.id, ctx.marinaId)),
    db.select().from(contractItems).where(and(eq(contractItems.contractId, id), eq(contractItems.marinaId, ctx.marinaId))),
    listCharges(ctx.marinaId, todayRome(), { contractId: id }),
  ]);

  const items = sortItems(itemRows);
  const spaces = items.filter((it) => itemHasPeriod(it.kind)) as (typeof items[number] & { kind: keyof typeof SPACE_PHRASE })[];
  const gestione = items.find((it) => it.kind === "gestione");
  const rifiuti = items.find((it) => it.kind === "rifiuti");
  // Cauzioni e altri servizi presi dal listino: importo e aliquota propri.
  const services = items.filter((it) => it.kind === SERVICE_ITEM_KIND);
  const rentCents = c.amountCents + spaces.reduce((s, it) => s + it.amountCents, 0);
  const extrasCents = [gestione, rifiuti, ...services].reduce((s, it) => s + (it?.amountCents ?? 0), 0);

  // Scadenze di tutto il contratto (canone, spazi e spese), sommate per data.
  const dueByDate = new Map<string, number>();
  for (const ch of chargeRows) if (ch.status !== "annullato") dueByDate.set(ch.dueDate, (dueByDate.get(ch.dueDate) ?? 0) + ch.grossCents);
  const schedule = [...dueByDate.entries()].sort(([a], [b]) => a.localeCompare(b));

  const isCompany = owner.type === "azienda";
  const residence = [owner.city, owner.province ? `(${owner.province})` : null, owner.zip ? `CAP ${owner.zip}` : null].filter(Boolean).join(" ");
  const engine = [describeEngine(mainEngine(boat)), boat.engine].filter(Boolean).join(", ");
  const aux = describeEngine(auxEngine(boat));
  const titleExtras = [...new Set(spaces.map((it) => TITLE_PART[it.kind]))];
  const lessor = marina.legalName || marina.name;
  const logo = portLogo(marina);
  const place = marina.city || "________________";

  return (
    <>
      <DocumentTitle title={c.number ? `Contratto ${c.number.replace("/", "-")} - ${owner.displayName}` : `Bozza contratto - ${owner.displayName}`} />
      <div className="no-print">
        <PageHeader
          title={c.number ? `Contratto ${c.number}` : "Contratto in bozza"}
          description="Anteprima di stampa. Per averne un file, stampa e scegli «Salva come PDF»: il nome riporta numero e cliente."
          back={{ href: `/contratti/${id}`, label: "Scheda contratto" }}
          actions={<PrintButton />}
        />
      </div>

      {/* Sul telefono il testo va a sinistra (giustificato apre buchi tra le parole); su carta e schermi larghi è giustificato. */}
      <article className="card mx-auto max-w-3xl p-5 text-[13px] leading-snug sm:p-8 sm:text-[12.5px] sm:text-justify print:max-w-none print:border-0 print:p-0 print:text-[11.5px] print:text-justify print:shadow-none">
        <header className="flex flex-col gap-3 border-b-2 border-ink pb-3 text-left sm:flex-row sm:items-start sm:justify-between sm:gap-6 print:flex-row print:items-start print:justify-between print:gap-6">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4 print:flex-row print:items-center print:gap-4">
            {logo && <PortLogo logo={logo} alt="" className="h-14 w-auto max-w-[10rem] shrink-0 sm:h-16 print:h-14" />}
            <div className="min-w-0">
              <p className="font-display text-xl leading-tight font-semibold">{lessor}</p>
              <p className="mt-1 text-xs break-words text-muted">
                {[marinaAddress(marina), marina.vatNumber ? `P. IVA ${marina.vatNumber}` : null, marina.phone, marina.email].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
          <div className="shrink-0 sm:text-right print:text-right">
            <p className="text-xs tracking-widest text-muted uppercase">Contratto n.</p>
            {/* Le bozze non hanno numero: al suo posto si stampa BOZZA. */}
            {c.number ? (
              <p className="font-display text-xl font-semibold tabular-nums">{c.number}</p>
            ) : (
              <p className="font-display text-xl font-semibold tracking-wider text-bad">BOZZA</p>
            )}
          </div>
        </header>

        <h1 className="mt-4 text-center text-[14px] font-bold uppercase print:text-[13px]">
          Contratto di locazione di un tratto di banchina e di specchio acqueo antistante
          {titleExtras.length > 0 && <> – di area all&apos;aperto per {titleExtras.join(", ")}</>}
        </h1>

        {/* Riepilogo: i dati che il cliente cerca per primi, ripresi dagli articoli 1-3 che restano il testo che vale. */}
        <section className="mt-4 break-inside-avoid rounded-md border border-ink/40 px-4 py-3 text-left">
          <p className="text-[0.85em] font-bold tracking-wider uppercase">In sintesi</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4 print:grid-cols-4">
            <Fact label="Posto barca">{berth?.code ?? "—"}</Fact>
            <Fact label="Unità">
              {boat.name}
              <span className="block font-normal">{formatDimensions(boat.lengthCm, boat.beamCm)}</span>
            </Fact>
            <Fact label={`Periodo ${CONTRACT_TYPE_LABEL[c.type].toLowerCase()}`}>
              <span className="whitespace-nowrap">dal {formatDate(c.startDate)}</span> <span className="whitespace-nowrap">al {formatDate(c.endDate)}</span>
            </Fact>
            <Fact label="Assicurazione RC">{boat.insuranceExpiry ? `scade il ${formatDate(boat.insuranceExpiry)}` : "—"}</Fact>
            <Fact label="Canone (IVA incl.)">
              <span className="tabular-nums">{formatMoney(rentCents)}</span>
            </Fact>
            <Fact label="Spese e servizi">
              <span className="tabular-nums">{extrasCents > 0 ? formatMoney(extrasCents) : "nessuna"}</span>
            </Fact>
            <Fact label="Totale">
              <span className="tabular-nums">{formatMoney(rentCents + extrasCents)}</span>
            </Fact>
            <Fact label={schedule.length > 1 ? "Rate" : "Pagamento"}>
              {schedule.length > 1 ? `${schedule.length}, la prima il ${formatDate(schedule[0][0])}` : "alla firma"}
            </Fact>
          </dl>
        </section>

        <p className="mt-4">Con la presente scrittura privata, redatta in duplice copia,</p>
        <p className="mt-1.5">
          la Società <strong>{lessor}</strong>
          {marina.address || marina.city ? (
            <>
              {" "}
              con sede in {marina.city} alla {marina.address}
            </>
          ) : null}
          {marina.vatNumber ? <>, P. IVA {marina.vatNumber}</> : null}, in persona del suo legale rappresentante pro tempore, domiciliato per la carica presso la sede
          della predetta Società, che gestisce, in regime di concessione demaniale marittima, il porto turistico &ldquo;{marina.name}&rdquo;, di seguito denominata{" "}
          <em>Locatore</em>,
        </p>
        <p className="my-2 text-center font-bold">cede in locazione</p>

        {isCompany ? (
          <p>
            alla società <V>{owner.displayName}</V>, P. IVA <V>{owner.vatNumber}</V>
            {owner.fiscalCode && owner.fiscalCode !== owner.vatNumber ? <>, codice fiscale {owner.fiscalCode}</> : null}, con sede in <V>{residence}</V> alla{" "}
            <V>{owner.address}</V>, telefono <V>{owner.phone}</V>, e-mail <V>{owner.email}</V>
            {owner.pec ? <>, PEC {owner.pec}</> : null}, in persona del legale rappresentante pro tempore, di seguito denominata <em>Conduttore</em>,
          </p>
        ) : (
          <p>
            al sig. / alla sig.ra <V>{owner.displayName}</V>, nato/a a <V>{owner.birthPlace}</V> il <V>{owner.birthDate ? formatDate(owner.birthDate) : null}</V>,
            residente in <V>{residence}</V> alla <V>{owner.address}</V>, codice fiscale <V>{owner.fiscalCode}</V>
            {owner.vatNumber ? <>, P. IVA {owner.vatNumber}</> : null}, telefono <V>{owner.phone}</V>, e-mail <V>{owner.email}</V>
            {owner.idDocType ? (
              <>
                , documento {owner.idDocType} n. {owner.idDocNumber}
              </>
            ) : null}
            , di seguito denominato/a <em>Conduttore</em>,
          </p>
        )}

        <p className="mt-2">
          proprietario della seguente unità da diporto: nome <V>{boat.name}</V>
          {boat.registration ? <>, matricola {boat.registration}</> : null}, cantiere <V>{boat.builder}</V>, modello <V>{boat.model}</V>, valore dichiarato{" "}
          <V>{boat.declaredValueCents !== null ? formatMoney(boat.declaredValueCents) : null}</V>, lunghezza fuori tutta <V>{boat.lengthCm} cm</V>, larghezza fuori
          tutta <V>{boat.beamCm} cm</V>, pescaggio massimo <V>{boat.draftCm ? `${boat.draftCm} cm` : null}</V>, motorizzazione <V>{engine}</V>
          {aux ? <>, motorizzazione ausiliaria {aux}</> : null}, assicurata per la responsabilità civile verso terzi con la Compagnia <V>{boat.insuranceCompany}</V>,
          polizza n. <V>{boat.insurancePolicy}</V>
          {boat.insuranceExpiry ? <>, con scadenza il {formatDate(boat.insuranceExpiry)}</> : null}.
        </p>

        <section className="mt-3">
          <p>
            <strong>1)</strong> Il Locatore cede in locazione al Conduttore, alle condizioni in seguito elencate e con l&apos;esclusione di ogni obbligo di custodia
            e/o di presa in consegna dell&apos;unità da diporto e dei beni del Conduttore:
          </p>
          <ul className="mt-1 list-none space-y-0.5 pl-3">
            <li>
              – la porzione di banchina e specchio acqueo antistante individuata al numero <V>{berth?.code}</V>
              {c.type === "annuale" && <> e uno spazio all&apos;aperto nelle aree portuali per la sosta a secco della propria unità da diporto</>}, con inizio il{" "}
              <strong>{formatDate(c.startDate)}</strong> e termine il <strong>{formatDate(c.endDate)}</strong>;
            </li>
            {spaces.map((it) => (
              <li key={it.id}>
                – {SPACE_PHRASE[it.kind](it.reference)}, {it.annual ? "per la durata di un anno, " : ""}con inizio il <strong>{formatDate(it.startDate)}</strong> e
                termine il <strong>{formatDate(it.endDate)}</strong>;
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-1.5">
          <p>
            <strong>2)</strong> Il canone di locazione è da pagarsi anticipatamente{" "}
            {schedule.length > 1 ? "alle scadenze di seguito indicate" : "e contestualmente alla stipula del presente contratto"}. L&apos;entità del canone è
            strettamente determinata in relazione alla natura stessa del contratto di locazione, che si riferisce alla mera utilizzazione di spazi e dalla quale sono
            esclusi la supervisione, la sorveglianza, la custodia e la manutenzione in efficienza dei beni del conduttore. Quanto alla locazione del tratto di banchina
            e specchio acqueo antistante e/o degli spazi all&apos;aperto della struttura portuale, il canone è stabilito in relazione all&apos;effettivo spazio occupato,
            alla larghezza e lunghezza dell&apos;unità sopra descritta, comprensiva di aggetti, plancette, pulpiti, scalette, battagliole ecc. Il canone, comprensivo di
            IVA ({c.vatRate}%), è convenuto in:
          </p>
          <table className="mt-1 ml-3 w-[calc(100%-0.75rem)]">
            <tbody>
              <tr>
                <td className="py-0.5 pr-3">
                  locazione del tratto di banchina e specchio acqueo antistante{c.type === "annuale" ? " e dello spazio per la sosta a secco" : ""}
                  {berth ? ` (posto ${berth.code})` : ""}
                </td>
                <td className="py-0.5 text-right whitespace-nowrap tabular-nums">{formatMoney(c.amountCents)}</td>
              </tr>
              {spaces.map((it) => (
                <tr key={it.id}>
                  <td className="py-0.5 pr-3">
                    locazione {it.annual ? "annuale " : ""}
                    {it.kind === "auto_coperto" || it.kind === "auto_scoperto" ? "del" : "dello"} {CONTRACT_ITEM_LABEL[it.kind].toLowerCase()}
                    {it.reference ? ` n. ${it.reference}` : ""}
                  </td>
                  <td className="py-0.5 text-right whitespace-nowrap tabular-nums">{formatMoney(it.amountCents)}</td>
                </tr>
              ))}
              {spaces.length > 0 && (
                <tr className="border-t border-line">
                  <td className="py-0.5 pr-3 font-semibold">totale canone di locazione</td>
                  <td className="py-0.5 text-right font-semibold whitespace-nowrap tabular-nums">{formatMoney(rentCents)}</td>
                </tr>
              )}
            </tbody>
          </table>
          {schedule.length > 1 && (
            <p className="mt-1 ml-3">
              Scadenze di pagamento (canone e spese):{" "}
              {schedule.map(([date, cents], i) => (
                <span key={date} className="whitespace-nowrap tabular-nums">
                  {i > 0 && "; "}
                  {formatDate(date)} {formatMoney(cents)}
                </span>
              ))}
              .
            </p>
          )}
        </section>

        <section className="mt-1.5">
          <p>
            <strong>3)</strong>{" "}
            {gestione || rifiuti ? (
              <>
                Il conduttore, contestualmente alla stipula del presente contratto, unitamente al pagamento del canone di locazione, si impegna altresì
                {gestione && (
                  <>
                    {" "}
                    al pagamento delle spese di gestione comuni relative al periodo di locazione pari a <strong>{formatMoney(gestione.amountCents)}</strong>
                  </>
                )}
                {gestione && rifiuti && " e"}
                {rifiuti && (
                  <>
                    {" "}
                    al rimborso della quota rifiuti pari a <strong>{formatMoney(rifiuti.amountCents)}</strong>
                  </>
                )}
                .{" "}
              </>
            ) : (
              <>Per il periodo di locazione non sono previste spese di gestione comuni né quota rifiuti. </>
            )}
            {services.length > 0 && (
              <>
                Sono inoltre dovuti i seguenti importi:{" "}
                {services.map((it, i) => (
                  <Fragment key={it.id}>
                    {i > 0 && (i === services.length - 1 ? " e " : "; ")}
                    {itemTitle(it)} <strong>{formatMoney(it.amountCents)}</strong>
                    {it.vatRate === 0 ? " (senza IVA)" : ""}
                  </Fragment>
                ))}
                .{" "}
              </>
            )}
            Il conduttore non può rinunciare ai servizi comuni né a quelli previsti dal Regolamento di porto, né può omettere o ritardare il loro pagamento a cagione
            del mancato utilizzo.
          </p>
        </section>

        {marina.contractTerms && (
          <section>
            <Terms text={marina.contractTerms} />
          </section>
        )}

        <section className="mt-6 break-inside-avoid">
          <p>
            {place}, lì {c.signedOn ? formatDate(c.signedOn) : "____/____/________"}
          </p>
          <Signatures />
        </section>

        {marina.contractApprovalText && (
          <section className="mt-6 break-inside-avoid">
            <p>{marina.contractApprovalText}</p>
            <Signatures />
          </section>
        )}
      </article>
    </>
  );
});
