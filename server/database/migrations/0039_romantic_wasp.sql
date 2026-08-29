-- A webhook and browser reconciliation previously used different delivery IDs
-- for the same charge. Remove only the duplicate derived rows before enforcing
-- the financial identity invariant; prefer the provider-event copy because it
-- normally carries the richest settlement metadata.
DROP TRIGGER IF EXISTS payment_ledger_entries_immutable ON "payment_ledger_entries";--> statement-breakpoint
WITH ranked_successes AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "booking_payment_id", "kind"
			ORDER BY
				("provider_event_id" IS NOT NULL) DESC,
				("metadata" <> '{}'::jsonb) DESC,
				"occurred_at" ASC,
				"created_at" ASC,
				"id" ASC
		) AS duplicate_number
	FROM "payment_ledger_entries"
	WHERE "status" = 'succeeded'
		AND "kind" IN ('customer_payment', 'platform_fee', 'processing_fee', 'settlement')
)
DELETE FROM "payment_ledger_entries"
WHERE "id" IN (
	SELECT "id" FROM ranked_successes WHERE duplicate_number > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "payment_ledger_entries_success_kind_key" ON "payment_ledger_entries" USING btree ("booking_payment_id","kind") WHERE "payment_ledger_entries"."status" = 'succeeded' and "payment_ledger_entries"."kind" in ('customer_payment', 'platform_fee', 'processing_fee', 'settlement');--> statement-breakpoint
CREATE TRIGGER payment_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON "payment_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION reject_payment_ledger_mutation();
