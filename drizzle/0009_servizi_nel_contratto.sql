ALTER TYPE "public"."contract_item_kind" ADD VALUE 'servizio';--> statement-breakpoint
ALTER TABLE "contract_items" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "contract_items" ADD COLUMN "vat_rate" integer;