DROP INDEX "calendar_connections_one_write_destination_per_user";--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "is_default_write_destination" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "calendar_connections"
SET "is_default_write_destination" = true
WHERE "write_calendar_id" IS NOT NULL;--> statement-breakpoint
-- Older releases cleared the other provider's writable calendar whenever the
-- default changed. Restore each provider's primary calendar so Google Meet and
-- Microsoft Teams do not disable one another after this migration.
UPDATE "calendar_connections"
SET "write_calendar_id" = CASE
  WHEN "provider" = 'google' THEN COALESCE("account_label", "conflict_calendar_ids"->>0)
  ELSE "conflict_calendar_ids"->>0
END
WHERE "write_calendar_id" IS NULL
  AND jsonb_array_length("conflict_calendar_ids") > 0;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connections_one_default_destination_per_user" ON "calendar_connections" USING btree ("user_id") WHERE "calendar_connections"."is_default_write_destination" is true;
