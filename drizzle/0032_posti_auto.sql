CREATE TABLE "parking_spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marina_id" uuid NOT NULL,
	"code" text NOT NULL,
	"covered" boolean DEFAULT false NOT NULL,
	"length_cm" integer DEFAULT 500 NOT NULL,
	"width_cm" integer DEFAULT 250 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"plan_x" real,
	"plan_y" real,
	"plan_angle" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_items" ADD COLUMN "parking_space_id" uuid;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD CONSTRAINT "parking_spaces_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "parking_spaces_marina_code_uq" ON "parking_spaces" USING btree ("marina_id","code");--> statement-breakpoint
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_parking_space_id_parking_spaces_id_fk" FOREIGN KEY ("parking_space_id") REFERENCES "public"."parking_spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_items_parking_idx" ON "contract_items" USING btree ("parking_space_id");