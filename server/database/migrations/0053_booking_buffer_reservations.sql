ALTER TABLE "booking_hosts" ADD COLUMN "reserved_starts_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_hosts" ADD COLUMN "reserved_ends_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint

-- Existing bookings keep their actual times; only the protected busy span changes.
UPDATE booking_hosts h SET
  reserved_starts_at = h.starts_at - make_interval(mins => e.buffer_before_minutes),
  reserved_ends_at = h.ends_at + make_interval(mins => e.buffer_after_minutes)
FROM bookings b JOIN event_types e ON e.id = b.event_type_id
WHERE h.booking_id = b.id;
--> statement-breakpoint

-- Fail before replacing the old guard if historic bookings already violate buffers.
-- An operator must resolve those bookings deliberately; never move guests in a migration.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM booking_hosts a JOIN booking_hosts b
      ON a.user_id = b.user_id AND a.id < b.id
      AND coalesce(a.group_session_id, a.booking_id) <> coalesce(b.group_session_id, b.booking_id)
      AND tstzrange(a.reserved_starts_at, a.reserved_ends_at, '[)') && tstzrange(b.reserved_starts_at, b.reserved_ends_at, '[)')
    WHERE a.released_at IS NULL AND b.released_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Existing bookings overlap their configured buffers. Resolve those commitments before applying booking_buffer_reservations.';
  END IF;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION protect_booking_host_buffers() RETURNS trigger AS $$
DECLARE before_minutes integer; after_minutes integer; session_start timestamptz; session_end timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT reserved_starts_at, reserved_ends_at INTO session_start, session_end
      FROM booking_hosts WHERE group_session_id = NEW.group_session_id AND user_id = NEW.user_id
      AND released_at IS NULL LIMIT 1;
    SELECT e.buffer_before_minutes, e.buffer_after_minutes INTO before_minutes, after_minutes
      FROM bookings b JOIN event_types e ON e.id = b.event_type_id WHERE b.id = NEW.booking_id;
    NEW.reserved_starts_at := coalesce(session_start, NEW.starts_at - make_interval(mins => before_minutes));
    NEW.reserved_ends_at := coalesce(session_end, NEW.ends_at + make_interval(mins => after_minutes));
  ELSE
    NEW.reserved_starts_at := NEW.starts_at - (OLD.starts_at - OLD.reserved_starts_at);
    NEW.reserved_ends_at := NEW.ends_at + (OLD.reserved_ends_at - OLD.ends_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER booking_hosts_protect_buffers BEFORE INSERT OR UPDATE ON booking_hosts
  FOR EACH ROW EXECUTE FUNCTION protect_booking_host_buffers();
--> statement-breakpoint
ALTER TABLE booking_hosts DROP CONSTRAINT booking_hosts_no_overlap_per_user;
--> statement-breakpoint
ALTER TABLE booking_hosts ADD CONSTRAINT booking_hosts_no_overlap_per_user EXCLUDE USING gist (
  user_id WITH =,
  tstzrange(reserved_starts_at, reserved_ends_at, '[)') WITH &&,
  coalesce(group_session_id, booking_id) WITH <>
) WHERE (released_at IS NULL);
