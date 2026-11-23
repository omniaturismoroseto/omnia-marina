CREATE TABLE "boat_photos" (
	"boat_id" uuid PRIMARY KEY NOT NULL,
	"marina_id" uuid NOT NULL,
	"mime" text NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boats" ADD COLUMN "has_photo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "boats" ADD COLUMN "photo_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "boat_photos" ADD CONSTRAINT "boat_photos_boat_id_boats_id_fk" FOREIGN KEY ("boat_id") REFERENCES "public"."boats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boat_photos" ADD CONSTRAINT "boat_photos_marina_id_marinas_id_fk" FOREIGN KEY ("marina_id") REFERENCES "public"."marinas"("id") ON DELETE cascade ON UPDATE no action;