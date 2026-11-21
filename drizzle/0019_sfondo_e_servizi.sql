CREATE TABLE "plan_features" (
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
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_features_marina_idx" ON "plan_features" USING btree ("marina_id");