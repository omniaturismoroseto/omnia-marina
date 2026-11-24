CREATE TABLE "berth_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"pier_id" uuid NOT NULL,
	"section_id" uuid,
	"module" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "berth_modules_unit_module_uq" UNIQUE NULLS NOT DISTINCT("pier_id","section_id","module")
);
--> statement-breakpoint
ALTER TABLE "berth_modules" ADD CONSTRAINT "berth_modules_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "berth_modules" ADD CONSTRAINT "berth_modules_pier_id_piers_id_fk" FOREIGN KEY ("pier_id") REFERENCES "public"."piers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "berth_modules" ADD CONSTRAINT "berth_modules_section_id_pier_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."pier_sections"("id") ON DELETE cascade ON UPDATE no action;