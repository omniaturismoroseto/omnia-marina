CREATE TABLE "ledger_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"sheet_name" text NOT NULL,
	"rows_count" integer NOT NULL,
	"entries_count" integer NOT NULL,
	"first_date" date NOT NULL,
	"last_date" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "ledger_imports" ADD CONSTRAINT "ledger_imports_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_imports" ADD CONSTRAINT "ledger_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_imports_file_uq" ON "ledger_imports" USING btree ("marina_id","file_hash");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_import_id_ledger_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."ledger_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_import_idx" ON "ledger_entries" USING btree ("import_id");