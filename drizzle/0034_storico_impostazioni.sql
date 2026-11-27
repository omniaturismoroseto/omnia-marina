CREATE TABLE "settings_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"user_id" uuid,
	"area" text NOT NULL,
	"target_id" uuid NOT NULL,
	"label" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"undone" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings_history" ADD CONSTRAINT "settings_history_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings_history" ADD CONSTRAINT "settings_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settings_history_target_idx" ON "settings_history" USING btree ("marina_id","area","target_id","created_at");