CREATE TABLE IF NOT EXISTS "plan_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"service" text,
	"name" text,
	"points" jsonb NOT NULL,
	"source" text DEFAULT 'manuale' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_features_marina_id_marinas_id_fk') THEN
		ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_features_marina_idx" ON "plan_features" USING btree ("marina_id");
