ALTER TABLE "sessions" ADD COLUMN "preview_role" "role";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "preview_owner_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_preview_owner_id_owners_id_fk" FOREIGN KEY ("preview_owner_id") REFERENCES "public"."owners"("id") ON DELETE set null ON UPDATE no action;