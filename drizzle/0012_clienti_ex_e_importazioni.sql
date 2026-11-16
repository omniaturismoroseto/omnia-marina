CREATE TABLE "owner_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"sheet_name" text NOT NULL,
	"rows_count" integer NOT NULL,
	"owners_created" integer NOT NULL,
	"owners_updated" integer NOT NULL,
	"boats_created" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boats" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "marinas" ADD COLUMN "former_owner_label" text DEFAULT 'Ex cliente' NOT NULL;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "former" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "owner_imports" ADD CONSTRAINT "owner_imports_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_imports" ADD CONSTRAINT "owner_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "owner_imports_marina_idx" ON "owner_imports" USING btree ("marina_id","created_at");--> statement-breakpoint
ALTER TABLE "boats" ADD CONSTRAINT "boats_import_id_owner_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."owner_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owners" ADD CONSTRAINT "owners_import_id_owner_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."owner_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "owners_marina_fiscal_idx" ON "owners" USING btree ("marina_id","fiscal_code");