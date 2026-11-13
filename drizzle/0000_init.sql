CREATE TYPE "public"."berth_side" AS ENUM('sx', 'dx');--> statement-breakpoint
CREATE TYPE "public"."berth_status" AS ENUM('attivo', 'manutenzione', 'fuori_servizio');--> statement-breakpoint
CREATE TYPE "public"."boat_type" AS ENUM('vela', 'motore', 'gommone', 'catamarano', 'altro');--> statement-breakpoint
CREATE TYPE "public"."charge_kind" AS ENUM('ormeggio', 'servizi', 'utenze', 'altro');--> statement-breakpoint
CREATE TYPE "public"."consent_kind" AS ENUM('informativa', 'marketing', 'terzi');--> statement-breakpoint
CREATE TYPE "public"."consent_method" AS ENUM('cartaceo', 'digitale', 'verbale');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('bozza', 'attivo', 'concluso', 'annullato');--> statement-breakpoint
CREATE TYPE "public"."contract_type" AS ENUM('annuale', 'stagionale', 'mensile', 'transito');--> statement-breakpoint
CREATE TYPE "public"."ledger_account" AS ENUM('cassa', 'banca');--> statement-breakpoint
CREATE TYPE "public"."ledger_direction" AS ENUM('entrata', 'uscita');--> statement-breakpoint
CREATE TYPE "public"."movement_kind" AS ENUM('arrivo', 'partenza', 'uscita', 'rientro');--> statement-breakpoint
CREATE TYPE "public"."owner_type" AS ENUM('persona', 'azienda');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('contanti', 'bonifico', 'pos', 'assegno', 'altro');--> statement-breakpoint
CREATE TYPE "public"."presence" AS ENUM('atteso', 'in_porto', 'fuori', 'partito');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'ufficio', 'banchina');--> statement-breakpoint
CREATE TYPE "public"."season" AS ENUM('bassa', 'media', 'alta');--> statement-breakpoint
CREATE TYPE "public"."task_kind" AS ENUM('assistenza', 'manutenzione', 'segnalazione', 'servizio');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('bassa', 'normale', 'alta');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('aperta', 'in_corso', 'chiusa');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"summary" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "berth_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"name" text NOT NULL,
	"max_length_cm" integer NOT NULL,
	"max_beam_cm" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "berths" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"pier_id" uuid NOT NULL,
	"category_id" uuid,
	"code" text NOT NULL,
	"side" "berth_side" DEFAULT 'sx' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"length_cm" integer NOT NULL,
	"beam_cm" integer NOT NULL,
	"draft_cm" integer,
	"has_water" boolean DEFAULT true NOT NULL,
	"has_power" boolean DEFAULT true NOT NULL,
	"status" "berth_status" DEFAULT 'attivo' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "boats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"registration" text,
	"type" "boat_type" DEFAULT 'motore' NOT NULL,
	"builder" text,
	"model" text,
	"year" integer,
	"length_cm" integer NOT NULL,
	"beam_cm" integer NOT NULL,
	"draft_cm" integer,
	"flag" text,
	"engine" text,
	"insurance_company" text,
	"insurance_policy" text,
	"insurance_expiry" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"contract_id" uuid,
	"kind" charge_kind DEFAULT 'ormeggio' NOT NULL,
	"description" text NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"net_cents" integer NOT NULL,
	"vat_rate" integer NOT NULL,
	"vat_cents" integer NOT NULL,
	"gross_cents" integer NOT NULL,
	"cancelled_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"seq" integer NOT NULL,
	"number" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"boat_id" uuid NOT NULL,
	"berth_id" uuid,
	"type" "contract_type" NOT NULL,
	"status" "contract_status" DEFAULT 'bozza' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"occupied_until" date NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"vat_rate" integer DEFAULT 22 NOT NULL,
	"presence" "presence" DEFAULT 'atteso' NOT NULL,
	"checked_in_at" timestamp with time zone,
	"checked_out_at" timestamp with time zone,
	"signed_on" date,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"direction" "ledger_direction" NOT NULL,
	"account" "ledger_account" NOT NULL,
	"amount_cents" integer NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"counterparty" text,
	"document_ref" text,
	"payment_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marinas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"vat_number" text,
	"fiscal_code" text,
	"address" text,
	"zip" text,
	"city" text,
	"province" text,
	"phone" text,
	"email" text,
	"vhf_channel" text,
	"default_vat_rate" integer DEFAULT 22 NOT NULL,
	"privacy_policy_version" text DEFAULT '1.0' NOT NULL,
	"privacy_policy_text" text,
	"contract_terms" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"marina_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"contract_id" uuid,
	"boat_id" uuid NOT NULL,
	"berth_id" uuid,
	"kind" "movement_kind" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"type" "owner_type" DEFAULT 'persona' NOT NULL,
	"first_name" text,
	"last_name" text,
	"company_name" text,
	"display_name" text NOT NULL,
	"fiscal_code" text,
	"vat_number" text,
	"birth_date" date,
	"birth_place" text,
	"address" text,
	"zip" text,
	"city" text,
	"province" text,
	"country" text DEFAULT 'Italia' NOT NULL,
	"phone" text,
	"email" text,
	"pec" text,
	"sdi_code" text,
	"id_doc_type" text,
	"id_doc_number" text,
	"id_doc_expiry" date,
	"notes" text,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "piers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"name" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"vat_rate" integer DEFAULT 22 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" "consent_kind" NOT NULL,
	"granted" boolean NOT NULL,
	"policy_version" text NOT NULL,
	"method" "consent_method" DEFAULT 'cartaceo' NOT NULL,
	"note" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"daily_low" integer DEFAULT 0 NOT NULL,
	"daily_mid" integer DEFAULT 0 NOT NULL,
	"daily_high" integer DEFAULT 0 NOT NULL,
	"monthly_low" integer DEFAULT 0 NOT NULL,
	"monthly_mid" integer DEFAULT 0 NOT NULL,
	"monthly_high" integer DEFAULT 0 NOT NULL,
	"annual" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "season_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"season" "season" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"marina_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"kind" "task_kind" DEFAULT 'segnalazione' NOT NULL,
	"priority" "task_priority" DEFAULT 'normale' NOT NULL,
	"status" "task_status" DEFAULT 'aperta' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"berth_id" uuid,
	"boat_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "berth_categories" ADD CONSTRAINT "berth_categories_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "berths" ADD CONSTRAINT "berths_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "berths" ADD CONSTRAINT "berths_pier_id_piers_id_fk" FOREIGN KEY ("pier_id") REFERENCES "public"."piers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "berths" ADD CONSTRAINT "berths_category_id_berth_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."berth_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boats" ADD CONSTRAINT "boats_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boats" ADD CONSTRAINT "boats_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_boat_id_boats_id_fk" FOREIGN KEY ("boat_id") REFERENCES "public"."boats"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_berth_id_berths_id_fk" FOREIGN KEY ("berth_id") REFERENCES "public"."berths"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_boat_id_boats_id_fk" FOREIGN KEY ("boat_id") REFERENCES "public"."boats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_berth_id_berths_id_fk" FOREIGN KEY ("berth_id") REFERENCES "public"."berths"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owners" ADD CONSTRAINT "owners_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piers" ADD CONSTRAINT "piers_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_consents" ADD CONSTRAINT "privacy_consents_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_consents" ADD CONSTRAINT "privacy_consents_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_consents" ADD CONSTRAINT "privacy_consents_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_category_id_berth_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."berth_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_periods" ADD CONSTRAINT "season_periods_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_periods" ADD CONSTRAINT "season_periods_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_berth_id_berths_id_fk" FOREIGN KEY ("berth_id") REFERENCES "public"."berths"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_boat_id_boats_id_fk" FOREIGN KEY ("boat_id") REFERENCES "public"."boats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_marina_at_idx" ON "audit_log" USING btree ("marina_id","at");--> statement-breakpoint
CREATE INDEX "berth_categories_marina_idx" ON "berth_categories" USING btree ("marina_id");--> statement-breakpoint
CREATE UNIQUE INDEX "berths_marina_code_uq" ON "berths" USING btree ("marina_id","code");--> statement-breakpoint
CREATE INDEX "berths_pier_idx" ON "berths" USING btree ("pier_id");--> statement-breakpoint
CREATE INDEX "boats_marina_name_idx" ON "boats" USING btree ("marina_id","name");--> statement-breakpoint
CREATE INDEX "boats_owner_idx" ON "boats" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "charges_marina_due_idx" ON "charges" USING btree ("marina_id","due_date");--> statement-breakpoint
CREATE INDEX "charges_owner_idx" ON "charges" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "charges_contract_idx" ON "charges" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_marina_number_uq" ON "contracts" USING btree ("marina_id","year","seq");--> statement-breakpoint
CREATE INDEX "contracts_berth_idx" ON "contracts" USING btree ("berth_id","start_date");--> statement-breakpoint
CREATE INDEX "contracts_owner_idx" ON "contracts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "contracts_boat_idx" ON "contracts" USING btree ("boat_id");--> statement-breakpoint
CREATE INDEX "ledger_marina_date_idx" ON "ledger_entries" USING btree ("marina_id","entry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_payment_uq" ON "ledger_entries" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_marina_uq" ON "memberships" USING btree ("user_id","marina_id");--> statement-breakpoint
CREATE INDEX "movements_marina_at_idx" ON "movements" USING btree ("marina_id","at");--> statement-breakpoint
CREATE INDEX "movements_boat_idx" ON "movements" USING btree ("boat_id","at");--> statement-breakpoint
CREATE INDEX "owners_marina_name_idx" ON "owners" USING btree ("marina_id","display_name");--> statement-breakpoint
CREATE INDEX "payments_charge_idx" ON "payments" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "payments_marina_date_idx" ON "payments" USING btree ("marina_id","paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "piers_marina_code_uq" ON "piers" USING btree ("marina_id","code");--> statement-breakpoint
CREATE INDEX "price_lists_marina_idx" ON "price_lists" USING btree ("marina_id","valid_from");--> statement-breakpoint
CREATE INDEX "privacy_consents_owner_idx" ON "privacy_consents" USING btree ("owner_id","kind","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rates_list_category_uq" ON "rates" USING btree ("price_list_id","category_id");--> statement-breakpoint
CREATE INDEX "season_periods_list_idx" ON "season_periods" USING btree ("price_list_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tasks_marina_status_idx" ON "tasks" USING btree ("marina_id","status");