CREATE TABLE "payment_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_payment_id" uuid NOT NULL,
	"dedupe_key" text NOT NULL,
	"kind" text NOT NULL,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"amount_cents" integer,
	"currency" text NOT NULL,
	"provider" text DEFAULT 'bachs' NOT NULL,
	"provider_event_id" text,
	"provider_object_id" text,
	"message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_ledger_entries_kind_allowed" CHECK ("payment_ledger_entries"."kind" in ('checkout', 'customer_payment', 'platform_fee', 'processing_fee', 'settlement', 'refund')),
	CONSTRAINT "payment_ledger_entries_direction_allowed" CHECK ("payment_ledger_entries"."direction" in ('none', 'in', 'out')),
	CONSTRAINT "payment_ledger_entries_status_allowed" CHECK ("payment_ledger_entries"."status" in ('pending', 'succeeded', 'failed', 'expired')),
	CONSTRAINT "payment_ledger_entries_amount_non_negative" CHECK ("payment_ledger_entries"."amount_cents" is null or "payment_ledger_entries"."amount_cents" >= 0),
	CONSTRAINT "payment_ledger_entries_currency_allowed" CHECK ("payment_ledger_entries"."currency" in ('USD', 'NGN')),
	CONSTRAINT "payment_ledger_entries_provider_allowed" CHECK ("payment_ledger_entries"."provider" = 'bachs')
);
--> statement-breakpoint
ALTER TABLE "payment_ledger_entries" ADD CONSTRAINT "payment_ledger_entries_booking_payment_id_booking_payments_id_fk" FOREIGN KEY ("booking_payment_id") REFERENCES "public"."booking_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_ledger_entries_dedupe_key" ON "payment_ledger_entries" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "payment_ledger_entries_payment_occurred_idx" ON "payment_ledger_entries" USING btree ("booking_payment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "payment_ledger_entries_status_occurred_idx" ON "payment_ledger_entries" USING btree ("status","occurred_at");--> statement-breakpoint
CREATE INDEX "payment_ledger_entries_provider_event_idx" ON "payment_ledger_entries" USING btree ("provider","provider_event_id") WHERE "payment_ledger_entries"."provider_event_id" is not null;--> statement-breakpoint
INSERT INTO "payment_ledger_entries" (
	"booking_payment_id", "dedupe_key", "kind", "direction", "status",
	"amount_cents", "currency", "provider_object_id", "message", "metadata", "occurred_at"
)
SELECT
	"id",
	'payment:' || "id"::text || ':imported:' || "status",
	CASE WHEN "status" LIKE 'refund_%' OR "status" = 'refunded' THEN 'refund'
		 WHEN "status" = 'pending' THEN 'checkout' ELSE 'customer_payment' END,
	CASE WHEN "status" LIKE 'refund_%' OR "status" = 'refunded' THEN 'out'
		 WHEN "status" = 'pending' THEN 'none' ELSE 'in' END,
	CASE WHEN "status" IN ('paid', 'refunded') THEN 'succeeded'
		 WHEN "status" = 'pending' OR "status" = 'refund_pending' THEN 'pending'
		 WHEN "status" = 'expired' THEN 'expired' ELSE 'failed' END,
	"amount_cents",
	"currency",
	COALESCE("bachs_charge_id", "bachs_checkout_id"),
	'Imported current payment state during ledger rollout.',
	jsonb_build_object('platformFeeCents', "platform_fee_cents", 'imported', true),
	COALESCE("refunded_at", "paid_at", "updated_at", "created_at")
FROM "booking_payments";--> statement-breakpoint
CREATE FUNCTION reject_payment_ledger_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'payment ledger entries are immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER payment_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON "payment_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION reject_payment_ledger_mutation();
