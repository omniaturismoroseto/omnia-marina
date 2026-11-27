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
  unique,
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
// Voci del contratto oltre al posto barca: spazi a terra, posti auto, carrello e spese fisse.
export const contractItemKindEnum = pgEnum("contract_item_kind", ["secca", "auto_coperto", "auto_scoperto", "carrello", "gestione", "rifiuti", "servizio"]);
export const chargeKindEnum = pgEnum("charge_kind", ["ormeggio", "servizi", "utenze", "altro"]);
export const paymentMethodEnum = pgEnum("payment_method", ["contanti", "bonifico", "pos", "assegno", "altro"]);
export const ledgerDirectionEnum = pgEnum("ledger_direction", ["entrata", "uscita"]);
export const ledgerAccountEnum = pgEnum("ledger_account", ["cassa", "banca"]);
export const taskKindEnum = pgEnum("task_kind", ["assistenza", "manutenzione", "segnalazione", "servizio"]);
export const taskPriorityEnum = pgEnum("task_priority", ["bassa", "normale", "alta"]);
export const taskStatusEnum = pgEnum("task_status", ["aperta", "in_corso", "chiusa"]);
// Messaggi ai diportisti: urgente (meteo, sicurezza: si chiede la conferma di lettura), lavori e disservizi, informazioni.
export const messageKindEnum = pgEnum("message_kind", ["urgente", "lavori", "info"]);

// ───────────────────────── Piattaforma ─────────────────────────

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  // Password dell'accesso locale (scrypt). Vuota per chi è passato a Firebase Authentication.
  passwordHash: text("password_hash"),
  // Identificativo dell'account su Firebase Authentication, quando gli accessi passano da lì.
  firebaseUid: text("firebase_uid").unique(),
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
  // Testo dell'approvazione specifica delle clausole (artt. 1341-1342 c.c.), stampato con una seconda firma.
  contractApprovalText: text("contract_approval_text"),
  // Testi del contratto stampato scelti dal porto (titolo, apertura, articoli 1-3, firme), per chiave di CONTRACT_PARTS
  // (src/lib/contract-texts.ts); una chiave assente = testo predefinito.
  contractTexts: jsonb("contract_texts").$type<Record<string, string>>().notNull().default({}),
  // Riquadro «In sintesi» in testa al contratto stampato.
  contractSummary: boolean("contract_summary").notNull().default(true),
  // Spese di gestione comuni e quota rifiuti proposte nei nuovi contratti annuali.
  serviceFeeCents: integer("service_fee_cents"),
  wasteFeeCents: integer("waste_fee_cents"),
  // Nome della categoria dei clienti senza contratto attivo (owners.former), scelto dalla direzione.
  formerOwnerLabel: text("former_owner_label").notNull().default("Ex cliente"),
  // Pianta dal vero: dimensioni in pixel della foto aerea caricata e scala (pixel per metro).
  // planVersion cambia a ogni nuova foto, così il browser non mostra quella vecchia dalla cache.
  planWidth: integer("plan_width"),
  planHeight: integer("plan_height"),
  planPxPerMeter: real("plan_px_per_meter"),
  planVersion: integer("plan_version").notNull().default(0),
  // Logo della società di gestione (menu dell'app e documenti stampati): dimensioni in pixel dell'immagine
  // salvata in marina_logos; vuote se non c'è. logoVersion cambia a ogni caricamento, per la cache del browser.
  logoWidth: integer("logo_width"),
  logoHeight: integer("logo_height"),
  logoVersion: integer("logo_version").notNull().default(0),
  // Area diportista: orari dell'ufficio e informazioni utili (regolamento, servizi, numeri), scritti dalla direzione.
  officeHours: text("office_hours"),
  boaterInfo: text("boater_info"),
  // Meteo: posizione del porto (gradi decimali) e soglia delle raffiche, in nodi, oltre la quale si propone l'allerta.
  latitude: real("latitude"),
  longitude: real("longitude"),
  windAlertKnots: integer("wind_alert_knots").notNull().default(30),
  // Soglia dell'onda significativa, in metri, oltre la quale si propone l'avviso.
  waveAlertM: real("wave_alert_m").notNull().default(2),
  // Zona di allerta della Protezione Civile scelta a mano; vuota = quella che contiene il Comune del porto.
  alertZone: text("alert_zone"),
  // Invio automatico dell'allerta (serve il controllo periodico, vedi COME-LAVORIAMO.md) e ultimo invio, per non ripeterla.
  windAlertAuto: boolean("wind_alert_auto").notNull().default(false),
  windAlertSentAt: timestamp("wind_alert_sent_at", { withTimezone: true }),
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

// Base disegnata dello schema della mappa (fatta fuori dall'app ricalcando la foto aerea, stessa inquadratura):
// se c'è, lo schema la usa come sfondo al posto del disegno automatico. Solo PNG o JPEG.
export const marinaPlanBases = pgTable("marina_plan_bases", {
  marinaId: uuid("marina_id")
    .primaryKey()
    .references(() => marinas.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  data: bytea("data").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  updatedAt: updatedAt(),
});

// Sfondo dello schema della mappa e servizi del porto, in pixel della foto aerea.
// kind: terra (moli, banchine, piazzali), acqua (toglie terra), edificio, verde, servizio (un punto con il tipo in `service`).
// source: da dove viene (manuale, colori = ricavato dai colori della foto, claude = proposto dal riconoscimento automatico).
export const planFeatures = pgTable(
  "plan_features",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"terra" | "acqua" | "edificio" | "verde" | "servizio">().notNull(),
    service: text("service"),
    name: text("name"),
    points: jsonb("points").$type<{ x: number; y: number }[]>().notNull(),
    source: text("source").$type<"manuale" | "colori" | "claude">().notNull().default("manuale"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("plan_features_marina_idx").on(t.marinaId)],
);

// L'immagine del logo, a parte: le letture di marinas restano leggere.
export const marinaLogos = pgTable("marina_logos", {
  marinaId: uuid("marina_id")
    .primaryKey()
    .references(() => marinas.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  data: bytea("data").notNull(),
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
    // Valorizzato quando la sessione è nell'area diportista: vale solo per quel cliente, mai per il gestionale.
    ownerAccessId: uuid("owner_access_id").references(() => ownerAccess.id, { onDelete: "cascade" }),
    // Solo per l'account manager, che prova l'app nei panni degli altri: il ruolo scelto nel porto (vuoto = Direzione)
    // oppure il cliente di cui vede l'area diportista. Per tutti gli altri restano vuoti e non contano.
    previewRole: roleEnum("preview_role"),
    previewOwnerId: uuid("preview_owner_id").references(() => owners.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_owner_access_idx").on(t.ownerAccessId)],
);

// ───────────────────────── Anagrafiche ─────────────────────────

// Un'importazione di clienti (e barche) da Excel: quante righe, quanti clienti creati o completati, quante barche.
// Annullarla cancella i clienti e le barche che ha creato e che non hanno contratti.
export const ownerImports = pgTable(
  "owner_imports",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    sheetName: text("sheet_name").notNull(),
    rowsCount: integer("rows_count").notNull(),
    ownersCreated: integer("owners_created").notNull(),
    ownersUpdated: integer("owners_updated").notNull(),
    boatsCreated: integer("boats_created").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("owner_imports_marina_idx").on(t.marinaId, t.createdAt)],
);

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
    // Categoria «Ex cliente» (nome in marinas.former_owner_label): solo per chi non ha contratti attivi;
    // si toglie da sola quando il cliente ha di nuovo un contratto attivo.
    former: boolean("former").notNull().default(false),
    // Importazione da Excel che ha creato il cliente: serve ad annullarla.
    importId: uuid("import_id").references(() => ownerImports.id, { onDelete: "set null" }),
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("owners_marina_name_idx").on(t.marinaId, t.displayName), index("owners_marina_fiscal_idx").on(t.marinaId, t.fiscalCode)],
);

// Messaggi dal porto ai diportisti. I destinatari (clienti) si fissano all'invio in message_recipients: chi arriva
// dopo non riceve i messaggi vecchi. `audience` descrive a chi è andato («Pontile A», «Tutti i clienti»).
export const messages = pgTable(
  "messages",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id").references(() => users.id, { onDelete: "set null" }),
    kind: messageKindEnum("kind").notNull().default("info"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    audience: text("audience").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("messages_marina_created_idx").on(t.marinaId, t.createdAt)],
);

// Un destinatario per cliente: basta che una delle persone con accesso lo legga.
export const messageRecipients = pgTable(
  "message_recipients",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }),
    readBy: uuid("read_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("message_recipients_uq").on(t.messageId, t.ownerId), index("message_recipients_owner_idx").on(t.ownerId)],
);

// Notifiche sul telefono (web push): un'iscrizione per dispositivo e browser in cui la persona le ha attivate.
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);

// Area diportista. Un invito nasce dalla scheda del cliente: il codice (8 caratteri) si consegna su carta o con un
// messaggio, vale 30 giorni e una volta sola. Resta leggibile all'ufficio finché è in attesa, poi si cancella.
export const ownerInvites = pgTable(
  "owner_invites",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "cascade" }),
    // Persona invitata (il titolare, un familiare, uno skipper): diventa il nome del nuovo account.
    name: text("name").notNull(),
    code: text("code").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Tentativi con codice fiscale / partita IVA sbagliati: oltre il limite l'invito si blocca.
    failedAttempts: integer("failed_attempts").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("owner_invites_owner_idx").on(t.ownerId)],
);

// Chi può entrare nell'area diportista di un cliente. Revocare non cancella: resta la storia e si può riattivare
// con un nuovo invito.
export const ownerAccess = pgTable(
  "owner_access",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    // Informativa privacy dell'app accettata al primo accesso: quando e quale versione (informativa del porto + parte
    // sull'app, vedi appPrivacyVersion). Se il porto cambia versione, all'accesso successivo si chiede di nuovo.
    privacyAcceptedAt: timestamp("privacy_accepted_at", { withTimezone: true }),
    privacyVersion: text("privacy_version"),
  },
  (t) => [uniqueIndex("owner_access_owner_user_uq").on(t.ownerId, t.userId), index("owner_access_user_idx").on(t.userId)],
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
    // Descrizione libera, per quanto non sta nei campi del motore.
    engine: text("engine"),
    declaredValueCents: integer("declared_value_cents"),
    engineCount: integer("engine_count"),
    engineType: text("engine_type"),
    engineBrand: text("engine_brand"),
    enginePowerHp: integer("engine_power_hp"),
    auxEngineCount: integer("aux_engine_count"),
    auxEngineType: text("aux_engine_type"),
    auxEngineBrand: text("aux_engine_brand"),
    auxEnginePowerHp: integer("aux_engine_power_hp"),
    insuranceCompany: text("insurance_company"),
    insurancePolicy: text("insurance_policy"),
    insuranceExpiry: date("insurance_expiry"),
    notes: text("notes"),
    importId: uuid("import_id").references(() => ownerImports.id, { onDelete: "set null" }),
    // Foto della barca (in boat_photos): hasPhoto dice se c'è, photoVersion cambia a ogni caricamento o rimozione
    // e finisce nell'indirizzo dell'immagine, così il browser non mostra una copia vecchia.
    hasPhoto: boolean("has_photo").notNull().default(false),
    photoVersion: integer("photo_version").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("boats_marina_name_idx").on(t.marinaId, t.name), index("boats_owner_idx").on(t.ownerId)],
);

// Foto della barca, caricata dall'ufficio o scattata in banchina (JPEG già ridotto nel browser).
export const boatPhotos = pgTable("boat_photos", {
  boatId: uuid("boat_id")
    .primaryKey()
    .references(() => boats.id, { onDelete: "cascade" }),
  marinaId: uuid("marina_id")
    .notNull()
    .references(() => marinas.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  data: bytea("data").notNull(),
  updatedAt: updatedAt(),
});

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
    // Acceso: il pontile usa la tariffa base del listino; spento: usa i prezzi propri (rates.pier_id).
    baseRate: boolean("base_rate").notNull().default(true),
    // Linea tracciata sulla foto (pixel), dalla radice (a) alla testata (b), e larghezza della passerella in metri
    // (0 = banchina): serve a disegnare il pontile nello schema. Vuota se il pontile non è mai stato tracciato.
    planAx: real("plan_ax"),
    planAy: real("plan_ay"),
    planBx: real("plan_bx"),
    planBy: real("plan_by"),
    planWidthM: real("plan_width_m"),
  },
  (t) => [uniqueIndex("piers_marina_code_uq").on(t.marinaId, t.code)],
);

// Tratti di un pontile unito ad altri (Impostazioni → Pontili e posti → «Unisci»): per la gestione il pontile è uno solo,
// sulla pianta ogni tratto ha la sua linea e i suoi posti (berths.section_id) e si sposta, ruota e traccia da solo.
export const pierSections = pgTable(
  "pier_sections",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    pierId: uuid("pier_id")
      .notNull()
      .references(() => piers.id, { onDelete: "cascade" }),
    // Sigla del pontile da cui viene il tratto (es. CN): serve a riconoscerlo nell'editor della pianta.
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    // Come in piers: linea dalla radice (a) alla testata (b) sulla foto e larghezza della passerella (0 = banchina).
    planAx: real("plan_ax"),
    planAy: real("plan_ay"),
    planBx: real("plan_bx"),
    planBy: real("plan_by"),
    planWidthM: real("plan_width_m"),
  },
  (t) => [index("pier_sections_pier_idx").on(t.pierId)],
);

// Nome dato a un modulo della pianta (berths.plan_module) di un pontile o di un suo tratto, per riconoscerlo meglio
// (es. «Testata», «Lato bar»). Senza nome il modulo si chiama «Modulo 1», «Modulo 2»…
export const berthModules = pgTable(
  "berth_modules",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    pierId: uuid("pier_id")
      .notNull()
      .references(() => piers.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id").references(() => pierSections.id, { onDelete: "cascade" }),
    module: integer("module").notNull(),
    name: text("name").notNull(),
  },
  (t) => [unique("berth_modules_unit_module_uq").on(t.pierId, t.sectionId, t.module).nullsNotDistinct()],
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
    // Tratto del pontile sulla pianta (solo per i pontili uniti); vuoto = il posto segue la linea del pontile.
    sectionId: uuid("section_id").references(() => pierSections.id, { onDelete: "set null" }),
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
    // Modulo della pianta (pezzo staccato di un pontile o tratto): riconosciuto una volta dalle posizioni e poi fisso, così due
    // moduli avvicinati restano separati. Vuoto = ancora da riconoscere (lo fa l'editor della Mappa del porto).
    planModule: integer("plan_module"),
  },
  (t) => [uniqueIndex("berths_marina_code_uq").on(t.marinaId, t.code), index("berths_pier_idx").on(t.pierId)],
);

// Posti auto riservati del porto: si dispongono sulla mappa come i posti barca e si assegnano nelle voci «posto auto» dei contratti.
export const parkingSpaces = pgTable(
  "parking_spaces",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    // Coperto o scoperto: corrisponde alla voce del contratto (auto_coperto / auto_scoperto).
    covered: boolean("covered").notNull().default(false),
    lengthCm: integer("length_cm").notNull().default(500),
    widthCm: integer("width_cm").notNull().default(250),
    // Fuori servizio: resta sulla mappa ma non si assegna.
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    // Come per i posti barca: centro in pixel della foto e rotazione in gradi (a 0° il lato lungo è verticale); vuoti = non sulla mappa.
    planX: real("plan_x"),
    planY: real("plan_y"),
    planAngle: real("plan_angle"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("parking_spaces_marina_code_uq").on(t.marinaId, t.code)],
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
    vatRate: integer("vat_rate").notNull().default(22),
    // Acceso: i prezzi del listino (tariffe e servizi) comprendono l'IVA; spento: sono netti e l'IVA si aggiunge.
    vatIncluded: boolean("vat_included").notNull().default(true),
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
    // Vuoto = tariffa base. Nelle righe di un pontile gli importi a zero significano «come la tariffa base».
    pierId: uuid("pier_id").references(() => piers.id, { onDelete: "cascade" }),
    dailyLow: integer("daily_low").notNull().default(0),
    dailyMid: integer("daily_mid").notNull().default(0),
    dailyHigh: integer("daily_high").notNull().default(0),
    monthlyLow: integer("monthly_low").notNull().default(0),
    monthlyMid: integer("monthly_mid").notNull().default(0),
    monthlyHigh: integer("monthly_high").notNull().default(0),
    annual: integer("annual").notNull().default(0),
    // Canone fisso per i contratti stagionali; a zero si calcola dalle tariffe mensili.
    seasonal: integer("seasonal").notNull().default(0),
    // Contributo rifiuti aggiunto ai contratti annuali.
    waste: integer("waste").notNull().default(0),
    // Condominio (spese di gestione comuni) proposto nei contratti annuali.
    service: integer("service").notNull().default(0),
  },
  // Una sola riga per listino, categoria e pontile; la riga della tariffa base (pontile vuoto) è unica anch'essa.
  (t) => [unique("rates_list_category_pier_uq").on(t.priceListId, t.categoryId, t.pierId).nullsNotDistinct()],
);

// Servizi a prezzo fisso del listino (posti auto, carrelli, cauzioni…), da proporre negli addebiti.
// Se collegati a un tipo di voce del contratto (es. posto auto coperto), ne propongono anche l'importo.
export const priceListExtras = pgTable(
  "price_list_extras",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    priceListId: uuid("price_list_id")
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    amountCents: integer("amount_cents").notNull(),
    vatRate: integer("vat_rate").notNull().default(22),
    itemKind: contractItemKindEnum("item_kind"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("price_list_extras_list_idx").on(t.priceListId)],
);

// ───────────────────────── Contratti e movimenti ─────────────────────────

export const contracts = pgTable(
  "contracts",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    // Le bozze non hanno numero: seq e number nascono quando il contratto diventa definitivo (attivo) e prendono
    // il numero libero più basso dell'anno, così un numero lasciato da un contratto tornato in bozza viene ripreso.
    year: integer("year").notNull(),
    seq: integer("seq"),
    number: text("number"),
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

// Voci aggiuntive del contratto. Ognuna ha il suo addebito, creato quando il contratto è attivo.
export const contractItems = pgTable(
  "contract_items",
  {
    id: id(),
    marinaId: uuid("marina_id")
      .notNull()
      .references(() => marinas.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    kind: contractItemKindEnum("kind").notNull(),
    // Numero del posto auto o altro riferimento (per i posti auto della mappa, il loro codice al momento della scelta).
    reference: text("reference"),
    // Posto auto della mappa assegnato con questa voce (solo auto_coperto / auto_scoperto); vuoto = scritto a mano.
    parkingSpaceId: uuid("parking_space_id").references(() => parkingSpaces.id, { onDelete: "restrict" }),
    // Periodo per gli spazi; vuoto per le spese fisse. annual: spazio preso per l'anno solare (fino al 31 dicembre)
    // (la fine è il giorno prima dello stesso giorno dell'anno dopo), come si stampa nel contratto.
    startDate: date("start_date"),
    endDate: date("end_date"),
    annual: boolean("annual").notNull().default(false),
    amountCents: integer("amount_cents").notNull(),
    // Solo per i servizi (cauzioni e altri servizi del listino): descrizione e aliquota propria (0 = senza IVA).
    // Vuote per le altre voci, che usano il nome della voce e l'aliquota del contratto.
    description: text("description"),
    vatRate: integer("vat_rate"),
    chargeId: uuid("charge_id").references(() => charges.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("contract_items_contract_idx").on(t.contractId), index("contract_items_parking_idx").on(t.parkingSpaceId)],
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
export type ContractItemKind = (typeof contractItemKindEnum.enumValues)[number];
export type ContractStatus = (typeof contractStatusEnum.enumValues)[number];
export type Presence = (typeof presenceEnum.enumValues)[number];
export type BerthStatus = (typeof berthStatusEnum.enumValues)[number];
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
