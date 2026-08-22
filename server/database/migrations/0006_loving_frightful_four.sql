CREATE TYPE "public"."calendar_connection_status" AS ENUM('active', 'needs_reauthorization', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."calendar_sync_action" AS ENUM('upsert', 'delete');--> statement-breakpoint
CREATE TYPE "public"."calendar_sync_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "booking_calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"connection_id" uuid,
	"calendar_id" text NOT NULL,
	"event_id" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text DEFAULT 'google' NOT NULL,
	"account_label" text,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"access_token_expires_at" timestamp with time zone NOT NULL,
	"scope" text NOT NULL,
	"conflict_calendar_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"write_calendar_id" text,
	"status" "calendar_connection_status" DEFAULT 'active' NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"action" "calendar_sync_action" NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" "calendar_sync_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_sync_jobs_attempts_non_negative" CHECK ("calendar_sync_jobs"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "booking_calendar_events" ADD CONSTRAINT "booking_calendar_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_calendar_events" ADD CONSTRAINT "booking_calendar_events_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sync_jobs" ADD CONSTRAINT "calendar_sync_jobs_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_calendar_events_booking_key" ON "booking_calendar_events" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_calendar_events_remote_key" ON "booking_calendar_events" USING btree ("calendar_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connections_user_provider_key" ON "calendar_connections" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "calendar_connections_user_id_idx" ON "calendar_connections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_sync_jobs_dedupe_key_key" ON "calendar_sync_jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "calendar_sync_jobs_claim_idx" ON "calendar_sync_jobs" USING btree ("status","available_at");