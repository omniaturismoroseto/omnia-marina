import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { Download, Pencil, Plus, Printer } from "lucide-react";
import { page } from "@/components/page";
import { ChargeStatusBadge, ContractStatusBadge } from "@/components/status";
import { Badge, ButtonLink, Card, Details, EmptyState, Notice, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { berths, boats, contracts, owners, privacyConsents, users } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { formatDate, formatDateTime, todayRome } from "@/lib/dates";
import { formatDimensions, formatMoney } from "@/lib/format";
import { BOAT_TYPE_LABEL, CONSENT_LABEL, CONSENT_METHOD_LABEL, CONSENT_SHORT, CONTRACT_TYPE_LABEL } from "@/lib/labels";
import { uuidOrNull } from "@/lib/params";
import { contractNumberLabel } from "@/lib/contract-numbers";
import { listCharges } from "@/server/charges";
import { latestConsents, type ConsentKind } from "@/server/owners";
import { ConsentForm, EraseOwnerButton } from "./privacy-forms";

export const metadata: Metadata = { title: "Scheda cliente" };

const KINDS: ConsentKind[] = ["informativa", "marketing", "terzi"];

export default page(async function OwnerPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMarina(OFFICE);
  const id = uuidOrNull((await params).id);
  if (!id) notFound();
  const [owner] = await db
    .select()
    .from(owners)
    .where(and(eq(owners.id, id), eq(owners.marinaId, ctx.marinaId)))
    .limit(1);
  if (!owner) notFound();

  const today = todayRome();
  const [boatRows, contractRows, chargeRows, consentMap, history] = await Promise.all([
    db.select().from(boats).where(eq(boats.ownerId, id)).orderBy(asc(boats.name)),
    db
      .select({
        id: contracts.id,
        number: contracts.number,
        type: contracts.type,
        status: contracts.status,
        startDate: contracts.startDate,
        endDate: contracts.endDate,
        amountCents: contracts.amountCents,
        boatName: boats.name,
        berthCode: berths.code,
      })
      .from(contracts)
      .innerJoin(boats, eq(boats.id, contracts.boatId))
      .leftJoin(berths, eq(berths.id, contracts.berthId))
      .where(eq(contracts.ownerId, id))
      .orderBy(desc(contracts.startDate)),
    listCharges(ctx.marinaId, today, { ownerId: id, newestFirst: true }),
    latestConsents(ctx.marinaId, id),
    db
      .select({
        id: privacyConsents.id,
        kind: privacyConsents.kind,
        granted: privacyConsents.granted,
        policyVersion: privacyConsents.policyVersion,
        method: privacyConsents.method,
        note: privacyConsents.note,
        recordedAt: privacyConsents.recordedAt,
        userName: users.name,
      })
      .from(privacyConsents)
      .leftJoin(users, eq(users.id, privacyConsents.recordedBy))
      .where(eq(privacyConsents.ownerId, id))
      .orderBy(desc(privacyConsents.recordedAt)),
  ]);

  const consents = consentMap.get(id) ?? { informativa: null, marketing: null, terzi: null };
  const anonymized = owner.anonymizedAt !== null;
  const live = chargeRows.filter((c) => c.status !== "annullato");
  const billed = live.reduce((s, c) => s + c.grossCents, 0);
  const paid = live.reduce((s, c) => s + c.paidCents, 0);
  const hasHistory = boatRows.length + contractRows.length + chargeRows.length > 0;
  const address = [owner.address, [owner.zip, owner.city].filter(Boolean).join(" "), owner.province ? `(${owner.province})` : null].filter(Boolean).join(", ");

  return (
    <>
      <PageHeader
        title={owner.displayName}
        back={{ href: "/clienti", label: "Clienti" }}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge>{owner.type === "azienda" ? "Azienda" : "Persona fisica"}</Badge>
            {!anonymized && (consents.informativa?.granted ? <Badge tone="ok">Informativa firmata</Badge> : <Badge tone="warn">Informativa mancante</Badge>)}
          </span>
        }
        actions={
          !anonymized && (
            <>
              <ButtonLink href={`/clienti/${id}/modifica`}>
                <Pencil size={16} aria-hidden="true" />
                Modifica
              </ButtonLink>
              <ButtonLink href={`/contratti/nuovo?cliente=${id}`} variant="primary">
                <Plus size={16} aria-hidden="true" />
                Nuovo contratto
              </ButtonLink>
            </>
          )
        }
      />

      {anonymized && (
        <div className="mb-5">
          <Notice tone="sea">
            I dati personali di questo cliente sono stati cancellati il {formatDateTime(owner.anonymizedAt)}. Restano solo contratti e movimenti contabili, da conservare per legge.
          </Notice>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          {!anonymized && (
            <Card title="Anagrafica">
              <Details
                columns={3}
                items={[
                  ["Codice fiscale", owner.fiscalCode],
                  ["Partita IVA", owner.vatNumber],
                  ["Nato il", owner.birthDate ? `${formatDate(owner.birthDate)}${owner.birthPlace ? ` a ${owner.birthPlace}` : ""}` : null],
                  ["Telefono", owner.phone && <a href={`tel:${owner.phone.replace(/\s/g, "")}`} className="link">{owner.phone}</a>],
                  ["Email", owner.email && <a href={`mailto:${owner.email}`} className="link">{owner.email}</a>],
                  ["PEC", owner.pec],
                  ["Indirizzo", address ? `${address}${owner.country && owner.country !== "Italia" ? ` · ${owner.country}` : ""}` : null],
                  ["Codice destinatario", owner.sdiCode],
                  ["Documento", owner.idDocType ? `${owner.idDocType} ${owner.idDocNumber ?? ""}${owner.idDocExpiry ? ` · scade il ${formatDate(owner.idDocExpiry)}` : ""}` : null],
                  ["Note", owner.notes],
                ]}
              />
            </Card>
          )}

          <Card
            title={`Barche (${boatRows.length})`}
            flush
            actions={
              !anonymized && (
                <ButtonLink href={`/barche/nuova?cliente=${id}`} size="sm">
                  <Plus size={14} aria-hidden="true" />
                  Aggiungi barca
                </ButtonLink>
              )
            }
          >
            {boatRows.length === 0 ? (
              <EmptyState title="Nessuna barca registrata" description="Aggiungi la barca del cliente per poterle assegnare un posto." />
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Tipo</th>
                    <th>Dimensioni</th>
                    <th>Assicurazione</th>
                  </tr>
                </thead>
                <tbody>
                  {boatRows.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <Link href={`/barche/${b.id}`} className="link">
                          {b.name}
                        </Link>
                        {b.registration && <span className="block text-xs text-muted">{b.registration}</span>}
                      </td>
                      <td>
                        {BOAT_TYPE_LABEL[b.type]}
                        <span className="block text-xs text-muted">{[b.builder, b.model].filter(Boolean).join(" ")}</span>
                      </td>
                      <td className="whitespace-nowrap">{formatDimensions(b.lengthCm, b.beamCm)}</td>
                      <td>
                        {!b.insuranceExpiry ? (
                          <span className="text-faint">—</span>
                        ) : b.insuranceExpiry < today ? (
                          <Badge tone="bad">Scaduta il {formatDate(b.insuranceExpiry)}</Badge>
                        ) : (
                          <span className="text-muted">fino al {formatDate(b.insuranceExpiry)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title={`Contratti (${contractRows.length})`} flush>
            {contractRows.length === 0 ? (
              <EmptyState title="Nessun contratto" />
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Numero</th>
                    <th>Barca e posto</th>
                    <th>Periodo</th>
                    <th>Stato</th>
                    <th className="num">Importo</th>
                  </tr>
                </thead>
                <tbody>
                  {contractRows.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/contratti/${c.id}`} className="link">
                          {contractNumberLabel(c.number)}
                        </Link>
                        <span className="block text-xs text-muted">
                          {CONTRACT_TYPE_LABEL[c.type]} ·{" "}
                          <Link href={`/contratti/${c.id}/stampa`} className="link">
                            stampa
                          </Link>
                        </span>
                      </td>
                      <td>
                        {c.boatName}
                        <span className="block text-xs text-muted">{c.berthCode ? `Posto ${c.berthCode}` : "Posto da assegnare"}</span>
                      </td>
                      <td className="whitespace-nowrap tabular-nums">
                        {formatDate(c.startDate)} – {formatDate(c.endDate)}
                      </td>
                      <td>
                        <ContractStatusBadge status={c.status} />
                      </td>
                      <td className="num">{formatMoney(c.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card
            title="Estratto conto"
            flush
            actions={
              !anonymized && (
                <ButtonLink href={`/contabilita/addebiti/nuovo?cliente=${id}`} size="sm">
                  <Plus size={14} aria-hidden="true" />
                  Nuovo addebito
                </ButtonLink>
              )
            }
          >
            {chargeRows.length === 0 ? (
              <EmptyState title="Nessun addebito" />
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Scadenza</th>
                    <th>Descrizione</th>
                    <th>Stato</th>
                    <th className="num">Importo</th>
                    <th className="num">Incassato</th>
                  </tr>
                </thead>
                <tbody>
                  {chargeRows.map((c) => (
                    <tr key={c.id}>
                      <td className="whitespace-nowrap tabular-nums">{formatDate(c.dueDate)}</td>
                      <td>
                        <Link href={`/contabilita/addebiti/${c.id}`} className="link">
                          {c.description}
                        </Link>
                      </td>
                      <td>
                        <ChargeStatusBadge status={c.status} />
                      </td>
                      <td className="num">{formatMoney(c.grossCents)}</td>
                      <td className="num text-muted">{formatMoney(c.paidCents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="px-3 py-2.5 text-right text-sm font-medium">
                      Totale · da incassare <strong className={billed - paid > 0 ? "text-bad" : "text-ok"}>{formatMoney(billed - paid)}</strong>
                    </td>
                    <td className="num px-3 py-2.5 font-semibold">{formatMoney(billed)}</td>
                    <td className="num px-3 py-2.5 font-semibold">{formatMoney(paid)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Privacy e consensi">
            {anonymized ? (
              <p className="text-sm text-muted">Dati personali cancellati.</p>
            ) : (
              <>
                <ul className="space-y-4">
                  {KINDS.map((kind) => {
                    const c = consents[kind];
                    return (
                      <li key={kind}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-ink">{CONSENT_LABEL[kind]}</p>
                          {c === null ? <Badge tone={kind === "informativa" ? "warn" : "neutral"}>Non registrato</Badge> : c.granted ? <Badge tone="ok">Sì</Badge> : <Badge tone="bad">No</Badge>}
                        </div>
                        {c && (
                          <p className="mt-0.5 text-xs text-muted">
                            {formatDateTime(c.recordedAt)} · informativa v. {c.policyVersion}
                          </p>
                        )}
                        <details>
                          <summary className="link mt-1 cursor-pointer text-xs">Aggiorna</summary>
                          <ConsentForm ownerId={id} kind={kind} currentlyGranted={c?.granted ?? false} />
                        </details>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-line-soft pt-4">
                  <ButtonLink href={`/clienti/${id}/informativa`} size="sm">
                    <Printer size={14} aria-hidden="true" />
                    Stampa informativa
                  </ButtonLink>
                  <a href={`/clienti/${id}/esporta`} className="btn btn-secondary btn-sm" download>
                    <Download size={14} aria-hidden="true" />
                    Esporta i dati
                  </a>
                </div>
                <p className="hint">L&apos;esportazione contiene tutti i dati del cliente: serve per rispondere a una richiesta di accesso o portabilità.</p>
              </>
            )}

            {history.length > 0 && (
              <details className="mt-4 border-t border-line-soft pt-3">
                <summary className="cursor-pointer text-sm font-medium text-ink">Registro dei consensi ({history.length})</summary>
                <ul className="mt-2 space-y-2 text-xs text-muted">
                  {history.map((h) => (
                    <li key={h.id}>
                      <span className="font-medium text-ink">
                        {CONSENT_SHORT[h.kind]}: {h.granted ? "sì" : "no"}
                      </span>{" "}
                      · {formatDateTime(h.recordedAt)} · v. {h.policyVersion} · {CONSENT_METHOD_LABEL[h.method]}
                      {h.userName ? ` · ${h.userName}` : ""}
                      {h.note ? ` · ${h.note}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>

          {ctx.role === "admin" && !anonymized && (
            <Card title="Cancellazione dei dati">
              <p className="mb-3 text-sm text-muted">
                {hasHistory
                  ? "Su richiesta del cliente puoi cancellare i suoi dati personali. Contratti e contabilità restano, ma non saranno più riconducibili a lui."
                  : "Il cliente non ha barche, contratti né addebiti: può essere eliminato."}
              </p>
              <EraseOwnerButton ownerId={id} hasHistory={hasHistory} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
});
