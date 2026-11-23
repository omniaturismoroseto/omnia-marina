ALTER TABLE "owner_access" ADD COLUMN "privacy_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "owner_access" ADD COLUMN "privacy_version" text;