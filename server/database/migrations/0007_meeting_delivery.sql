CREATE TYPE "public"."meeting_location_type" AS ENUM('google_meet', 'video_link', 'phone', 'in_person', 'custom');--> statement-breakpoint
ALTER TYPE "public"."email_delivery_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "location_type" "meeting_location_type" DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "location_details" text DEFAULT 'The host will share meeting details before the meeting.' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "meeting_url" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "booking_uid" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "category" text DEFAULT 'transactional' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_types" ADD COLUMN "location_type" "meeting_location_type" DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_types" ADD COLUMN "location_details" text DEFAULT 'The host will share meeting details before the meeting.' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_types" ADD COLUMN "reminder_minutes" jsonb DEFAULT '[1440, 60]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "email_outbox_booking_uid_idx" ON "email_outbox" USING btree ("booking_uid","category");