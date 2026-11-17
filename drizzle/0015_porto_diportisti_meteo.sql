ALTER TABLE "marinas" ADD COLUMN "office_hours" text;--> statement-breakpoint
ALTER TABLE "marinas" ADD COLUMN "boater_info" text;--> statement-breakpoint
ALTER TABLE "marinas" ADD COLUMN "latitude" real;--> statement-breakpoint
ALTER TABLE "marinas" ADD COLUMN "longitude" real;--> statement-breakpoint
ALTER TABLE "marinas" ADD COLUMN "wind_alert_knots" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "marinas" ADD COLUMN "wind_alert_auto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "marinas" ADD COLUMN "wind_alert_sent_at" timestamp with time zone;