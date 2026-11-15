CREATE TABLE "tariff_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "rates_list_category_uq";--> statement-breakpoint
ALTER TABLE "piers" ADD COLUMN "tariff_zone_id" uuid;--> statement-breakpoint
ALTER TABLE "rates" ADD COLUMN "zone_id" uuid;--> statement-breakpoint
ALTER TABLE "rates" ADD COLUMN "seasonal" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rates" ADD COLUMN "waste" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tariff_zones" ADD CONSTRAINT "tariff_zones_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tariff_zones_marina_name_uq" ON "tariff_zones" USING btree ("marina_id","name");--> statement-breakpoint
ALTER TABLE "piers" ADD CONSTRAINT "piers_tariff_zone_id_tariff_zones_id_fk" FOREIGN KEY ("tariff_zone_id") REFERENCES "public"."tariff_zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_zone_id_tariff_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."tariff_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_list_category_zone_uq" UNIQUE NULLS NOT DISTINCT("price_list_id","category_id","zone_id");