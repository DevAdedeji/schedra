-- Two people confirming the same slot at the same moment is a race application
-- code cannot win: both read "free" before either writes. Making the check and
-- the write one atomic operation is the only fix. The loser gets SQLSTATE 23P01.
--
-- btree_gist lets a plain equality column sit in a GiST index beside a range.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- '[)' keeps back-to-back meetings bookable: ending at 10:00 does not overlap
-- starting at 10:00. The WHERE clause frees a slot the moment it is cancelled,
-- without deleting the row.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap_per_host"
  EXCLUDE USING gist (
    "host_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("status" IN ('pending', 'confirmed'));
