CREATE TABLE "marina_plans" (
	"marina_id" uuid PRIMARY KEY NOT NULL,
	"mime" text NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "berths" ADD COLUMN "plan_x" real;--> statement-breakpoint
ALTER TABLE "berths" ADD COLUMN "plan_y" real;--> statement-breakpoint
ALTER TABLE "berths" ADD COLUMN "plan_angle" real;--> statement-breakpoint
ALTER TABLE "marinas" ADD COLUMN "plan_width" integer;--> statement-breakpoint
ALTER TABLE "marinas" ADD COLUMN "plan_height" integer;--> statement-breakpoint
ALTER TABLE "marinas" ADD COLUMN "plan_px_per_meter" real;--> statement-breakpoint
ALTER TABLE "marinas" ADD COLUMN "plan_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "marina_plans" ADD CONSTRAINT "marina_plans_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;