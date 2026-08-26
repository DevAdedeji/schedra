-- Application code cannot win a double-booking race: two requests both read
-- "free" before either writes. The same fix as bookings_no_overlap_per_host,
-- but over every host of a booking rather than only the primary one, so a
-- collective team meeting cannot land on top of a member's personal booking.
ALTER TABLE "booking_hosts"
  ADD CONSTRAINT "booking_hosts_no_overlap_per_user"
  EXCLUDE USING gist (
    "user_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("released_at" IS NULL);
--> statement-breakpoint

-- Reserving the primary host in a trigger means every existing booking path
-- keeps its reservation without having to remember to write one.
CREATE OR REPLACE FUNCTION reserve_primary_booking_host() RETURNS trigger AS $$
BEGIN
  INSERT INTO booking_hosts (booking_id, user_id, is_organizer, starts_at, ends_at, released_at)
  VALUES (
    NEW.id,
    NEW.host_id,
    true,
    NEW.starts_at,
    NEW.ends_at,
    CASE WHEN NEW.status IN ('cancelled', 'rejected') THEN now() END
  )
  ON CONFLICT (booking_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER bookings_reserve_primary_host
  AFTER INSERT ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION reserve_primary_booking_host();
--> statement-breakpoint

-- Releasing on cancellation has to be automatic too, or a slot stays blocked
-- for everyone because one code path forgot.
CREATE OR REPLACE FUNCTION sync_booking_host_reservations() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'rejected') THEN
    UPDATE booking_hosts SET released_at = now(), updated_at = now()
    WHERE booking_id = NEW.id AND released_at IS NULL;
  ELSIF NEW.status IN ('pending', 'confirmed') THEN
    UPDATE booking_hosts SET released_at = NULL, updated_at = now()
    WHERE booking_id = NEW.id AND released_at IS NOT NULL;
  END IF;

  IF NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at THEN
    UPDATE booking_hosts SET starts_at = NEW.starts_at, ends_at = NEW.ends_at, updated_at = now()
    WHERE booking_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER bookings_sync_host_reservations
  AFTER UPDATE ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION sync_booking_host_reservations();
--> statement-breakpoint

-- Bookings that predate this table still hold their hosts' time.
INSERT INTO booking_hosts (booking_id, user_id, is_organizer, starts_at, ends_at, released_at)
SELECT id, host_id, true, starts_at, ends_at,
       CASE WHEN status IN ('cancelled', 'rejected') THEN now() END
FROM bookings
ON CONFLICT (booking_id, user_id) DO NOTHING;
