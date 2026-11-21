CREATE TABLE IF NOT EXISTS "marina_plan_bases" (
	"marina_id" uuid PRIMARY KEY NOT NULL,
	"mime" text NOT NULL,
	"data" "bytea" NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marina_plan_bases_marina_id_marinas_id_fk') THEN
		ALTER TABLE "marina_plan_bases" ADD CONSTRAINT "marina_plan_bases_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;