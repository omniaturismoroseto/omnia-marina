ALTER TABLE "price_lists" ADD COLUMN IF NOT EXISTS "vat_included" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rates" ADD COLUMN IF NOT EXISTS "service" integer DEFAULT 0 NOT NULL;
