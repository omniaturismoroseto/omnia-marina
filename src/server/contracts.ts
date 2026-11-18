import "server-only";
import { and, eq, gt, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { berths, boats, charges, contractItems, contracts, movements, owners, payments, type ContractType } from "@/db/schema";
import { SERVICE_ITEM_KIND, SERVICE_VAT_RATES, itemHasPeriod, itemTitle, type ContractItemInput } from "@/lib/contract-items";
import { firstFreeSeq, formatContractNumber, seqGaps } from "@/lib/contract-numbers";
import { annualEnd, formatDate, todayRome, yearOf } from "@/lib/dates";
import { splitVat } from "@/lib/format";
import { CONTRACT_TYPE_LABEL } from "@/lib/labels";
import { occupiedUntil, splitInstalments } from "@/lib/pricing";
import { DomainError } from "./errors";
import { unarchiveBoat } from "./boats";

export interface Actor {
  marinaId: string;
  userId: string | null;
}

export interface InstalmentPlan {
  count: number;
  firstDueDate: string;
  everyMonths: number;
}

// Numero di un contratto che diventa definitivo: il più basso libero dell'anno. Un numero lasciato libero da un
// contratto tornato in bozza viene così ripreso dal primo contratto attivato (fillsGap).
async function assignContractNumber(tx: Tx, marinaId: string, year: number) {
  // Un solo numeratore alla volta per porto e anno, così non nascono due contratti con lo stesso numero.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`contratti:${marinaId}:${year}`}))`);
  const rows = await tx
    .select({ seq: contracts.seq })
    .from(contracts)
    .where(and(eq(contracts.marinaId, marinaId), eq(contracts.year, year), isNotNull(contracts.seq)));
  const { seq, fillsGap } = firstFreeSeq(rows.map((r) => r.seq!));
  return { seq, number: formatContractNumber(year, seq), fillsGap };
}

/** Numeri di contratto rimasti liberi, anno per anno: vanno sempre segnalati finché un contratto attivato non li riprende. */
export async function contractNumberGaps(marinaId: string, tx: Tx | typeof db = db): Promise<string[]> {
  const rows = await tx
    .select({ year: contracts.year, seq: contracts.seq })
    .from(contracts)
    .where(and(eq(contracts.marinaId, marinaId), isNotNull(contracts.seq)));
  const byYear = new Map<number, number[]>();
  for (const r of rows) byYear.set(r.year, [...(byYear.get(r.year) ?? []), r.seq!]);
  return [...byYear.entries()].sort(([a], [b]) => a - b).flatMap(([year, seqs]) => seqGaps(seqs).map((seq) => formatContractNumber(year, seq)));
}

// Contratto attivo o concluso che occupa già il posto nel periodo indicato.
export async function findBerthConflict(tx: Tx, marinaId: string, berthId: string, startDate: string, until: string, excludeId?: string) {
  const [row] = await tx
    .select({ number: contracts.number, startDate: contracts.startDate, endDate: contracts.endDate })
    .from(contracts)
    .where(
      and(
        eq(contracts.marinaId, marinaId),
        eq(contracts.berthId, berthId),
        inArray(contracts.status, ["attivo", "concluso"]),
        lt(contracts.startDate, until),
        gt(contracts.occupiedUntil, startDate),
        excludeId ? ne(contracts.id, excludeId) : undefined,
      ),
    )
    .limit(1);
  return row ?? null;
}

async function assertBerthUsable(tx: Tx, marinaId: string, berthId: string, boat: { lengthCm: number; beamCm: number }, startDate: string, until: string, excludeId?: string) {
  const [berth] = await tx.select().from(berths).where(and(eq(berths.id, berthId), eq(berths.marinaId, marinaId))).limit(1);
  if (!berth) throw new DomainError("Posto barca non trovato.", "berthId");
  if (berth.status !== "attivo") throw new DomainError(`Il posto ${berth.code} non è in servizio.`, "berthId");
  if (boat.lengthCm > berth.lengthCm || boat.beamCm > berth.beamCm) {
    throw new DomainError(`La barca è più grande del posto ${berth.code}.`, "berthId");
  }
  const conflict = await findBerthConflict(tx, marinaId, berthId, startDate, until, excludeId);
  if (conflict) {
    throw new DomainError(
      `Il posto ${berth.code} è già assegnato dal ${formatDate(conflict.startDate)} al ${formatDate(conflict.endDate)} (contratto ${conflict.number}).`,
      "berthId",
    );
  }
  return berth;
}

async function createInstalmentCharges(
  tx: Tx,
  actor: Actor,
  contract: { id: string; number: string; ownerId: string; type: ContractType; amountCents: number; vatRate: number },
  plan: InstalmentPlan,
  issueDate: string,
) {
  if (contract.amountCents <= 0) return;
  const parts = splitInstalments(contract.amountCents, plan.count, plan.firstDueDate, plan.everyMonths);
  await tx.insert(charges).values(
    parts.map((part) => {
      const { netCents, vatCents } = splitVat(part.amountCents, contract.vatRate);
      const label = `Ormeggio ${CONTRACT_TYPE_LABEL[contract.type].toLowerCase()} · contratto ${contract.number}`;
      return {
        marinaId: actor.marinaId,
        ownerId: contract.ownerId,
        contractId: contract.id,
        kind: "ormeggio" as const,
        description: plan.count > 1 ? `${label} · rata ${part.index} di ${plan.count}` : label,
        issueDate,
        dueDate: part.dueDate,
        netCents,
        vatRate: contract.vatRate,
        vatCents,
        grossCents: part.amountCents,
        createdBy: actor.userId,
      };
    }),
  );
}

// Controlla le voci aggiuntive: gli spazi vogliono un periodo coerente, le spese fisse compaiono una volta sola,
// i servizi hanno una descrizione e un'aliquota ammessa (possono essere più d'uno).
export function validateItems(items: ContractItemInput[]) {
  const seen = new Set<string>();
  for (const item of items) {
    if (item.amountCents < 0) throw new DomainError("Importo non valido.", "amount");
    if (item.kind === SERVICE_ITEM_KIND) {
      if (!item.description?.trim()) throw new DomainError("Indica la descrizione del servizio.", "description");
      if (item.vatRate != null && !(SERVICE_VAT_RATES as readonly number[]).includes(item.vatRate)) throw new DomainError("Aliquota IVA non valida.", "vatRate");
      continue;
    }
    if (itemHasPeriod(item.kind)) {
      if (!item.startDate || !item.endDate) throw new DomainError("Indica inizio e fine del periodo.", "startDate");
      if (item.endDate < item.startDate) throw new DomainError("La fine del periodo precede l'inizio.", "endDate");
      if (item.annual && item.endDate !== annualEnd(item.startDate)) {
        throw new DomainError(`${itemTitle(item)}: un periodo annuale che inizia il ${formatDate(item.startDate)} finisce il ${formatDate(annualEnd(item.startDate))}.`, "endDate");
      }
    } else {
      if (seen.has(item.kind)) throw new DomainError(`${itemTitle(item)}: voce già presente nel contratto.`, "kind");
      seen.add(item.kind);
    }
  }
}

type ChargeableContract = { id: string; number: string; ownerId: string; vatRate: number };

// Addebito di una voce aggiuntiva: aliquota del contratto, oppure quella propria del servizio (0 per le cauzioni).
// Le voci a importo zero non si addebitano.
async function createItemCharge(tx: Tx, actor: Actor, contract: ChargeableContract, item: { id: string } & ContractItemInput, dueDate: string) {
  if (item.amountCents <= 0) return;
  const vatRate = item.vatRate ?? contract.vatRate;
  const { netCents, vatCents } = splitVat(item.amountCents, vatRate);
  const [charge] = await tx
    .insert(charges)
    .values({
      marinaId: actor.marinaId,
      ownerId: contract.ownerId,
      contractId: contract.id,
      kind: "servizi",
      description: `${itemTitle(item)} · contratto ${contract.number}`,
      issueDate: todayRome(),
      dueDate,
      netCents,
      vatRate,
      vatCents,
      grossCents: item.amountCents,
      createdBy: actor.userId,
    })
    .returning({ id: charges.id });
  await tx.update(contractItems).set({ chargeId: charge.id }).where(eq(contractItems.id, item.id));
}

// Addebita le voci del contratto che non hanno ancora un addebito (alla creazione o all'attivazione).
async function chargePendingItems(tx: Tx, actor: Actor, contract: ChargeableContract, dueDate: string) {
  const pending = await tx
    .select()
    .from(contractItems)
    .where(and(eq(contractItems.contractId, contract.id), eq(contractItems.marinaId, actor.marinaId), sql`${contractItems.chargeId} is null`));
  for (const item of pending) await createItemCharge(tx, actor, contract, item, dueDate);
}

export interface ContractInput {
  ownerId: string;
  boatId: string;
  berthId: string | null;
  type: ContractType;
  status: "bozza" | "attivo";
  startDate: string;
  endDate: string;
  amountCents: number;
  vatRate: number;
  signedOn: string | null;
  notes: string | null;
  instalments: InstalmentPlan;
  items?: ContractItemInput[];
}

// Un cliente con un contratto attivo non è più «ex cliente».
async function clearFormer(tx: Tx, marinaId: string, ownerId: string) {
  await tx
    .update(owners)
    .set({ former: false })
    .where(and(eq(owners.id, ownerId), eq(owners.marinaId, marinaId), eq(owners.former, true)));
}

// Controlla che il posto indicato dal browser sia di questo porto (per le bozze non si verifica la disponibilità).
async function assertOwnBerth(tx: Tx, marinaId: string, berthId: string | null) {
  if (!berthId) return;
  const [berth] = await tx.select({ id: berths.id }).from(berths).where(and(eq(berths.id, berthId), eq(berths.marinaId, marinaId))).limit(1);
  if (!berth) throw new DomainError("Posto barca non trovato.", "berthId");
}

export async function createContract(tx: Tx, actor: Actor, input: ContractInput): Promise<{ id: string; number: string | null; fillsGap: boolean }> {
  if (input.endDate < input.startDate) throw new DomainError("La data di fine precede la data di inizio.", "endDate");
  const items = input.items ?? [];
  validateItems(items);

  const [owner] = await tx.select({ id: owners.id }).from(owners).where(and(eq(owners.id, input.ownerId), eq(owners.marinaId, actor.marinaId))).limit(1);
  if (!owner) throw new DomainError("Cliente non trovato.", "ownerId");
  const [boat] = await tx.select().from(boats).where(and(eq(boats.id, input.boatId), eq(boats.marinaId, actor.marinaId))).limit(1);
  if (!boat) throw new DomainError("Barca non trovata.", "boatId");
  if (boat.ownerId !== input.ownerId) throw new DomainError("La barca non appartiene al cliente selezionato.", "boatId");

  const until = occupiedUntil(input.type, input.startDate, input.endDate);
  if (input.status === "attivo") {
    if (!input.berthId) throw new DomainError("Per attivare il contratto serve un posto barca.", "berthId");
    await assertBerthUsable(tx, actor.marinaId, input.berthId, boat, input.startDate, until);
  } else {
    await assertOwnBerth(tx, actor.marinaId, input.berthId);
  }

  // Le bozze nascono senza numero: lo ricevono quando diventano definitive.
  const year = yearOf(input.startDate);
  const assigned = input.status === "attivo" ? await assignContractNumber(tx, actor.marinaId, year) : null;
  const seq = assigned?.seq ?? null;
  const number = assigned?.number ?? null;
  const [created] = await tx
    .insert(contracts)
    .values({
      marinaId: actor.marinaId,
      year,
      seq,
      number,
      ownerId: input.ownerId,
      boatId: input.boatId,
      berthId: input.berthId,
      type: input.type,
      status: input.status,
      startDate: input.startDate,
      endDate: input.endDate,
      occupiedUntil: until,
      amountCents: input.amountCents,
      vatRate: input.vatRate,
      signedOn: input.signedOn,
      notes: input.notes,
      createdBy: actor.userId,
    })
    .returning({ id: contracts.id });

  if (items.length > 0) {
    await tx.insert(contractItems).values(items.map((item) => ({ marinaId: actor.marinaId, contractId: created.id, ...item })));
  }

  if (number) {
    await clearFormer(tx, actor.marinaId, input.ownerId);
    await unarchiveBoat(tx, actor.marinaId, input.boatId);
    await createInstalmentCharges(tx, actor, { id: created.id, number, ...input }, input.instalments, todayRome());
    await chargePendingItems(tx, actor, { id: created.id, number, ownerId: input.ownerId, vatRate: input.vatRate }, input.instalments.firstDueDate);
  }
  return { id: created.id, number, fillsGap: assigned?.fillsGap ?? false };
}

export type DraftInput = Omit<ContractInput, "status" | "instalments" | "items">;

// Modifica di una bozza: cliente, barca, posto, tipo, date, importo e note. Le voci aggiuntive si gestiscono dalla scheda.
export async function updateDraftContract(tx: Tx, actor: Actor, contractId: string, input: DraftInput) {
  const c = await loadContract(tx, actor.marinaId, contractId);
  if (c.status !== "bozza") throw new DomainError("Si possono modificare solo i contratti in bozza: riporta prima il contratto in bozza.");
  if (input.endDate < input.startDate) throw new DomainError("La data di fine precede la data di inizio.", "endDate");
  const [owner] = await tx.select({ id: owners.id }).from(owners).where(and(eq(owners.id, input.ownerId), eq(owners.marinaId, actor.marinaId))).limit(1);
  if (!owner) throw new DomainError("Cliente non trovato.", "ownerId");
  const [boat] = await tx.select().from(boats).where(and(eq(boats.id, input.boatId), eq(boats.marinaId, actor.marinaId))).limit(1);
  if (!boat) throw new DomainError("Barca non trovata.", "boatId");
  if (boat.ownerId !== input.ownerId) throw new DomainError("La barca non appartiene al cliente selezionato.", "boatId");
  await assertOwnBerth(tx, actor.marinaId, input.berthId);
  await tx
    .update(contracts)
    .set({
      ownerId: input.ownerId,
      boatId: input.boatId,
      berthId: input.berthId,
      type: input.type,
      year: yearOf(input.startDate),
      startDate: input.startDate,
      endDate: input.endDate,
      occupiedUntil: occupiedUntil(input.type, input.startDate, input.endDate),
      amountCents: input.amountCents,
      vatRate: input.vatRate,
      signedOn: input.signedOn,
      notes: input.notes,
      updatedAt: new Date(),
    })
    .where(eq(contracts.id, c.id));
}

// Da attivo a bozza: il contratto perde il numero e gli addebiti (mai incassati), il posto torna libero.
// Se il numero non era l'ultimo dell'anno resta un buco: lo si segnala e lo riprende il primo contratto attivato.
export async function revertToDraft(tx: Tx, actor: Actor, contractId: string): Promise<{ freedNumber: string; leavesGap: boolean }> {
  const c = await loadContract(tx, actor.marinaId, contractId);
  if (c.status !== "attivo") throw new DomainError("Solo un contratto attivo può tornare in bozza.");
  if (c.checkedInAt || c.presence !== "atteso") {
    throw new DomainError("La barca risulta già arrivata: un contratto in uso non può tornare in bozza.");
  }
  const chargeRows = await tx
    .select({ id: charges.id })
    .from(charges)
    .where(and(eq(charges.contractId, c.id), eq(charges.marinaId, actor.marinaId)));
  const chargeIds = chargeRows.map((r) => r.id);
  if (chargeIds.length > 0) {
    const [paid] = await tx.select({ id: payments.id }).from(payments).where(inArray(payments.chargeId, chargeIds)).limit(1);
    if (paid) throw new DomainError("Ci sono incassi registrati su questo contratto: per riportarlo in bozza elimina prima gli incassi dalla contabilità.");
    // Addebiti mai incassati: spariscono; le voci aggiuntive restano e verranno riaddebitate all'attivazione.
    await tx.delete(charges).where(and(inArray(charges.id, chargeIds), eq(charges.marinaId, actor.marinaId)));
  }
  await tx.update(contracts).set({ status: "bozza", seq: null, number: null, updatedAt: new Date() }).where(eq(contracts.id, c.id));
  const [later] = await tx
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.marinaId, actor.marinaId), eq(contracts.year, c.year), gt(contracts.seq, c.seq ?? 0)))
    .limit(1);
  return { freedNumber: c.number ?? "", leavesGap: Boolean(later) };
}

async function loadContract(tx: Tx, marinaId: string, contractId: string) {
  const [row] = await tx
    .select()
    .from(contracts)
    .where(and(eq(contracts.id, contractId), eq(contracts.marinaId, marinaId)))
    .for("update")
    .limit(1);
  if (!row) throw new DomainError("Contratto non trovato.");
  return row;
}

// Da bozza ad attivo: il contratto riceve il numero (il più basso libero dell'anno), il posto viene impegnato
// e nascono gli addebiti delle rate e delle voci aggiuntive.
export async function activateContract(tx: Tx, actor: Actor, contractId: string, plan: InstalmentPlan): Promise<{ number: string; fillsGap: boolean }> {
  const c = await loadContract(tx, actor.marinaId, contractId);
  if (c.status !== "bozza") throw new DomainError("Solo un contratto in bozza può essere attivato.");
  if (!c.berthId) throw new DomainError("Assegna un posto barca prima di attivare il contratto.");
  const [boat] = await tx.select().from(boats).where(eq(boats.id, c.boatId)).limit(1);
  await assertBerthUsable(tx, actor.marinaId, c.berthId, boat, c.startDate, c.occupiedUntil, c.id);
  const year = yearOf(c.startDate);
  const { seq, number, fillsGap } = await assignContractNumber(tx, actor.marinaId, year);
  await tx.update(contracts).set({ status: "attivo", year, seq, number, updatedAt: new Date() }).where(eq(contracts.id, c.id));
  await clearFormer(tx, actor.marinaId, c.ownerId);
  await unarchiveBoat(tx, actor.marinaId, c.boatId);
  const numbered = { ...c, number };
  await createInstalmentCharges(tx, actor, numbered, plan, todayRome());
  await chargePendingItems(tx, actor, numbered, plan.firstDueDate);
  return { number, fillsGap };
}

// Aggiunge una voce a un contratto in bozza o attivo. Se il contratto è attivo l'addebito nasce subito, con scadenza oggi.
export async function addContractItem(tx: Tx, actor: Actor, contractId: string, item: ContractItemInput) {
  const c = await loadContract(tx, actor.marinaId, contractId);
  if (c.status !== "bozza" && c.status !== "attivo") throw new DomainError("Il contratto è chiuso: non si possono aggiungere voci.");
  const existing = await tx.select().from(contractItems).where(eq(contractItems.contractId, c.id));
  validateItems([...existing, item]);
  const [created] = await tx
    .insert(contractItems)
    .values({ marinaId: actor.marinaId, contractId: c.id, ...item })
    .returning({ id: contractItems.id });
  if (c.status === "attivo" && c.number) await createItemCharge(tx, actor, { ...c, number: c.number }, { id: created.id, ...item }, todayRome());
  return created.id;
}

// Toglie una voce dal contratto e ne annulla l'addebito, se non è già stato incassato.
export async function removeContractItem(tx: Tx, actor: Actor, itemId: string) {
  const [item] = await tx
    .select()
    .from(contractItems)
    .where(and(eq(contractItems.id, itemId), eq(contractItems.marinaId, actor.marinaId)))
    .limit(1);
  if (!item) throw new DomainError("Voce non trovata.");
  const c = await loadContract(tx, actor.marinaId, item.contractId);
  if (c.status !== "bozza" && c.status !== "attivo") throw new DomainError("Il contratto è chiuso: non si possono togliere voci.");
  if (item.chargeId) {
    const [paid] = await tx.select({ id: payments.id }).from(payments).where(eq(payments.chargeId, item.chargeId)).limit(1);
    if (paid) throw new DomainError("La voce è già stata incassata: elimina prima l'incasso dalla contabilità.");
    await tx.update(charges).set({ cancelledAt: new Date() }).where(and(eq(charges.id, item.chargeId), eq(charges.marinaId, actor.marinaId)));
  }
  await tx.delete(contractItems).where(eq(contractItems.id, item.id));
  return { contractId: c.id, title: itemTitle(item) };
}

// Annulla il contratto e gli addebiti non ancora incassati. Gli addebiti con incassi restano.
export async function cancelContract(tx: Tx, actor: Actor, contractId: string) {
  const c = await loadContract(tx, actor.marinaId, contractId);
  if (c.status === "annullato") return;
  if (c.presence === "in_porto" || c.presence === "fuori") {
    throw new DomainError("La barca risulta in porto: registra prima la partenza.");
  }
  await tx.update(contracts).set({ status: "annullato", updatedAt: new Date() }).where(eq(contracts.id, c.id));
  await tx.execute(sql`
    update charges set cancelled_at = now()
    where contract_id = ${c.id} and marina_id = ${actor.marinaId} and cancelled_at is null
      and not exists (select 1 from payments p where p.charge_id = charges.id)
  `);
}

type MovementKind = "arrivo" | "partenza" | "uscita" | "rientro";

/**
 * Registra un movimento di banchina e aggiorna lo stato del contratto.
 * - arrivo: la barca attesa entra in porto;
 * - uscita / rientro: assenza temporanea, il posto resta assegnato;
 * - partenza: la barca lascia definitivamente il posto. Se parte in anticipo il periodo
 *   viene accorciato a oggi, così il posto torna subito disponibile.
 */
export async function recordMovement(tx: Tx, actor: Actor, contractId: string, kind: MovementKind, note: string | null = null) {
  const c = await loadContract(tx, actor.marinaId, contractId);
  if (c.status !== "attivo") throw new DomainError("Il contratto non è attivo.");
  const now = new Date();
  const today = todayRome(now);

  const allowed: Record<MovementKind, string[]> = {
    arrivo: ["atteso"],
    uscita: ["in_porto"],
    rientro: ["fuori"],
    partenza: ["in_porto", "fuori"],
  };
  if (!allowed[kind].includes(c.presence)) throw new DomainError("Movimento non coerente con lo stato attuale della barca.");

  if (kind === "arrivo") {
    if (c.startDate > today) throw new DomainError(`L'arrivo è previsto per il ${formatDate(c.startDate)}.`);
    await tx.update(contracts).set({ presence: "in_porto", checkedInAt: now, updatedAt: now }).where(eq(contracts.id, c.id));
  } else if (kind === "uscita") {
    await tx.update(contracts).set({ presence: "fuori", updatedAt: now }).where(eq(contracts.id, c.id));
  } else if (kind === "rientro") {
    await tx.update(contracts).set({ presence: "in_porto", updatedAt: now }).where(eq(contracts.id, c.id));
  } else {
    const early = today < c.endDate;
    const endDate = early ? (today > c.startDate ? today : c.startDate) : c.endDate;
    const until = early ? occupiedUntil(c.type, c.startDate, endDate) : c.occupiedUntil;
    await tx
      .update(contracts)
      .set({ presence: "partito", status: "concluso", checkedOutAt: now, endDate, occupiedUntil: until, updatedAt: now })
      .where(eq(contracts.id, c.id));
  }

  await tx.insert(movements).values({
    marinaId: actor.marinaId,
    contractId: c.id,
    boatId: c.boatId,
    berthId: c.berthId,
    kind,
    at: now,
    userId: actor.userId,
    note,
  });
}
