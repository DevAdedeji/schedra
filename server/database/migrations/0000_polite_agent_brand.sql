CREATE TYPE "public"."booking_status" AS ENUM('pending', 'confirmed', 'cancelled', 'rejected');--> statement-breakpoint
CREATE TABLE "availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_rules_weekday_range" CHECK ("availability_rules"."weekday" between 1 and 7)
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"event_type_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"uid" text NOT NULL,
	"status" "booking_status" DEFAULT 'confirmed' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"attendee_name" text NOT NULL,
	"attendee_email" text NOT NULL,
	"attendee_time_zone" text NOT NULL,
	"answers" jsonb,
	"cancellation_reason" text,
	"rescheduled_from_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_ends_after_starts" CHECK ("bookings"."ends_at" > "bookings"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "date_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "date_overrides_times_paired" CHECK (("date_overrides"."start_time" is null) = ("date_overrides"."end_time" is null))
);
--> statement-breakpoint
CREATE TABLE "event_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"user_id" uuid NOT NULL,
	"schedule_id" uuid,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"duration_minutes" integer NOT NULL,
	"increment_minutes" integer,
	"buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_after_minutes" integer DEFAULT 0 NOT NULL,
	"minimum_notice_minutes" integer DEFAULT 0 NOT NULL,
	"booking_window_days" integer,
	"max_per_day" integer,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_types_duration_positive" CHECK ("event_types"."duration_minutes" > 0),
	CONSTRAINT "event_types_increment_positive" CHECK ("event_types"."increment_minutes" is null or "event_types"."increment_minutes" > 0),
	CONSTRAINT "event_types_buffers_non_negative" CHECK ("event_types"."buffer_before_minutes" >= 0 and "event_types"."buffer_after_minutes" >= 0 and "event_types"."minimum_notice_minutes" >= 0),
	CONSTRAINT "event_types_max_per_day_positive" CHECK ("event_types"."max_per_day" is null or "event_types"."max_per_day" > 0)
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"time_zone" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"username" text NOT NULL,
	"bio" text,
	"avatar_url" text,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "date_overrides" ADD CONSTRAINT "date_overrides_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_rules_schedule_id_idx" ON "availability_rules" USING btree ("schedule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_uid_key" ON "bookings" USING btree ("uid");--> statement-breakpoint
CREATE INDEX "bookings_host_id_starts_at_idx" ON "bookings" USING btree ("host_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_event_type_id_idx" ON "bookings" USING btree ("event_type_id");--> statement-breakpoint
CREATE INDEX "date_overrides_schedule_id_date_idx" ON "date_overrides" USING btree ("schedule_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "event_types_user_id_slug_key" ON "event_types" USING btree ("user_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "schedules_user_id_idx" ON "schedules" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedules_one_default_per_user" ON "schedules" USING btree ("user_id") WHERE "schedules"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_key" ON "users" USING btree (lower("username"));