ALTER TABLE "marinas" ADD COLUMN "contract_texts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "marinas" ADD COLUMN "contract_summary" boolean DEFAULT true NOT NULL;