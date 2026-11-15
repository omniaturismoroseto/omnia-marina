// Popola il database con un porto dimostrativo. Uso:  pnpm db:seed
// Il porto demo viene cancellato e ricreato a ogni esecuzione; gli altri porti non vengono toccati.
import { readFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  berthCategories,
  berths,
  boats,
  contracts,
  ledgerEntries,
  marinaPlans,
  marinas,
  memberships,
  movements,
  owners,
  piers,
  priceLists,
  privacyConsents,
  rates,
  seasonPeriods,
  tariffZones,
  tasks,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { addDays, addMonths, todayRome, yearOf } from "@/lib/dates";
import { imageInfo, layoutPier, type PlanBerth, type Point } from "@/lib/plan";
import { quoteStay, zoneRate, type RateRow, type SeasonPeriod } from "@/lib/pricing";
import { createCharge, registerPayment } from "@/server/accounting";
import { createContract, recordMovement } from "@/server/contracts";
import { createMarinaWithDefaults } from "@/server/marina-setup";

const DEMO_PASSWORD = "omnia-marina-demo";
const DEMO_MARINA = "Marina Scirocco (demo)";
const DEMO_USERS = [
  { email: "direzione@omniamarina.example", name: "Giulia Marchetti", role: "admin" as const },
  { email: "ufficio@omniamarina.example", name: "Paolo Rinaldi", role: "ufficio" as const },
  { email: "banchina@omniamarina.example", name: "Luca Ferrante", role: "banchina" as const },
];

// Generatore pseudo-casuale con seme fisso: i dati demo sono sempre gli stessi.
let seed = 20261113;
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)];

const today = todayRome();
const year = yearOf(today);

// Tariffe in euro: [giorno bassa, media, alta, mese bassa, media, alta, annuale]
// [giorno bassa, media, alta, mese bassa, media, alta, anno, rifiuti sugli annuali] in euro.
const RATES: number[][] = [
  [18, 25, 35, 300, 450, 650, 1900, 30],
  [24, 34, 48, 400, 600, 880, 2600, 40],
  [32, 45, 65, 520, 800, 1150, 3500, 50],
  [42, 60, 85, 680, 1050, 1500, 4700, 60],
  [58, 82, 115, 950, 1450, 2050, 6600, 80],
  [78, 110, 155, 1300, 1950, 2750, 9000, 90],
];
// Il pontile C è una zona più cara: solo il canone annuale cambia (+10%), il resto segue la tariffa base.
const ZONE_C_ANNUAL_MARKUP = 1.1;

const PEOPLE: [first: string, last: string, city: string, province: string][] = [
  ["Marco", "Bellini", "Pescara", "PE"],
  ["Francesca", "De Santis", "Roma", "RM"],
  ["Antonio", "Greco", "Teramo", "TE"],
  ["Elena", "Conti", "Bologna", "BO"],
  ["Roberto", "Fabbri", "Ancona", "AN"],
  ["Silvia", "Moretti", "Milano", "MI"],
  ["Giovanni", "Pellegrini", "L'Aquila", "AQ"],
  ["Chiara", "Barbieri", "Perugia", "PG"],
  ["Stefano", "Lombardi", "Chieti", "CH"],
  ["Laura", "Mancini", "Firenze", "FI"],
  ["Davide", "Rizzo", "Ascoli Piceno", "AP"],
  ["Paola", "Galli", "Torino", "TO"],
  ["Andrea", "Ferri", "Pescara", "PE"],
  ["Valentina", "Marini", "Roma", "RM"],
  ["Massimo", "Caruso", "Napoli", "NA"],
  ["Federica", "Leone", "Teramo", "TE"],
  ["Simone", "Testa", "Macerata", "MC"],
  ["Monica", "Villa", "Verona", "VR"],
  ["Enrico", "Sartori", "Padova", "PD"],
  ["Hans", "Keller", "München", "DE"],
];

const COMPANIES: [name: string, city: string, province: string][] = [
  ["Adriatica Charter S.r.l.", "Pescara", "PE"],
  ["Nautica Levante S.n.c.", "Giulianova", "TE"],
];

// [nome, tipo, cantiere, modello, lunghezza cm, larghezza cm, pescaggio cm]
type BoatSpec = [string, "vela" | "motore" | "gommone" | "catamarano", string, string, number, number, number];
const BOATS: BoatSpec[] = [
  ["Maestrale", "vela", "Beneteau", "Oceanis 30.1", 931, 299, 188],
  ["Stella Maris", "motore", "Sessa", "Key Largo 27", 780, 275, 60],
  ["Libeccio", "vela", "Jeanneau", "Sun Odyssey 349", 997, 344, 198],
  ["Onda Blu", "gommone", "Zodiac", "Medline 7.5", 745, 284, 45],
  ["Tramontana", "vela", "Bavaria", "Cruiser 37", 1130, 367, 195],
  ["Gabbiano", "motore", "Cranchi", "Zaffiro 34", 1085, 349, 95],
  ["Aurora", "vela", "Dufour", "360 Grand Large", 1073, 354, 190],
  ["Corallo", "motore", "Saver", "750 Cabin", 750, 252, 50],
  ["Grecale", "vela", "Hanse", "388", 1140, 390, 206],
  ["Delfino", "gommone", "Joker Boat", "Clubman 26", 790, 298, 50],
  ["Sirena", "motore", "Azimut", "Atlantis 43", 1368, 420, 115],
  ["Ponente", "vela", "Beneteau", "First 27", 799, 254, 170],
  ["Nettuno", "motore", "Fiart", "Seawalker 33", 1010, 330, 85],
  ["Alba Chiara", "vela", "Jeanneau", "Sun Odyssey 410", 1235, 399, 214],
  ["Riva Bella", "motore", "Rio", "Parana 38", 1160, 380, 100],
  ["Zefiro", "vela", "Elan", "Impression 40", 1185, 391, 180],
  ["Perla", "motore", "Ranieri", "Next 240 SH", 740, 250, 45],
  ["Levante", "catamarano", "Lagoon", "380", 1155, 653, 115],
  ["Ostro", "vela", "Bavaria", "C42", 1284, 429, 210],
  ["Marlin", "motore", "Marlin", "274 FB", 825, 300, 60],
  ["Bora", "vela", "Dehler", "34", 1070, 360, 195],
  ["Albatros", "motore", "Absolute", "47 Fly", 1460, 440, 120],
];

async function main() {
  // ── Pulizia del porto demo precedente ──
  const old = await db.select({ id: marinas.id }).from(marinas).where(inArray(marinas.name, [DEMO_MARINA, "Porto Vecchio (demo)"]));
  for (const m of old) await db.delete(marinas).where(eq(marinas.id, m.id));
  await db.delete(users).where(
    inArray(
      users.email,
      DEMO_USERS.map((u) => u.email),
    ),
  );

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  await db.transaction(async (tx) => {
    const createdUsers = await tx
      .insert(users)
      .values(DEMO_USERS.map((u) => ({ email: u.email, name: u.name, passwordHash })))
      .returning({ id: users.id, email: users.email });
    const userId = (email: string) => createdUsers.find((u) => u.email === email)!.id;
    const adminId = userId(DEMO_USERS[0].email);
    const officeId = userId(DEMO_USERS[1].email);
    const dockId = userId(DEMO_USERS[2].email);

    const marinaId = await createMarinaWithDefaults(tx, { name: DEMO_MARINA, userId: adminId, year });
    await tx
      .update(marinas)
      .set({
        legalName: "Marina Scirocco S.r.l.",
        vatNumber: "IT00000000000",
        address: "Molo di Levante 1",
        zip: "00000",
        city: "Borgomare",
        province: "BM",
        phone: "+39 000 555 0100",
        email: "info@marinascirocco.example",
        vhfChannel: "09",
      })
      .where(eq(marinas.id, marinaId));
    await tx.insert(memberships).values([
      { userId: officeId, marinaId, role: "ufficio" },
      { userId: dockId, marinaId, role: "banchina" },
    ]);

    // Un secondo porto vuoto, per mostrare il cambio porto alla direzione.
    await createMarinaWithDefaults(tx, { name: "Porto Vecchio (demo)", userId: adminId, year });

    const office = { marinaId, userId: officeId };
    const dock = { marinaId, userId: dockId };

    // ── Tariffe ──
    const categories = await tx.select().from(berthCategories).where(eq(berthCategories.marinaId, marinaId)).orderBy(berthCategories.sortOrder);
    const [list] = await tx.select().from(priceLists).where(eq(priceLists.marinaId, marinaId));
    const rateFor = new Map<string, RateRow>();
    for (const [i, cat] of categories.entries()) {
      const [dl, dm, dh, ml, mm, mh, an, waste] = RATES[i].map((v) => v * 100);
      const row = { dailyLow: dl, dailyMid: dm, dailyHigh: dh, monthlyLow: ml, monthlyMid: mm, monthlyHigh: mh, annual: an, seasonal: 0, waste };
      rateFor.set(cat.id, row);
      await tx.insert(rates).values({ marinaId, priceListId: list.id, categoryId: cat.id, ...row });
    }
    const [zoneC] = await tx.insert(tariffZones).values({ marinaId, name: "Pontile C" }).returning({ id: tariffZones.id });
    const zoneAnnual = (catId: string) => Math.round((rateFor.get(catId)!.annual * ZONE_C_ANNUAL_MARKUP) / 1000) * 1000;
    for (const cat of categories) await tx.insert(rates).values({ marinaId, priceListId: list.id, categoryId: cat.id, zoneId: zoneC.id, annual: zoneAnnual(cat.id) });
    const periods: SeasonPeriod[] = await tx.select().from(seasonPeriods).where(eq(seasonPeriods.priceListId, list.id));

    // Listino dell'anno successivo, con le stesse tariffe, per i rinnovi.
    const [nextList] = await tx
      .insert(priceLists)
      .values({ marinaId, name: `Listino ${year + 1}`, validFrom: `${year + 1}-01-01`, validTo: `${year + 1}-12-31` })
      .returning({ id: priceLists.id });
    await tx.insert(seasonPeriods).values(
      periods.map((p) => ({ marinaId, priceListId: nextList.id, season: p.season, startDate: addMonths(p.startDate, 12), endDate: addMonths(p.endDate, 12) })),
    );
    for (const cat of categories) {
      await tx.insert(rates).values({ marinaId, priceListId: nextList.id, categoryId: cat.id, ...rateFor.get(cat.id)! });
      await tx.insert(rates).values({ marinaId, priceListId: nextList.id, categoryId: cat.id, zoneId: zoneC.id, annual: zoneAnnual(cat.id) });
    }

    // ── Pontili e posti ──
    // [codice, nome, posti per lato, indice categoria, lati]
    const PIERS: [string, string, number, number, ("sx" | "dx")[]][] = [
      ["A", "Pontile A", 10, 1, ["sx", "dx"]],
      ["B", "Pontile B", 8, 2, ["sx", "dx"]],
      ["C", "Pontile C", 6, 3, ["sx", "dx"]],
      ["T", "Banchina transiti", 8, 4, ["sx"]],
    ];
    const berthByCode = new Map<string, { id: string; categoryId: string | null; lengthCm: number; beamCm: number }>();
    const berthsByPier = new Map<string, PlanBerth[]>();
    for (const [i, [code, name, perSide, catIndex, sides]] of PIERS.entries()) {
      const [pier] = await tx
        .insert(piers)
        .values({ marinaId, code, name, sortOrder: i, tariffZoneId: code === "C" ? zoneC.id : null })
        .returning({ id: piers.id });
      berthsByPier.set(code, []);
      let n = 1;
      for (let pos = 0; pos < perSide; pos++) {
        for (const side of sides) {
          // Gli ultimi posti del pontile C sono più grandi.
          const cat = categories[code === "C" && pos >= 4 ? catIndex + 1 : catIndex];
          const berthCode = `${code}${String(n++).padStart(2, "0")}`;
          const [b] = await tx
            .insert(berths)
            .values({
              marinaId,
              pierId: pier.id,
              categoryId: cat.id,
              code: berthCode,
              side,
              position: pos,
              lengthCm: cat.maxLengthCm,
              beamCm: code === "T" ? 700 : cat.maxBeamCm,
              draftCm: code === "A" ? 220 : 350,
            })
            .returning({ id: berths.id, categoryId: berths.categoryId, lengthCm: berths.lengthCm, beamCm: berths.beamCm });
          berthByCode.set(berthCode, b);
          berthsByPier.get(code)!.push({ id: b.id, side, position: pos, lengthCm: b.lengthCm, beamCm: b.beamCm });
        }
      }
    }

    // ── Pianta dal vero ──
    // Una veduta dall'alto di fantasia (scripts/demo/pianta-demo.jpg) con i posti già disposti:
    // nel porto vero la si sostituisce con la propria foto aerea da Impostazioni → Pianta dal vero.
    const photo = readFileSync(new URL("./demo/pianta-demo.jpg", import.meta.url));
    const photoInfo = imageInfo(photo);
    if (!photoInfo) throw new Error("Immagine demo non leggibile");
    const PX_PER_METER = 12;
    // Asse di ogni pontile sulla foto, dalla radice alla testata.
    const AXES: Record<string, [Point, Point]> = {
      A: [{ x: 220, y: 250 }, { x: 640, y: 250 }],
      B: [{ x: 220, y: 610 }, { x: 600, y: 610 }],
      C: [{ x: 220, y: 1040 }, { x: 610, y: 1040 }],
      T: [{ x: 1512, y: 1000 }, { x: 1512, y: 250 }],
    };
    await tx.insert(marinaPlans).values({ marinaId, mime: photoInfo.mime, data: photo });
    await tx.update(marinas).set({ planWidth: photoInfo.width, planHeight: photoInfo.height, planPxPerMeter: PX_PER_METER, planVersion: 1 }).where(eq(marinas.id, marinaId));
    for (const [code, [from, to]] of Object.entries(AXES)) {
      for (const p of layoutPier(berthsByPier.get(code)!, from, to, PX_PER_METER)) {
        await tx.update(berths).set({ planX: p.x, planY: p.y, planAngle: p.angle }).where(eq(berths.id, p.id));
      }
    }
    await tx.update(berths).set({ status: "manutenzione", notes: "Sostituzione catenaria e trappe." }).where(eq(berths.id, berthByCode.get("C11")!.id));

    // ── Clienti ──
    const ownerIds: string[] = [];
    for (const [i, [first, last, city, province]] of PEOPLE.entries()) {
      const foreign = province === "DE";
      const [o] = await tx
        .insert(owners)
        .values({
          marinaId,
          type: "persona",
          firstName: first,
          lastName: last,
          displayName: `${last} ${first}`,
          fiscalCode: foreign ? null : `${last.replace(/[^A-Za-z]/g, "").slice(0, 3)}${first.slice(0, 3)}${60 + i}A01H501X`.toUpperCase(),
          birthDate: `${1955 + ((i * 7) % 35)}-${String(1 + ((i * 5) % 12)).padStart(2, "0")}-${String(1 + ((i * 11) % 27)).padStart(2, "0")}`,
          address: `Via ${pick(["Roma", "Garibaldi", "Mazzini", "Dante", "Marconi", "del Mare"])} ${1 + Math.floor(rnd() * 120)}`,
          zip: foreign ? "80331" : "00000",
          city,
          province: foreign ? null : province,
          country: foreign ? "Germania" : "Italia",
          phone: `+39 3${10 + i} 555 0${String(100 + i)}`,
          email: `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "") + "@example.com",
          idDocType: "Carta d'identità",
          idDocNumber: `CA${10000 + i * 37}XX`,
          idDocExpiry: `${year + 1 + (i % 6)}-0${1 + (i % 9)}-15`,
        })
        .returning({ id: owners.id });
      ownerIds.push(o.id);
    }
    for (const [name, city, province] of COMPANIES) {
      const [o] = await tx
        .insert(owners)
        .values({
          marinaId,
          type: "azienda",
          companyName: name,
          displayName: name,
          vatNumber: "IT00000000000",
          address: "Via del Porto 12",
          zip: "00000",
          city,
          province,
          phone: "+39 000 555 0190",
          email: "amministrazione@example.com",
          pec: "azienda@pec.example.com",
          sdiCode: "0000000",
        })
        .returning({ id: owners.id });
      ownerIds.push(o.id);
    }

    // Consensi privacy: quasi tutti hanno firmato l'informativa, alcuni anche il marketing.
    for (const [i, ownerId] of ownerIds.entries()) {
      if (i === 5 || i === 13) continue; // due clienti senza informativa firmata
      const recordedAt = new Date(`${year}-01-${String(5 + (i % 20)).padStart(2, "0")}T10:00:00Z`);
      await tx.insert(privacyConsents).values({ marinaId, ownerId, kind: "informativa", granted: true, policyVersion: "1.0", method: "cartaceo", recordedAt, recordedBy: officeId });
      if (i % 3 === 0) await tx.insert(privacyConsents).values({ marinaId, ownerId, kind: "marketing", granted: true, policyVersion: "1.0", method: "cartaceo", recordedAt, recordedBy: officeId });
      if (i === 3) {
        await tx.insert(privacyConsents).values({ marinaId, ownerId, kind: "marketing", granted: false, policyVersion: "1.0", method: "verbale", note: "Revoca richiesta al telefono.", recordedAt: new Date(`${year}-06-12T09:30:00Z`), recordedBy: officeId });
      }
    }

    // ── Barche ──
    const boatRows: { id: string; ownerId: string; lengthCm: number; beamCm: number; name: string }[] = [];
    for (const [i, [name, type, builder, model, lengthCm, beamCm, draftCm]] of BOATS.entries()) {
      const ownerId = i === 20 ? ownerIds[20] : i === 21 ? ownerIds[21] : ownerIds[i % 20];
      const insuranceExpiry = i === 2 ? addDays(today, -12) : i === 6 || i === 11 ? addDays(today, 9 + i) : `${year + 1}-${String(1 + (i % 12)).padStart(2, "0")}-28`;
      const [b] = await tx
        .insert(boats)
        .values({
          marinaId,
          ownerId,
          name,
          registration: type === "gommone" ? null : `${pick(["PE", "AN", "RM", "VE"])}${1000 + i * 53}D`,
          type,
          builder,
          model,
          year: 2004 + ((i * 5) % 20),
          lengthCm,
          beamCm,
          draftCm,
          flag: i === 18 ? "Germania" : "Italia",
          engine: type === "vela" ? "Entrobordo diesel 30 CV" : type === "gommone" ? "Fuoribordo 200 CV" : "2 × entrobordo diesel",
          insuranceCompany: pick(["Adriatica Assicurazioni", "Mare Sicuro", "Nord Polizze"]),
          insurancePolicy: `POL-${200000 + i * 911}`,
          insuranceExpiry,
        })
        .returning({ id: boats.id });
      boatRows.push({ id: b.id, ownerId, lengthCm, beamCm, name });
    }

    // ── Contratti annuali dell'anno in corso ──
    // Assegnazione barca → posto: [indice barca, codice posto, rate, stato pagamenti]
    type Pay = "tutto" | "parziale" | "niente";
    const ANNUAL: [number, string, number, Pay][] = [
      [0, "B01", 2, "tutto"],
      [1, "A01", 1, "tutto"],
      [2, "B02", 3, "parziale"],
      [3, "A02", 1, "tutto"],
      [4, "C01", 3, "tutto"],
      [5, "C02", 2, "parziale"],
      [6, "C03", 2, "tutto"],
      [7, "A03", 1, "niente"],
      [8, "C04", 3, "tutto"],
      [9, "A04", 2, "tutto"],
      [10, "C09", 3, "parziale"],
      [11, "A05", 1, "tutto"],
      [12, "C05", 2, "tutto"],
      [14, "C06", 3, "tutto"],
      [15, "C07", 2, "niente"],
      [16, "A06", 1, "tutto"],
      [19, "B03", 2, "tutto"],
      [20, "C08", 3, "parziale"],
    ];

    const priceOf = (berthCode: string, type: "annuale" | "stagionale" | "mensile" | "transito", startDate: string, endDate: string) => {
      const berth = berthByCode.get(berthCode)!;
      // Come nell'app: sul pontile C il canone annuale della zona, il resto dalla tariffa base.
      const base = rateFor.get(berth.categoryId!)!;
      const inZone = berthCode.startsWith("C");
      const zoneRow = { ...base, dailyLow: 0, dailyMid: 0, dailyHigh: 0, monthlyLow: 0, monthlyMid: 0, monthlyHigh: 0, seasonal: 0, waste: 0, annual: zoneAnnual(berth.categoryId!) };
      const rows: (RateRow & { zoneId: string | null })[] = [{ ...base, zoneId: null }, ...(inZone ? [{ ...zoneRow, zoneId: zoneC.id }] : [])];
      const rate = zoneRate(rows, inZone ? zoneC.id : null)!;
      return quoteStay({ type, startDate, endDate, rate, periods }).totalCents;
    };

    for (const [boatIndex, berthCode, instalments, pay] of ANNUAL) {
      const boat = boatRows[boatIndex];
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;
      const { id } = await createContract(tx, office, {
        ownerId: boat.ownerId,
        boatId: boat.id,
        berthId: berthByCode.get(berthCode)!.id,
        type: "annuale",
        status: "attivo",
        startDate,
        endDate,
        amountCents: priceOf(berthCode, "annuale", startDate, endDate),
        vatRate: 22,
        signedOn: `${year}-01-${String(3 + (boatIndex % 12)).padStart(2, "0")}`,
        notes: null,
        instalments: { count: instalments, firstDueDate: `${year}-01-31`, everyMonths: instalments === 3 ? 4 : 6 },
      });
      await recordMovement(tx, dock, id, "arrivo");
      await tx
        .update(contracts)
        .set({ checkedInAt: new Date(`${year}-01-02T09:00:00Z`) })
        .where(eq(contracts.id, id));
      await tx
        .update(movements)
        .set({ at: new Date(`${year}-01-02T09:00:00Z`) })
        .where(eq(movements.contractId, id));

      // Incassi: le rate già scadute vengono pagate secondo lo scenario scelto.
      const due = await tx.query.charges.findMany({ where: (c, { eq }) => eq(c.contractId, id), orderBy: (c, { asc }) => asc(c.dueDate) });
      for (const [k, charge] of due.entries()) {
        if (charge.dueDate > today || pay === "niente") continue;
        const last = k === due.length - 1 || due[k + 1].dueDate > today;
        if (pay === "parziale" && last) {
          if (k === 0) await registerPayment(tx, office, { chargeId: charge.id, paidOn: addDays(charge.dueDate, 6), amountCents: Math.round(charge.grossCents / 2 / 100) * 100, method: "bonifico", reference: "Acconto" });
          continue;
        }
        await registerPayment(tx, office, {
          chargeId: charge.id,
          paidOn: addDays(charge.dueDate, -3 + Math.floor(rnd() * 10)),
          amountCents: charge.grossCents,
          method: pick(["bonifico", "bonifico", "pos", "assegno"] as const),
          reference: null,
        });
      }
    }

    // Due barche annuali oggi sono fuori in mare.
    for (const code of ["B01", "C03"]) {
      const [c] = await tx.select({ id: contracts.id }).from(contracts).where(eq(contracts.berthId, berthByCode.get(code)!.id));
      await recordMovement(tx, dock, c.id, "uscita", "Rientro previsto in serata.");
    }

    // ── Transiti ──
    // Passati (estate), per dare storia alla contabilità. Il check-out ha accorciato nulla: date già concluse.
    const pastTransits: [number, string, string, number][] = [
      [13, "T01", `${year}-07-04`, 5],
      [17, "T02", `${year}-07-18`, 7],
      [18, "T03", `${year}-08-02`, 10],
      [21, "T08", `${year}-08-09`, 4],
      [13, "T04", `${year}-08-20`, 6],
      [17, "T02", `${year}-09-05`, 3],
    ];
    for (const [boatIndex, berthCode, startDate, nights] of pastTransits) {
      const boat = boatRows[boatIndex];
      const endDate = addDays(startDate, nights);
      if (endDate >= today) continue;
      const amountCents = priceOf(berthCode, "transito", startDate, endDate);
      const { id } = await createContract(tx, office, {
        ownerId: boat.ownerId,
        boatId: boat.id,
        berthId: berthByCode.get(berthCode)!.id,
        type: "transito",
        status: "attivo",
        startDate,
        endDate,
        amountCents,
        vatRate: 22,
        signedOn: startDate,
        notes: null,
        instalments: { count: 1, firstDueDate: startDate, everyMonths: 1 },
      });
      const arrival = new Date(`${startDate}T14:30:00Z`);
      const departure = new Date(`${endDate}T08:15:00Z`);
      await tx
        .update(contracts)
        .set({ status: "concluso", presence: "partito", checkedInAt: arrival, checkedOutAt: departure })
        .where(eq(contracts.id, id));
      await tx.insert(movements).values([
        { marinaId, contractId: id, boatId: boat.id, berthId: berthByCode.get(berthCode)!.id, kind: "arrivo", at: arrival, userId: dockId },
        { marinaId, contractId: id, boatId: boat.id, berthId: berthByCode.get(berthCode)!.id, kind: "partenza", at: departure, userId: dockId },
      ]);
      const [charge] = await tx.query.charges.findMany({ where: (c, { eq }) => eq(c.contractId, id) });
      await registerPayment(tx, office, { chargeId: charge.id, paidOn: startDate, amountCents, method: pick(["pos", "contanti", "pos"] as const), reference: null });
    }

    // In corso e in arrivo: [barca, posto, giorni da oggi all'arrivo, notti, arrivato?, pagato?]
    const liveTransits: [number, string, number, number, boolean, boolean][] = [
      [13, "T01", -3, 3, true, true], // parte oggi
      [17, "T03", -1, 4, true, true],
      [18, "T05", -2, 3, true, false], // parte domani, da incassare
      [21, "T08", 0, 2, false, false], // arriva oggi
      [20, "T06", 0, 5, false, false], // arriva oggi
      [14, "T02", 2, 3, false, false], // arriva tra due giorni
    ];
    for (const [boatIndex, berthCode, offset, nights, arrived, paid] of liveTransits) {
      const boat = boatRows[boatIndex];
      const startDate = addDays(today, offset);
      const endDate = addDays(startDate, nights);
      const amountCents = priceOf(berthCode, "transito", startDate, endDate);
      const { id } = await createContract(tx, office, {
        ownerId: boat.ownerId,
        boatId: boat.id,
        berthId: berthByCode.get(berthCode)!.id,
        type: "transito",
        status: "attivo",
        startDate,
        endDate,
        amountCents,
        vatRate: 22,
        signedOn: arrived ? startDate : null,
        notes: boatIndex === 21 ? "Arrivo previsto verso le 17. Richiesta assistenza all'ormeggio." : null,
        instalments: { count: 1, firstDueDate: startDate, everyMonths: 1 },
      });
      if (arrived) {
        await recordMovement(tx, dock, id, "arrivo");
        const at = new Date(Date.now() + offset * 86_400_000);
        await tx.update(contracts).set({ checkedInAt: at }).where(eq(contracts.id, id));
        await tx.update(movements).set({ at }).where(eq(movements.contractId, id));
      }
      if (paid) {
        const [charge] = await tx.query.charges.findMany({ where: (c, { eq }) => eq(c.contractId, id) });
        await registerPayment(tx, office, { chargeId: charge.id, paidOn: startDate, amountCents, method: "pos", reference: null });
      }
    }

    // Una bozza di rinnovo per l'anno prossimo.
    await createContract(tx, office, {
      ownerId: boatRows[0].ownerId,
      boatId: boatRows[0].id,
      berthId: berthByCode.get("B01")!.id,
      type: "annuale",
      status: "bozza",
      startDate: `${year + 1}-01-01`,
      endDate: `${year + 1}-12-31`,
      amountCents: priceOf("B01", "annuale", `${year + 1}-01-01`, `${year + 1}-12-31`),
      vatRate: 22,
      signedOn: null,
      notes: "Rinnovo proposto, in attesa di firma.",
      instalments: { count: 2, firstDueDate: `${year + 1}-01-31`, everyMonths: 6 },
    });

    // ── Addebiti extra (servizi, utenze) ──
    await createCharge(tx, office, {
      ownerId: boatRows[4].ownerId,
      contractId: null,
      kind: "servizi",
      description: "Alaggio e varo con gru · Tramontana",
      issueDate: addDays(today, -40),
      dueDate: addDays(today, -10),
      grossCents: 38000,
      vatRate: 22,
      notes: null,
    });
    await createCharge(tx, office, {
      ownerId: boatRows[10].ownerId,
      contractId: null,
      kind: "utenze",
      description: "Consumo energia elettrica colonnina C09 · terzo trimestre",
      issueDate: addDays(today, -20),
      dueDate: addDays(today, 10),
      grossCents: 14640,
      vatRate: 22,
      notes: null,
    });

    // ── Prima nota: uscite ricorrenti dei mesi passati ──
    const expenses: [string, number, "cassa" | "banca", string, string][] = [
      ["Personale", 2600, "banca", "Stipendi personale di banchina e ufficio", "Dipendenti"],
      ["Utenze", 420, "banca", "Energia elettrica e acqua", "Fornitore energia"],
      ["Manutenzioni", 250, "banca", "Manutenzione ordinaria pontili e colonnine", "Officina Mare S.n.c."],
      ["Forniture", 80, "cassa", "Materiale di consumo e ferramenta", "Ferramenta del Porto"],
    ];
    const currentMonth = Number(today.slice(5, 7));
    for (let month = 1; month <= currentMonth; month++) {
      for (const [category, amount, account, description, counterparty] of expenses) {
        const entryDate = `${year}-${String(month).padStart(2, "0")}-${category === "Personale" ? "27" : String(5 + Math.floor(rnd() * 15)).padStart(2, "0")}`;
        if (entryDate > today) continue;
        const summer = month >= 6 && month <= 9 ? 1.5 : 1;
        await tx.insert(ledgerEntries).values({
          marinaId,
          entryDate,
          direction: "uscita",
          account,
          amountCents: Math.round(amount * summer * (0.9 + rnd() * 0.2)) * 100,
          category,
          description,
          counterparty,
          createdBy: officeId,
        });
      }
    }
    await tx.insert(ledgerEntries).values({
      marinaId,
      entryDate: `${year}-03-16`,
      direction: "uscita",
      account: "banca",
      amountCents: 650_000,
      category: "Canoni e concessioni",
      description: `Canone di concessione demaniale ${year}`,
      counterparty: "Agenzia del Demanio",
      documentRef: `F24 ${year}/03`,
      createdBy: adminId,
    });

    // ── Segnalazioni di banchina ──
    await tx.insert(tasks).values([
      { marinaId, kind: "manutenzione", priority: "alta", title: "Colonnina B07 senza corrente", description: "Il differenziale salta appena si collega una presa. Segnalato dal proprietario di Marlin.", berthId: berthByCode.get("B07")!.id, createdBy: dockId, createdAt: new Date(Date.now() - 20 * 3_600_000) },
      { marinaId, kind: "assistenza", priority: "normale", status: "in_corso", title: "Assistenza ormeggio Albatros", description: "Arrivo previsto verso le 17 al posto T08. Servono due persone.", berthId: berthByCode.get("T08")!.id, boatId: boatRows[21].id, createdBy: officeId, createdAt: new Date(Date.now() - 5 * 3_600_000) },
      { marinaId, kind: "manutenzione", priority: "normale", title: "Trappa da sostituire al posto A12", description: "Trappa di sinistra sfilacciata vicino al corpo morto.", berthId: berthByCode.get("A12")!.id, createdBy: dockId, createdAt: new Date(Date.now() - 3 * 86_400_000) },
      { marinaId, kind: "segnalazione", priority: "bassa", title: "Parabordo alla deriva nel bacino", description: "Recuperato e lasciato in ufficio, colore blu.", createdBy: dockId, createdAt: new Date(Date.now() - 86_400_000) },
      { marinaId, kind: "servizio", priority: "normale", status: "chiusa", title: "Rifornimento acqua Levante", description: null, boatId: boatRows[17].id, createdBy: officeId, createdAt: new Date(Date.now() - 6 * 86_400_000), closedBy: dockId, closedAt: new Date(Date.now() - 6 * 86_400_000 + 3_600_000), resolution: "Fatto, 300 litri." },
    ]);
  });

  console.log(`\nPorto demo creato: ${DEMO_MARINA}`);
  console.log("Accessi (password uguale per tutti):", DEMO_PASSWORD);
  for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(9)} ${u.email}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
