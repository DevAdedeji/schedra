DROP INDEX "booking_calendar_events_remote_key";--> statement-breakpoint
ALTER TABLE "booking_calendar_events" ADD COLUMN "provider" text DEFAULT 'google' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_sync_jobs" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_sync_jobs" ADD COLUMN "failure_provider" text;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connections_one_write_destination_per_user" ON "calendar_connections" USING btree ("user_id") WHERE "calendar_connections"."write_calendar_id" is not null and "calendar_connections"."status" = 'active';--> statement-breakpoint
WITH ranked_jobs AS (
	SELECT "id", row_number() OVER (
		PARTITION BY "booking_id"
		ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
	) AS row_number
	FROM "calendar_sync_jobs"
)
DELETE FROM "calendar_sync_jobs"
WHERE "id" IN (SELECT "id" FROM ranked_jobs WHERE row_number > 1);--> statement-breakpoint
UPDATE "calendar_sync_jobs" AS jobs
SET
	"action" = CASE
		WHEN bookings."status" IN ('cancelled', 'rejected') THEN 'delete'::"calendar_sync_action"
		ELSE 'upsert'::"calendar_sync_action"
	END,
	"dedupe_key" = 'booking:' || jobs."booking_id"::text,
	"revision" = 1,
	"status" = CASE
		WHEN jobs."status" = 'processing' THEN 'pending'::"calendar_sync_status"
		ELSE jobs."status"
	END,
	"locked_at" = NULL,
	"updated_at" = now()
FROM "bookings"
WHERE bookings."id" = jobs."booking_id";--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_sync_jobs_booking_id_key" ON "calendar_sync_jobs" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_calendar_events_remote_key" ON "booking_calendar_events" USING btree ("provider","calendar_id","event_id");--> statement-breakpoint
ALTER TABLE "calendar_sync_jobs" ADD CONSTRAINT "calendar_sync_jobs_revision_positive" CHECK ("calendar_sync_jobs"."revision" > 0);
