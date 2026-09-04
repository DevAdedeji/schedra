# Booking buffer migration

Migration `0053_booking_buffer_reservations.sql` makes the database protect the
breaks before and after a meeting, including personal bookings and team co-hosts.
It does not change a meeting's start/end time, send email, or move any guest.

## What is saved

Each `booking_hosts` reservation keeps its actual meeting times plus a protected
`reserved_starts_at` / `reserved_ends_at` span. New reservations snapshot the
event type's current buffers. Editing an event type later does not shrink or
expand that existing snapshot. Another guest joining an existing group session
reuses the host's existing protected span.

Older reservations have no historical buffer snapshot. The migration uses their
event type's **current** buffer settings to initialize it. This is an explicit
backfill policy, not a reconstruction of settings at the time of booking.

The database exclusion constraint prevents different commitments from sharing a
host's protected time, even when requests arrive simultaneously. Guests in the
same group session may continue to share that session. Cancelling or rejecting a
booking releases the reservation without deleting its history.

## Before deployment

1. Confirm the target database/environment and the current deployed revision.
2. Create a provider snapshot or encrypted database backup. Confirm that it can
   be restored into a separate database; keep credentials and backups outside Git.
3. Run the read-only query below. It returns only a count, not guest details.
4. Proceed only when `conflicting_buffer_pairs` is zero. Schedule a deployment
   window if the reservation table is large: the backfill and replacement GiST
   constraint need database locks.
5. Run `pnpm db:migrate` using the target's direct database connection before
   starting the new web and worker versions. The container migration step already
   uses this sequence. Do not run test suites against the deployment database.

```sql
WITH spans AS (
  SELECT
    h.id,
    h.user_id,
    coalesce(h.group_session_id, h.booking_id) AS commitment,
    tstzrange(
      h.starts_at - make_interval(mins => e.buffer_before_minutes),
      h.ends_at + make_interval(mins => e.buffer_after_minutes),
      '[)'
    ) AS occupied
  FROM booking_hosts h
  JOIN bookings b ON b.id = h.booking_id
  JOIN event_types e ON e.id = b.event_type_id
  WHERE h.released_at IS NULL
)
SELECT count(*) AS conflicting_buffer_pairs
FROM spans a
JOIN spans b ON a.user_id = b.user_id
  AND a.id < b.id
  AND a.commitment <> b.commitment
  AND a.occupied && b.occupied;
```

This preflight assumes migration 0053 has **not** been applied. For post-migration
inspection, use the saved `reserved_starts_at` and `reserved_ends_at` instead of
recomputing spans from subsequently edited event-type settings.

## If existing bookings conflict

The migration intentionally fails and rolls back rather than moving, cancelling,
deleting, or silently reducing the protection of existing bookings. A successful
preflight is not a substitute for the migration's own check: new bookings can be
created between the two.

Keep the previous application version serving traffic. An authorized operator
must inspect affected commitments privately and decide how to resolve them with
the affected users. Historical confirmed bookings also retain reservations and
can be included in this check. Do not mass-cancel them to make deployment pass.
If the intended policy is to grandfather historical buffers, agree on a separate,
reviewed migration policy instead of editing an already applied migration.

After an approved resolution, rerun the preflight and deployment. Do not mark the
migration as applied manually or disable the overlap constraint.

## Verify after deployment

- A meeting with a 30-minute after-buffer must not offer the adjacent slot to
  another customer or through another event type.
- A co-host's team booking must block their personal booking page.
- Move a booking to a different available time on a day at its daily limit; it
  should replace the original reservation rather than consume a second allowance.
- Confirm a cancelled booking releases its protected time.
- Concurrent conflicting requests should have one winner and one recoverable
  `409` response; the loser must not create a booking or notification job.

Connected providers can return anonymous free/busy spans. Rescheduling does not
subtract such spans merely because they match the old booking: an unrelated
external meeting could occupy the same time. Moving into that provider-reported
busy period may remain unavailable; other free times remain usable.

## Non-destructive rollback

If only the application release needs rolling back, deploy the previous web and
worker revision while **keeping migration 0053 applied**. The added columns are
backward-compatible and their database trigger fills them for older write paths.
The stronger overlap constraint continues to protect bookings. Older availability
code may offer a buffered slot that the database then rejects, so this is a
temporary recovery state rather than the preferred user experience.

Do not drop the columns, trigger, or constraint, and do not roll the whole database
back over bookings created since deployment. A database restore is a separate
incident procedure requiring an explicit recovery point and reconciliation plan.
