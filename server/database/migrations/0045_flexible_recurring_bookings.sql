CREATE TABLE "booking_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"event_type_id" uuid NOT NULL,
	"organization_id" uuid,
	"frequency" text NOT NULL,
	"occurrence_count" integer NOT NULL,
	"time_zone" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_series_frequency_allowed" CHECK ("booking_series"."frequency" in ('weekly', 'biweekly', 'monthly', 'yearly')),
	CONSTRAINT "booking_series_occurrence_count_range" CHECK ("booking_series"."occurrence_count" between 2 and 8),
	CONSTRAINT "booking_series_duration_positive" CHECK ("booking_series"."duration_minutes" > 0)
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "series_position" integer;--> statement-breakpoint
ALTER TABLE "event_types" ADD COLUMN "additional_duration_minutes" integer[] DEFAULT '{}'::integer[] NOT NULL;--> statement-breakpoint
ALTER TABLE "event_types" ADD COLUMN "recurring_booking_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_types" ADD COLUMN "recurring_booking_max_occurrences" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_series_request_id_key" ON "booking_series" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "booking_series_event_created_idx" ON "booking_series" USING btree ("event_type_id","created_at");--> statement-breakpoint
CREATE INDEX "booking_series_organization_created_idx" ON "booking_series" USING btree ("organization_id","created_at") WHERE "booking_series"."organization_id" is not null;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_series_id_booking_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."booking_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_series_position_idx" ON "bookings" USING btree ("series_id","series_position");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_active_series_position_key" ON "bookings" USING btree ("series_id","series_position") WHERE "bookings"."series_id" is not null and "bookings"."status" in ('awaiting_payment', 'pending', 'confirmed');--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_series_fields_paired" CHECK (("bookings"."series_id" is null) = ("bookings"."series_position" is null));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_series_position_positive" CHECK ("bookings"."series_position" is null or "bookings"."series_position" > 0);--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_additional_durations_valid" CHECK (cardinality("event_types"."additional_duration_minutes") <= 4 and 5 <= all("event_types"."additional_duration_minutes") and 720 >= all("event_types"."additional_duration_minutes") and not ("event_types"."duration_minutes" = any("event_types"."additional_duration_minutes")));--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_recurring_occurrences_range" CHECK ("event_types"."recurring_booking_max_occurrences" between 2 and 8);--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_recurring_configuration_valid" CHECK ("event_types"."recurring_booking_enabled" = false or ("event_types"."payment_enabled" = false and "event_types"."capacity" = 1 and "event_types"."requires_confirmation" = false));--> statement-breakpoint
CREATE TRIGGER schedra_set_updated_at BEFORE UPDATE ON "booking_series" FOR EACH ROW EXECUTE FUNCTION public.schedra_set_updated_at();
