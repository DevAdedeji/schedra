CREATE TABLE "group_event_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_event_sessions_ends_after_starts" CHECK ("group_event_sessions"."ends_at" > "group_event_sessions"."starts_at"),
	CONSTRAINT "group_event_sessions_capacity_range" CHECK ("group_event_sessions"."capacity" between 2 and 500)
);
--> statement-breakpoint
ALTER TABLE "booking_hosts" ADD COLUMN "group_session_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "group_session_id" uuid;--> statement-breakpoint
ALTER TABLE "event_types" ADD COLUMN "capacity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "group_event_sessions" ADD CONSTRAINT "group_event_sessions_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_event_sessions_event_time_key" ON "group_event_sessions" USING btree ("event_type_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "group_event_sessions_event_starts_idx" ON "group_event_sessions" USING btree ("event_type_id","starts_at");--> statement-breakpoint
ALTER TABLE "booking_hosts" ADD CONSTRAINT "booking_hosts_group_session_id_group_event_sessions_id_fk" FOREIGN KEY ("group_session_id") REFERENCES "public"."group_event_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_group_session_id_group_event_sessions_id_fk" FOREIGN KEY ("group_session_id") REFERENCES "public"."group_event_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_hosts_group_session_idx" ON "booking_hosts" USING btree ("group_session_id");--> statement-breakpoint
CREATE INDEX "bookings_group_session_status_idx" ON "bookings" USING btree ("group_session_id","status");--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_capacity_range" CHECK ("event_types"."capacity" between 1 and 500);--> statement-breakpoint

-- Seats in one group session may overlap each other; every unrelated booking
-- must still lose the race at the database boundary.
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_no_overlap_per_host";--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap_per_host"
  EXCLUDE USING gist (
    "host_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&,
    coalesce("group_session_id", "id") WITH <>
  ) WHERE ("status" IN ('pending', 'confirmed'));--> statement-breakpoint

ALTER TABLE "booking_hosts" DROP CONSTRAINT "booking_hosts_no_overlap_per_user";--> statement-breakpoint
ALTER TABLE "booking_hosts" ADD CONSTRAINT "booking_hosts_no_overlap_per_user"
  EXCLUDE USING gist (
    "user_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&,
    coalesce("group_session_id", "booking_id") WITH <>
  ) WHERE ("released_at" IS NULL);--> statement-breakpoint

-- The trigger keeps the denormalized session key on the primary host
-- reservation, including for booking paths that do not write booking_hosts.
CREATE OR REPLACE FUNCTION reserve_primary_booking_host() RETURNS trigger AS $$
BEGIN
  INSERT INTO booking_hosts (
    booking_id, group_session_id, user_id, is_organizer,
    starts_at, ends_at, released_at
  ) VALUES (
    NEW.id, NEW.group_session_id, NEW.host_id, true,
    NEW.starts_at, NEW.ends_at,
    CASE WHEN NEW.status IN ('cancelled', 'rejected') THEN now() END
  )
  ON CONFLICT (booking_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- Application locks make the happy path fast and friendly; this trigger is
-- the final invariant if another code path ever writes a seat directly.
CREATE OR REPLACE FUNCTION enforce_group_session_capacity() RETURNS trigger AS $$
DECLARE
  session_row group_event_sessions%ROWTYPE;
  occupied integer;
BEGIN
  IF NEW.group_session_id IS NULL OR NEW.status NOT IN ('pending', 'confirmed') THEN
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
    AND status IN ('pending', 'confirmed')
    AND id <> NEW.id;

  IF occupied + 1 + jsonb_array_length(NEW.additional_guest_emails) > session_row.capacity THEN
    RAISE EXCEPTION 'Group session capacity reached'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER bookings_enforce_group_session_capacity
  BEFORE INSERT OR UPDATE OF status, group_session_id, starts_at, ends_at, event_type_id, additional_guest_emails
  ON "bookings" FOR EACH ROW EXECUTE FUNCTION enforce_group_session_capacity();
