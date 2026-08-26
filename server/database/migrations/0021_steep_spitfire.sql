ALTER TABLE "bookings" ADD COLUMN "source" text DEFAULT 'hosted' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "attribution" jsonb;