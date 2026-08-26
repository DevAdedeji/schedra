ALTER TABLE "event_types" DROP CONSTRAINT "event_types_organization_id_organizations_id_fk";
--> statement-breakpoint
DROP INDEX "booking_calendar_events_booking_key";--> statement-breakpoint
ALTER TABLE "event_types" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_calendar_events" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "event_types" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
-- Existing calendar mappings belong to the primary host. New team bookings
-- can add one mapping for every assigned host after this backfill.
UPDATE "booking_calendar_events" AS mapping
SET "user_id" = booking."host_id"
FROM "bookings" AS booking
WHERE booking."id" = mapping."booking_id";--> statement-breakpoint
ALTER TABLE "booking_calendar_events" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
-- A team owns its shared event types. Preserve the original creator only as
-- attribution so their account can be removed without deleting team links.
UPDATE "event_types"
SET "created_by_user_id" = "user_id", "user_id" = NULL
WHERE "organization_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_calendar_events" ADD CONSTRAINT "booking_calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_calendar_events_booking_user_key" ON "booking_calendar_events" USING btree ("booking_id","user_id");--> statement-breakpoint
CREATE INDEX "booking_calendar_events_user_id_idx" ON "booking_calendar_events" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_exactly_one_owner" CHECK (("event_types"."organization_id" is null) <> ("event_types"."user_id" is null));
