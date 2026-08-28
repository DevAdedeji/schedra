CREATE TYPE "public"."automation_run_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "automation_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"created_by_user_id" uuid,
	"event_type_id" uuid,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"offset_minutes" integer DEFAULT 0 NOT NULL,
	"action" jsonb NOT NULL,
	"webhook_secret_encrypted" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_workflows_exactly_one_scope" CHECK (("automation_workflows"."organization_id" is null) <> ("automation_workflows"."user_id" is null)),
	CONSTRAINT "automation_workflows_offset_range" CHECK ("automation_workflows"."offset_minutes" between 0 and 10080)
);--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"type" text NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"event_type_id" uuid,
	"booking_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_events_exactly_one_scope" CHECK (("domain_events"."organization_id" is null) <> ("domain_events"."user_id" is null))
);--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"domain_event_id" uuid,
	"booking_id" uuid NOT NULL,
	"status" "automation_run_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_runs_attempts_non_negative" CHECK ("automation_runs"."attempts" >= 0)
);--> statement-breakpoint
ALTER TABLE "automation_workflows" ADD CONSTRAINT "automation_workflows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_workflows" ADD CONSTRAINT "automation_workflows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_workflows" ADD CONSTRAINT "automation_workflows_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_workflows" ADD CONSTRAINT "automation_workflows_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_workflow_id_automation_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."automation_workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_domain_event_id_domain_events_id_fk" FOREIGN KEY ("domain_event_id") REFERENCES "public"."domain_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_workflows_user_active_idx" ON "automation_workflows" USING btree ("user_id","active");--> statement-breakpoint
CREATE INDEX "automation_workflows_organization_active_idx" ON "automation_workflows" USING btree ("organization_id","active");--> statement-breakpoint
CREATE INDEX "automation_workflows_event_type_idx" ON "automation_workflows" USING btree ("event_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_events_dedupe_key_key" ON "domain_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "domain_events_dispatch_idx" ON "domain_events" USING btree ("dispatched_at","occurred_at");--> statement-breakpoint
CREATE INDEX "domain_events_user_occurred_idx" ON "domain_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "domain_events_organization_occurred_idx" ON "domain_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_workflow_booking_key" ON "automation_runs" USING btree ("workflow_id","booking_id");--> statement-breakpoint
CREATE INDEX "automation_runs_claim_idx" ON "automation_runs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "automation_runs_booking_idx" ON "automation_runs" USING btree ("booking_id");
