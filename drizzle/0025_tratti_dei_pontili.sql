CREATE TABLE "pier_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"pier_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"plan_ax" real,
	"plan_ay" real,
	"plan_bx" real,
	"plan_by" real,
	"plan_width_m" real
);
--> statement-breakpoint
ALTER TABLE "berths" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "pier_sections" ADD CONSTRAINT "pier_sections_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pier_sections" ADD CONSTRAINT "pier_sections_pier_id_piers_id_fk" FOREIGN KEY ("pier_id") REFERENCES "public"."piers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pier_sections_pier_idx" ON "pier_sections" USING btree ("pier_id");--> statement-breakpoint
ALTER TABLE "berths" ADD CONSTRAINT "berths_section_id_pier_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."pier_sections"("id") ON DELETE set null ON UPDATE no action;