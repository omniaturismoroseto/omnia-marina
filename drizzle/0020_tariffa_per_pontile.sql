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
