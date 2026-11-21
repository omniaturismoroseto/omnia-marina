ALTER TABLE "price_lists" ADD COLUMN "vat_included" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rates" ADD COLUMN "service" integer DEFAULT 0 NOT NULL;