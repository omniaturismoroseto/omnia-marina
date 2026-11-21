-- Riallinea il database qualunque versione sia stata pubblicata prima (mappa e tariffe per pontile sono nate su rami
-- diversi e le loro migrazioni sono state rinumerate): ripete, senza effetti se già fatte, le migrazioni 0018-0022.
-- Serve perché drizzle applica solo le migrazioni più recenti dell'ultima registrata nel database.
ALTER TABLE "piers" ADD COLUMN IF NOT EXISTS "plan_ax" real;--> statement-breakpoint
ALTER TABLE "piers" ADD COLUMN IF NOT EXISTS "plan_ay" real;--> statement-breakpoint
ALTER TABLE "piers" ADD COLUMN IF NOT EXISTS "plan_bx" real;--> statement-breakpoint
ALTER TABLE "piers" ADD COLUMN IF NOT EXISTS "plan_by" real;--> statement-breakpoint
ALTER TABLE "piers" ADD COLUMN IF NOT EXISTS "plan_width_m" real;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"service" text,
	"name" text,
	"points" jsonb NOT NULL,
	"source" text DEFAULT 'manuale' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_features_marina_id_marinas_id_fk') THEN
		ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_features_marina_idx" ON "plan_features" USING btree ("marina_id");

--> statement-breakpoint
ALTER TABLE "piers" ADD COLUMN IF NOT EXISTS "base_rate" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rates" ADD COLUMN IF NOT EXISTS "pier_id" uuid;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rates_pier_id_piers_id_fk') THEN
		ALTER TABLE "rates" ADD CONSTRAINT "rates_pier_id_piers_id_fk" FOREIGN KEY ("pier_id") REFERENCES "public"."piers"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
-- Dalle zone ai pontili: ogni pontile di una zona riceve una copia dei prezzi della zona e smette di usare la tariffa base.
-- Solo se le zone ci sono ancora: la migrazione si può ripetere senza danni.
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rates' AND column_name = 'zone_id') THEN
		ALTER TABLE "rates" DROP CONSTRAINT IF EXISTS "rates_list_category_zone_uq";
		INSERT INTO "rates" ("marina_id", "price_list_id", "category_id", "pier_id", "daily_low", "daily_mid", "daily_high", "monthly_low", "monthly_mid", "monthly_high", "annual", "seasonal", "waste")
		SELECT r."marina_id", r."price_list_id", r."category_id", p."id", r."daily_low", r."daily_mid", r."daily_high", r."monthly_low", r."monthly_mid", r."monthly_high", r."annual", r."seasonal", r."waste"
		FROM "rates" r JOIN "piers" p ON p."tariff_zone_id" = r."zone_id" AND p."marina_id" = r."marina_id";
		UPDATE "piers" SET "base_rate" = ("tariff_zone_id" IS NULL);
		DELETE FROM "rates" WHERE "zone_id" IS NOT NULL;
	END IF;
END $$;

--> statement-breakpoint
ALTER TABLE "piers" DROP CONSTRAINT IF EXISTS "piers_tariff_zone_id_tariff_zones_id_fk";--> statement-breakpoint
ALTER TABLE "rates" DROP CONSTRAINT IF EXISTS "rates_zone_id_tariff_zones_id_fk";--> statement-breakpoint
ALTER TABLE "rates" DROP CONSTRAINT IF EXISTS "rates_list_category_zone_uq";--> statement-breakpoint
ALTER TABLE "piers" DROP COLUMN IF EXISTS "tariff_zone_id";--> statement-breakpoint
ALTER TABLE "rates" DROP COLUMN IF EXISTS "zone_id";--> statement-breakpoint
DROP TABLE IF EXISTS "tariff_zones";--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rates_list_category_pier_uq') THEN
		ALTER TABLE "rates" ADD CONSTRAINT "rates_list_category_pier_uq" UNIQUE NULLS NOT DISTINCT("price_list_id","category_id","pier_id");
	END IF;
END $$;

--> statement-breakpoint
ALTER TABLE "price_lists" ADD COLUMN IF NOT EXISTS "vat_included" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rates" ADD COLUMN IF NOT EXISTS "service" integer DEFAULT 0 NOT NULL;
