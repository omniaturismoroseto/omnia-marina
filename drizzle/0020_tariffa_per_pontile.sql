ALTER TABLE "piers" ADD COLUMN "base_rate" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rates" ADD COLUMN "pier_id" uuid;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_pier_id_piers_id_fk" FOREIGN KEY ("pier_id") REFERENCES "public"."piers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Dalle zone ai pontili: ogni pontile di una zona riceve una copia dei prezzi della zona e smette di usare la tariffa base.
ALTER TABLE "rates" DROP CONSTRAINT "rates_list_category_zone_uq";--> statement-breakpoint
INSERT INTO "rates" ("marina_id", "price_list_id", "category_id", "pier_id", "daily_low", "daily_mid", "daily_high", "monthly_low", "monthly_mid", "monthly_high", "annual", "seasonal", "waste")
SELECT r."marina_id", r."price_list_id", r."category_id", p."id", r."daily_low", r."daily_mid", r."daily_high", r."monthly_low", r."monthly_mid", r."monthly_high", r."annual", r."seasonal", r."waste"
FROM "rates" r JOIN "piers" p ON p."tariff_zone_id" = r."zone_id" AND p."marina_id" = r."marina_id";--> statement-breakpoint
UPDATE "piers" SET "base_rate" = ("tariff_zone_id" IS NULL);--> statement-breakpoint
DELETE FROM "rates" WHERE "zone_id" IS NOT NULL;
