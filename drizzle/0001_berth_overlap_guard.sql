-- Impedisce a livello di database che due contratti attivi (o conclusi) occupino
-- lo stesso posto barca in periodi sovrapposti.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_period_valid" CHECK ("occupied_until" > "start_date" AND "end_date" >= "start_date");
--> statement-breakpoint
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_berth_no_overlap"
  EXCLUDE USING gist (
    "berth_id" WITH =,
    daterange("start_date", "occupied_until", '[)') WITH &&
  )
  WHERE ("berth_id" IS NOT NULL AND "status" IN ('attivo', 'concluso'));
--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_amounts_valid" CHECK ("gross_cents" = "net_cents" + "vat_cents" AND "gross_cents" >= 0);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount_cents" > 0);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_amount_positive" CHECK ("amount_cents" > 0);
