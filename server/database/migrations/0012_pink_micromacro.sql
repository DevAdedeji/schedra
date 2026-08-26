CREATE TABLE "bachs_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_role_allowed" CHECK ("invitations"."role" in ('admin', 'member')),
	CONSTRAINT "invitations_status_allowed" CHECK ("invitations"."status" in ('pending', 'accepted', 'rejected', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_role_allowed" CHECK ("members"."role" in ('owner', 'admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "organization_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_email" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_slug_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_subscriptions" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'trialing' NOT NULL,
	"interval" text DEFAULT 'yearly' NOT NULL,
	"collection_currency" text DEFAULT 'USD' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"bachs_customer_id" text,
	"bachs_subscription_id" text,
	"last_invoice_reference" text,
	"seats_at_last_invoice" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_subscriptions_status_allowed" CHECK ("organization_subscriptions"."status" in ('trialing', 'active', 'past_due', 'canceled')),
	CONSTRAINT "organization_subscriptions_interval_allowed" CHECK ("organization_subscriptions"."interval" in ('monthly', 'yearly')),
	CONSTRAINT "organization_subscriptions_currency_allowed" CHECK ("organization_subscriptions"."collection_currency" in ('USD', 'NGN')),
	CONSTRAINT "organization_subscriptions_seats_positive" CHECK ("organization_subscriptions"."seats_at_last_invoice" is null or "organization_subscriptions"."seats_at_last_invoice" > 0)
);
--> statement-breakpoint
ALTER TABLE "schedules" DROP CONSTRAINT "schedules_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_organization_id_organizations_id_fk";
--> statement-breakpoint
DROP INDEX "organizations_slug_key";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "active_organization_id" uuid;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_audit_logs" ADD CONSTRAINT "organization_audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_audit_logs" ADD CONSTRAINT "organization_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_slug_history" ADD CONSTRAINT "organization_slug_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bachs_webhook_events_received_at_idx" ON "bachs_webhook_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "invitations_organization_status_idx" ON "invitations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "invitations_email_status_idx" ON "invitations" USING btree (lower("email"),"status");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_one_pending_per_email" ON "invitations" USING btree ("organization_id",lower("email")) WHERE "invitations"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "members_organization_user_key" ON "members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "members_user_id_idx" ON "members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "members_organization_role_idx" ON "members" USING btree ("organization_id","role");--> statement-breakpoint
CREATE INDEX "organization_audit_logs_organization_created_idx" ON "organization_audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "organization_audit_logs_action_idx" ON "organization_audit_logs" USING btree ("organization_id","action");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_history_slug_key" ON "organization_slug_history" USING btree (lower("slug"));--> statement-breakpoint
CREATE INDEX "organization_slug_history_organization_idx" ON "organization_slug_history" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_subscriptions_status_idx" ON "organization_subscriptions" USING btree ("status");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_organization_id_organizations_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organizations_archived_at_idx" ON "organizations" USING btree ("archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations" USING btree (lower("slug"));--> statement-breakpoint
ALTER TABLE "schedules" DROP COLUMN "organization_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "organization_id";