CREATE TABLE "owner_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "owner_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_invites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "owner_access_id" uuid;--> statement-breakpoint
ALTER TABLE "owner_access" ADD CONSTRAINT "owner_access_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_access" ADD CONSTRAINT "owner_access_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_access" ADD CONSTRAINT "owner_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_access" ADD CONSTRAINT "owner_access_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_invites" ADD CONSTRAINT "owner_invites_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_invites" ADD CONSTRAINT "owner_invites_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_invites" ADD CONSTRAINT "owner_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "owner_access_owner_user_uq" ON "owner_access" USING btree ("owner_id","user_id");--> statement-breakpoint
CREATE INDEX "owner_access_user_idx" ON "owner_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "owner_invites_owner_idx" ON "owner_invites" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_owner_access_id_owner_access_id_fk" FOREIGN KEY ("owner_access_id") REFERENCES "public"."owner_access"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_owner_access_idx" ON "sessions" USING btree ("owner_access_id");