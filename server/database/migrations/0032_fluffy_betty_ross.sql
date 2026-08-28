-- Rebuild instead of ALTER TYPE ... ADD VALUE because Drizzle applies a whole
-- migration transactionally and Postgres cannot safely use a newly-added enum
-- label until that transaction commits.
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_no_overlap_per_host";--> statement-breakpoint
DROP TRIGGER "bookings_reserve_primary_host" ON "bookings";--> statement-breakpoint
DROP TRIGGER "bookings_sync_host_reservations" ON "bookings";--> statement-breakpoint
DROP TRIGGER "bookings_enforce_group_session_capacity" ON "bookings";--> statement-breakpoint
ALTER TYPE "public"."booking_status" RENAME TO "booking_status_old";--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('awaiting_payment', 'pending', 'confirmed', 'cancelled', 'rejected');--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "status" TYPE "public"."booking_status" USING "status"::text::"public"."booking_status";--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "status" SET DEFAULT 'confirmed';--> statement-breakpoint
DROP TYPE "public"."booking_status_old";--> statement-breakpoint
CREATE TABLE "booking_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"platform_fee_cents" integer NOT NULL,
	"bachs_checkout_id" text,
	"bachs_charge_id" text,
	"checkout_url" text,
	"checkout_expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_payments_status_allowed" CHECK ("booking_payments"."status" in ('pending', 'paid', 'failed', 'expired', 'refund_pending', 'refunded', 'refund_failed')),
	CONSTRAINT "booking_payments_amount_positive" CHECK ("booking_payments"."amount_cents" >= 100),
	CONSTRAINT "booking_payments_platform_fee_valid" CHECK ("booking_payments"."platform_fee_cents" > 0 and "booking_payments"."platform_fee_cents" < "booking_payments"."amount_cents"),
	CONSTRAINT "booking_payments_currency_allowed" CHECK ("booking_payments"."currency" in ('USD', 'NGN'))
);
--> statement-breakpoint
CREATE TABLE "payment_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"bachs_account_id" text,
	"status" text DEFAULT 'not_started' NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requirements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_recipients_exactly_one_owner" CHECK (("payment_recipients"."user_id" is null) <> ("payment_recipients"."organization_id" is null)),
	CONSTRAINT "payment_recipients_status_allowed" CHECK ("payment_recipients"."status" in ('not_started', 'onboarding', 'pending_review', 'active', 'restricted', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "event_types" ADD COLUMN "payment_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_types" ADD COLUMN "price_cents" integer;--> statement-breakpoint
ALTER TABLE "event_types" ADD COLUMN "payment_currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_recipient_id_payment_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."payment_recipients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recipients" ADD CONSTRAINT "payment_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recipients" ADD CONSTRAINT "payment_recipients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_payments_booking_key" ON "booking_payments" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_payments_reference_key" ON "booking_payments" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_payments_checkout_key" ON "booking_payments" USING btree ("bachs_checkout_id") WHERE "booking_payments"."bachs_checkout_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_payments_charge_key" ON "booking_payments" USING btree ("bachs_charge_id") WHERE "booking_payments"."bachs_charge_id" is not null;--> statement-breakpoint
CREATE INDEX "booking_payments_status_expiry_idx" ON "booking_payments" USING btree ("status","checkout_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_recipients_user_key" ON "payment_recipients" USING btree ("user_id") WHERE "payment_recipients"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_recipients_organization_key" ON "payment_recipients" USING btree ("organization_id") WHERE "payment_recipients"."organization_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_recipients_bachs_account_key" ON "payment_recipients" USING btree ("bachs_account_id") WHERE "payment_recipients"."bachs_account_id" is not null;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_payment_configuration_valid" CHECK (("event_types"."payment_enabled" = false and "event_types"."price_cents" is null) or ("event_types"."payment_enabled" = true and "event_types"."price_cents" >= 100 and "event_types"."requires_confirmation" = false));--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_payment_currency_allowed" CHECK ("event_types"."payment_currency" in ('USD', 'NGN'));--> statement-breakpoint

-- Checkout holds consume a real slot until payment succeeds or the worker
-- expires them. This is a database invariant, not merely an API convention.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap_per_host"
  EXCLUDE USING gist (
    "host_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&,
    coalesce("group_session_id", "id") WITH <>
  ) WHERE ("status" IN ('awaiting_payment', 'pending', 'confirmed'));--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_group_session_capacity() RETURNS trigger AS $$
DECLARE
  session_row group_event_sessions%ROWTYPE;
  occupied integer;
BEGIN
  IF NEW.group_session_id IS NULL OR NEW.status NOT IN ('awaiting_payment', 'pending', 'confirmed') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO session_row FROM group_event_sessions
  WHERE id = NEW.group_session_id FOR UPDATE;

  IF NOT FOUND
     OR session_row.event_type_id <> NEW.event_type_id
     OR session_row.starts_at <> NEW.starts_at
     OR session_row.ends_at <> NEW.ends_at THEN
    RAISE EXCEPTION 'Booking does not match its group session'
      USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(sum(1 + jsonb_array_length(additional_guest_emails)), 0) INTO occupied FROM bookings
  WHERE group_session_id = NEW.group_session_id
    AND status IN ('awaiting_payment', 'pending', 'confirmed')
    AND id <> NEW.id;

  IF occupied + 1 + jsonb_array_length(NEW.additional_guest_emails) > session_row.capacity THEN
    RAISE EXCEPTION 'Group session capacity reached'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE OR REPLACE FUNCTION sync_booking_host_reservations() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'rejected') THEN
    UPDATE booking_hosts SET released_at = now(), updated_at = now()
    WHERE booking_id = NEW.id AND released_at IS NULL;
  ELSIF NEW.status IN ('awaiting_payment', 'pending', 'confirmed') THEN
    UPDATE booking_hosts SET released_at = NULL, updated_at = now()
    WHERE booking_id = NEW.id AND released_at IS NOT NULL;
  END IF;

  IF NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at THEN
    UPDATE booking_hosts SET starts_at = NEW.starts_at, ends_at = NEW.ends_at, updated_at = now()
    WHERE booking_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER bookings_reserve_primary_host
  AFTER INSERT ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION reserve_primary_booking_host();--> statement-breakpoint

CREATE TRIGGER bookings_sync_host_reservations
  AFTER UPDATE ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION sync_booking_host_reservations();--> statement-breakpoint

CREATE TRIGGER bookings_enforce_group_session_capacity
  BEFORE INSERT OR UPDATE OF status, group_session_id, starts_at, ends_at, event_type_id, additional_guest_emails
  ON "bookings" FOR EACH ROW EXECUTE FUNCTION enforce_group_session_capacity();
