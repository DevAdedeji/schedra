CREATE TABLE "payment_withdrawals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipient_id" uuid NOT NULL,
	"requested_by_user_id" uuid,
	"reference" text NOT NULL,
	"bachs_payout_id" text,
	"destination_id" text NOT NULL,
	"destination_name" text NOT NULL,
	"source_currency" text NOT NULL,
	"destination_currency" text NOT NULL,
	"requested_amount_cents" integer NOT NULL,
	"delivered_amount_cents" integer,
	"fee_cents" integer,
	"total_debited_cents" integer,
	"status" text DEFAULT 'creating' NOT NULL,
	"failure_reason" text,
	"provider_event_id" text,
	"last_checked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_withdrawals_status_allowed" CHECK ("payment_withdrawals"."status" in ('creating', 'pending', 'processing', 'completed', 'failed', 'unknown')),
	CONSTRAINT "payment_withdrawals_requested_amount_positive" CHECK ("payment_withdrawals"."requested_amount_cents" > 0),
	CONSTRAINT "payment_withdrawals_delivered_amount_positive" CHECK ("payment_withdrawals"."delivered_amount_cents" is null or "payment_withdrawals"."delivered_amount_cents" > 0),
	CONSTRAINT "payment_withdrawals_fee_non_negative" CHECK ("payment_withdrawals"."fee_cents" is null or "payment_withdrawals"."fee_cents" >= 0),
	CONSTRAINT "payment_withdrawals_total_debited_positive" CHECK ("payment_withdrawals"."total_debited_cents" is null or "payment_withdrawals"."total_debited_cents" > 0),
	CONSTRAINT "payment_withdrawals_source_currency_allowed" CHECK ("payment_withdrawals"."source_currency" in ('USD', 'NGN')),
	CONSTRAINT "payment_withdrawals_destination_currency_allowed" CHECK ("payment_withdrawals"."destination_currency" in ('USD', 'NGN'))
);
--> statement-breakpoint
ALTER TABLE "payment_withdrawals" ADD CONSTRAINT "payment_withdrawals_recipient_id_payment_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."payment_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_withdrawals" ADD CONSTRAINT "payment_withdrawals_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_withdrawals_reference_key" ON "payment_withdrawals" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_withdrawals_bachs_payout_key" ON "payment_withdrawals" USING btree ("bachs_payout_id") WHERE "payment_withdrawals"."bachs_payout_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_withdrawals_recipient_created_idx" ON "payment_withdrawals" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_withdrawals_status_checked_idx" ON "payment_withdrawals" USING btree ("status","last_checked_at");--> statement-breakpoint
CREATE TRIGGER schedra_set_updated_at
BEFORE UPDATE ON "payment_withdrawals"
FOR EACH ROW EXECUTE FUNCTION public.schedra_set_updated_at();
