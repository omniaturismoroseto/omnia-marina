CREATE TABLE "marina_logos" (
	"marina_id" uuid PRIMARY KEY NOT NULL,
	"mime" text NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marinas" ADD COLUMN "logo_width" integer;--> statement-breakpoint
ALTER TABLE "marinas" ADD COLUMN "logo_height" integer;--> statement-breakpoint
ALTER TABLE "marinas" ADD COLUMN "logo_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "marina_logos" ADD CONSTRAINT "marina_logos_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;