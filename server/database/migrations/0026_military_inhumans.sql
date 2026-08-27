ALTER TABLE "calendar_connections" ADD COLUMN "preferences_configured_at" timestamp with time zone;--> statement-breakpoint
UPDATE "calendar_connections"
SET "preferences_configured_at" = "updated_at"
WHERE jsonb_array_length("conflict_calendar_ids") > 0
  AND "write_calendar_id" IS NOT NULL;
