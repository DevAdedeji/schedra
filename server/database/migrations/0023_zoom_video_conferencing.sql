ALTER TYPE "public"."meeting_location_type" ADD VALUE 'zoom' BEFORE 'video_link';--> statement-breakpoint
CREATE TABLE "booking_conference_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"connection_id" uuid,
	"provider" text DEFAULT 'zoom' NOT NULL,
	"meeting_id" text NOT NULL,
	"join_url" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_conference_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text DEFAULT 'zoom' NOT NULL,
	"provider_account_id" text NOT NULL,
	"account_label" text,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"access_token_expires_at" timestamp with time zone NOT NULL,
	"scope" text NOT NULL,
	"status" "calendar_connection_status" DEFAULT 'active' NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_conference_meetings" ADD CONSTRAINT "booking_conference_meetings_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_conference_meetings" ADD CONSTRAINT "booking_conference_meetings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_conference_meetings" ADD CONSTRAINT "booking_conference_meetings_connection_id_video_conference_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."video_conference_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_conference_connections" ADD CONSTRAINT "video_conference_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_conference_meetings_booking_provider_key" ON "booking_conference_meetings" USING btree ("booking_id","provider");--> statement-breakpoint
CREATE INDEX "booking_conference_meetings_user_id_idx" ON "booking_conference_meetings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_conference_meetings_remote_key" ON "booking_conference_meetings" USING btree ("provider","meeting_id");--> statement-breakpoint
CREATE UNIQUE INDEX "video_conference_connections_user_provider_key" ON "video_conference_connections" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "video_conference_connections_user_id_idx" ON "video_conference_connections" USING btree ("user_id");