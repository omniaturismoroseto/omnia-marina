import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * Convenzioni
 * - Ogni tabella "di porto" ha marina_id: è il confine tra un porto e l'altro (multi-tenant).
 * - Importi in centesimi di euro (interi), misure in centimetri (interi), IVA in percentuale intera.
 * - Le date senza orario sono stringhe ISO "AAAA-MM-GG".
 */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// ───────────────────────── Enum ─────────────────────────

export const roleEnum = pgEnum("role", ["admin", "ufficio", "banchina"]);
export const ownerTypeEnum = pgEnum("owner_type", ["persona", "azienda"]);
export const consentKindEnum = pgEnum("consent_kind", ["informativa", "marketing", "terzi"]);
export const consentMethodEnum = pgEnum("consent_method", ["cartaceo", "digitale", "verbale"]);
export const boatTypeEnum = pgEnum("boat_type", ["vela", "motore", "gommone", "catamarano", "altro"]);
export const berthSideEnum = pgEnum("berth_side", ["sx", "dx"]);
export const berthStatusEnum = pgEnum("berth_status", ["attivo", "manutenzione", "fuori_servizio"]);
export const seasonEnum = pgEnum("season", ["bassa", "media", "alta"]);
export const contractTypeEnum = pgEnum("contract_type", ["annuale", "stagionale", "mensile", "transito"]);
export const contractStatusEnum = pgEnum("contract_status", ["bozza", "attivo", "concluso", "annullato"]);
export const presenceEnum = pgEnum("presence", ["atteso", "in_porto", "fuori", "partito"]);
export const movementKindEnum = pgEnum("movement_kind", ["arrivo", "partenza", "uscita", "rientro"]);
export const chargeKindEnum = pgEnum("charge_kind", ["ormeggio", "servizi", "utenze", "altro"]);
export const paymentMethodEnum = pgEnum("payment_method", ["contanti", "bonifico", "pos", "assegno", "altro"]);
export const ledgerDirectionEnum = pgEnum("ledger_direction", ["entrata", "uscita"]);
export const ledgerAccountEnum = pgEnum("ledger_account", ["cassa", "banca"]);
export const taskKindEnum = pgEnum("task_kind", ["assistenza", "manutenzione", "segnalazione", "servizio"]);
export const taskPriorityEnum = pgEnum("task_priority", ["bassa", "normale", "alta"]);
export const taskStatusEnum = pgEnum("task_status", ["aperta", "in_corso", "chiusa"]);

// ───────────────────────── Piattaforma ─────────────────────────

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

export const marinas = pgTable("marinas", {
  id: id(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  vatNumber: text("vat_number"),
  fiscalCode: text("fiscal_code"),
  address: text("address"),
  zip: text("zip"),
  city: text("city"),
  province: text("province"),
  phone: text("phone"),
  email: text("email"),
  vhfChannel: text("vhf_channel"),
  defaultVatRate: integer("default_vat_rate").notNull().default(22),
  privacyPolicyVersion: text("privacy_policy_version").notNull().default("1.0"),
  privacyPolicyText: text("privacy_policy_text"),
  contractTerms: text("contract_terms"),
  // Pianta dal vero: dimensioni in pixel della foto aerea caricata e scala (pixel per metro).
  // planVersion cambia a ogni nuova foto, così il browser non mostra quella vecchia dalla cache.
  planWidth: integer("plan_width"),
  planHeight: integer("plan_height"),
  planPxPerMeter: real("plan_px_per_meter"),
  planVersion: integer("plan_version").notNull().default(0),
  createdAt: createdAt(),
});

// La foto aerea del porto, conservata nel database (una per porto).
export const marinaPlans = pgTable("marina_plans", {
  marinaId: uuid("marina_id")
    .primaryKey()
    .references(() => marinas.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  data: bytea("data").notNull(),
  // Ultima analisi automatica della foto: pontili e banchine proposti, in attesa di conferma.
  // Si azzera quando cambia la foto o quando le proposte vengono confermate o scartate.
  analysis: jsonb("analysis"),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
  updatedAt: updatedAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_user_marina_uq").on(t.userId, t.marinaId)],
);

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 del token: il token in chiaro vive solo nel cookie dell'utente.
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    marinaId: uuid("marina_id").references(() => marinas.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// ───────────────────────── Anagrafiche ─────────────────────────

export const owners = pgTable(
  "owners",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    type: ownerTypeEnum("type").notNull().default("persona"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    companyName: text("company_name"),
    // Nome già composto ("Cognome Nome" o ragione sociale), usato per ricerca e ordinamento.
    displayName: text("display_name").notNull(),
    fiscalCode: text("fiscal_code"),
    vatNumber: text("vat_number"),
    birthDate: date("birth_date"),
    birthPlace: text("birth_place"),
    address: text("address"),
    zip: text("zip"),
    city: text("city"),
    province: text("province"),
    country: text("country").notNull().default("Italia"),
    phone: text("phone"),
    email: text("email"),
    pec: text("pec"),
    sdiCode: text("sdi_code"),
    idDocType: text("id_doc_type"),
    idDocNumber: text("id_doc_number"),
    idDocExpiry: date("id_doc_expiry"),
    notes: text("notes"),
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("owners_marina_name_idx").on(t.marinaId, t.displayName)],
);

// Registro dei consensi: ogni riga è un evento (concesso o revocato). Non si modifica mai,
// così resta la prova di chi ha registrato cosa, quando e con quale versione dell'informativa.
export const privacyConsents = pgTable(
  "privacy_consents",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "cascade" }),
    kind: consentKindEnum("kind").notNull(),
    granted: boolean("granted").notNull(),
    policyVersion: text("policy_version").notNull(),
    method: consentMethodEnum("method").notNull().default("cartaceo"),
    note: text("note"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("privacy_consents_owner_idx").on(t.ownerId, t.kind, t.recordedAt)],
);

export const boats = pgTable(
  "boats",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    registration: text("registration"),
    type: boatTypeEnum("type").notNull().default("motore"),
    builder: text("builder"),
    model: text("model"),
    year: integer("year"),
    lengthCm: integer("length_cm").notNull(),
    beamCm: integer("beam_cm").notNull(),
    draftCm: integer("draft_cm"),
    flag: text("flag"),
    engine: text("engine"),
    insuranceCompany: text("insurance_company"),
    insurancePolicy: text("insurance_policy"),
    insuranceExpiry: date("insurance_expiry"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("boats_marina_name_idx").on(t.marinaId, t.name), index("boats_owner_idx").on(t.ownerId)],
);

// ───────────────────────── Pontili e posti barca ─────────────────────────

export const piers = pgTable(
  "piers",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("piers_marina_code_uq").on(t.marinaId, t.code)],
);

export const berthCategories = pgTable(
  "berth_categories",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    maxLengthCm: integer("max_length_cm").notNull(),
    maxBeamCm: integer("max_beam_cm").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("berth_categories_marina_idx").on(t.marinaId)],
);

export const berths = pgTable(
  "berths",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    pierId: uuid("pier_id")
      .notNull()
      .references(() => piers.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => berthCategories.id, { onDelete: "set null" }),
    code: text("code").notNull(),
    side: berthSideEnum("side").notNull().default("sx"),
    position: integer("position").notNull().default(0),
    lengthCm: integer("length_cm").notNull(),
    beamCm: integer("beam_cm").notNull(),
    draftCm: integer("draft_cm"),
    hasWater: boolean("has_water").notNull().default(true),
    hasPower: boolean("has_power").notNull().default(true),
    status: berthStatusEnum("status").notNull().default("attivo"),
    notes: text("notes"),
    // Posizione sulla foto aerea: centro del posto in pixel dell'immagine e rotazione in gradi
    // (a 0° il lato lungo è verticale). Vuoti finché il posto non è stato disposto sulla pianta.
    planX: real("plan_x"),
    planY: real("plan_y"),
    planAngle: real("plan_angle"),
  },
  (t) => [uniqueIndex("berths_marina_code_uq").on(t.marinaId, t.code), index("berths_pier_idx").on(t.pierId)],
);

// ───────────────────────── Tariffe ─────────────────────────

export const priceLists = pgTable(
  "price_lists",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to").notNull(),
    // I prezzi del listino si intendono IVA inclusa.
    vatRate: integer("vat_rate").notNull().default(22),
    createdAt: createdAt(),
  },
  (t) => [index("price_lists_marina_idx").on(t.marinaId, t.validFrom)],
);

// Periodi di media e alta stagione. Tutto ciò che non rientra in un periodo è bassa stagione.
export const seasonPeriods = pgTable(
  "season_periods",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    priceListId: uuid("price_list_id")
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    season: seasonEnum("season").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
  },
  (t) => [index("season_periods_list_idx").on(t.priceListId)],
);

export const rates = pgTable(
  "rates",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    priceListId: uuid("price_list_id")
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => berthCategories.id, { onDelete: "cascade" }),
    dailyLow: integer("daily_low").notNull().default(0),
    dailyMid: integer("daily_mid").notNull().default(0),
    dailyHigh: integer("daily_high").notNull().default(0),
    monthlyLow: integer("monthly_low").notNull().default(0),
    monthlyMid: integer("monthly_mid").notNull().default(0),
    monthlyHigh: integer("monthly_high").notNull().default(0),
    annual: integer("annual").notNull().default(0),
  },
  (t) => [uniqueIndex("rates_list_category_uq").on(t.priceListId, t.categoryId)],
);

// ───────────────────────── Contratti e movimenti ─────────────────────────

export const contracts = pgTable(
  "contracts",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    seq: integer("seq").notNull(),
    number: text("number").notNull(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "restrict" }),
    boatId: uuid("boat_id")
      .notNull()
      .references(() => boats.id, { onDelete: "restrict" }),
    berthId: uuid("berth_id").references(() => berths.id, { onDelete: "restrict" }),
    type: contractTypeEnum("type").notNull(),
    status: contractStatusEnum("status").notNull().default("bozza"),
    startDate: date("start_date").notNull(),
    // Ultimo giorno di validità (per i transiti: giorno di partenza).
    endDate: date("end_date").notNull(),
    // Primo giorno in cui il posto torna libero. Calcolato dall'applicazione; è la colonna su cui
    // il database impedisce due contratti sovrapposti sullo stesso posto (vedi migrazione 0001).
    occupiedUntil: date("occupied_until").notNull(),
    amountCents: integer("amount_cents").notNull().default(0),
    vatRate: integer("vat_rate").notNull().default(22),
    presence: presenceEnum("presence").notNull().default("atteso"),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    signedOn: date("signed_on"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("contracts_marina_number_uq").on(t.marinaId, t.year, t.seq),
    index("contracts_berth_idx").on(t.berthId, t.startDate),
    index("contracts_owner_idx").on(t.ownerId),
    index("contracts_boat_idx").on(t.boatId),
  ],
);

export const movements = pgTable(
  "movements",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id").references(() => contracts.id, { onDelete: "cascade" }),
    boatId: uuid("boat_id")
      .notNull()
      .references(() => boats.id, { onDelete: "cascade" }),
    berthId: uuid("berth_id").references(() => berths.id, { onDelete: "set null" }),
    kind: movementKindEnum("kind").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
  },
  (t) => [index("movements_marina_at_idx").on(t.marinaId, t.at), index("movements_boat_idx").on(t.boatId, t.at)],
);

// ───────────────────────── Contabilità interna ─────────────────────────

export const charges = pgTable(
  "charges",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "restrict" }),
    contractId: uuid("contract_id").references(() => contracts.id, { onDelete: "set null" }),
    kind: chargeKindEnum("kind").notNull().default("ormeggio"),
    description: text("description").notNull(),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date").notNull(),
    netCents: integer("net_cents").notNull(),
    vatRate: integer("vat_rate").notNull(),
    vatCents: integer("vat_cents").notNull(),
    grossCents: integer("gross_cents").notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("charges_marina_due_idx").on(t.marinaId, t.dueDate),
    index("charges_owner_idx").on(t.ownerId),
    index("charges_contract_idx").on(t.contractId),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    chargeId: uuid("charge_id")
      .notNull()
      .references(() => charges.id, { onDelete: "restrict" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "restrict" }),
    paidOn: date("paid_on").notNull(),
    amountCents: integer("amount_cents").notNull(),
    method: paymentMethodEnum("method").notNull(),
    reference: text("reference"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("payments_charge_idx").on(t.chargeId), index("payments_marina_date_idx").on(t.marinaId, t.paidOn)],
);

// Importazioni di una prima nota da Excel: i movimenti creati restano collegati e si possono annullare insieme.
export const ledgerImports = pgTable(
  "ledger_imports",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    // Impronta SHA-256 del file: lo stesso file non si importa due volte.
    fileHash: text("file_hash").notNull(),
    sheetName: text("sheet_name").notNull(),
    rowsCount: integer("rows_count").notNull(),
    entriesCount: integer("entries_count").notNull(),
    firstDate: date("first_date").notNull(),
    lastDate: date("last_date").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("ledger_imports_file_uq").on(t.marinaId, t.fileHash)],
);

// Prima nota: entrate e uscite di cassa e banca. Gli incassi vi finiscono in automatico.
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    entryDate: date("entry_date").notNull(),
    direction: ledgerDirectionEnum("direction").notNull(),
    account: ledgerAccountEnum("account").notNull(),
    amountCents: integer("amount_cents").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    counterparty: text("counterparty"),
    documentRef: text("document_ref"),
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "cascade" }),
    importId: uuid("import_id").references(() => ledgerImports.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("ledger_marina_date_idx").on(t.marinaId, t.entryDate),
    uniqueIndex("ledger_payment_uq").on(t.paymentId),
    index("ledger_import_idx").on(t.importId),
  ],
);

// ───────────────────────── Banchina ─────────────────────────

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    kind: taskKindEnum("kind").notNull().default("segnalazione"),
    priority: taskPriorityEnum("priority").notNull().default("normale"),
    status: taskStatusEnum("status").notNull().default("aperta"),
    title: text("title").notNull(),
    description: text("description"),
    berthId: uuid("berth_id").references(() => berths.id, { onDelete: "set null" }),
    boatId: uuid("boat_id").references(() => boats.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    closedBy: uuid("closed_by").references(() => users.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    resolution: text("resolution"),
  },
  (t) => [index("tasks_marina_status_idx").on(t.marinaId, t.status)],
);

// ───────────────────────── Registro delle operazioni ─────────────────────────

// Traccia chi ha creato, modificato, esportato o cancellato dati personali e contabili.
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    summary: text("summary"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_marina_at_idx").on(t.marinaId, t.at)],
);

export type Role = (typeof roleEnum.enumValues)[number];
export type Season = (typeof seasonEnum.enumValues)[number];
export type ContractType = (typeof contractTypeEnum.enumValues)[number];
export type ContractStatus = (typeof contractStatusEnum.enumValues)[number];
export type Presence = (typeof presenceEnum.enumValues)[number];
export type BerthStatus = (typeof berthStatusEnum.enumValues)[number];
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
