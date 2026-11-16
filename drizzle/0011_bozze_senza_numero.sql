ALTER TABLE "contracts" ALTER COLUMN "seq" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ALTER COLUMN "number" DROP NOT NULL;--> statement-breakpoint
-- Le bozze già esistenti perdono il numero: lo riceveranno quando diventano definitive.
UPDATE "contracts" SET "seq" = NULL, "number" = NULL WHERE "status" = 'bozza';
