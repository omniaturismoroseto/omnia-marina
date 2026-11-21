ALTER TABLE "piers" DROP CONSTRAINT IF EXISTS "piers_tariff_zone_id_tariff_zones_id_fk";--> statement-breakpoint
ALTER TABLE "rates" DROP CONSTRAINT IF EXISTS "rates_zone_id_tariff_zones_id_fk";--> statement-breakpoint
ALTER TABLE "rates" DROP CONSTRAINT IF EXISTS "rates_list_category_zone_uq";--> statement-breakpoint
ALTER TABLE "piers" DROP COLUMN "tariff_zone_id";--> statement-breakpoint
ALTER TABLE "rates" DROP COLUMN "zone_id";--> statement-breakpoint
DROP TABLE "tariff_zones";--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_list_category_pier_uq" UNIQUE NULLS NOT DISTINCT("price_list_id","category_id","pier_id");
