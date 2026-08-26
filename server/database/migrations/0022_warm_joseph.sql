CREATE TYPE "public"."billing_sync_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "subscription_seat_sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" "billing_sync_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_seat_sync_jobs_attempts_non_negative" CHECK ("subscription_seat_sync_jobs"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "subscription_seat_sync_jobs" ADD CONSTRAINT "subscription_seat_sync_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_seat_sync_jobs_organization_key" ON "subscription_seat_sync_jobs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "subscription_seat_sync_jobs_claim_idx" ON "subscription_seat_sync_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "subscription_seat_sync_jobs_organization_idx" ON "subscription_seat_sync_jobs" USING btree ("organization_id","created_at");--> statement-breakpoint
-- Reconcile subscriptions that already gained or lost members before this
-- worker existed. The worker derives the live member count and is a no-op when
-- the provider is already correct.
INSERT INTO "subscription_seat_sync_jobs" ("organization_id")
SELECT "organization_id"
FROM "organization_subscriptions"
WHERE "collection_method" = 'charge_automatically'
  AND "bachs_subscription_id" IS NOT NULL
  AND "status" IN ('active', 'past_due', 'unpaid')
ON CONFLICT ("organization_id") DO UPDATE SET
  "status" = 'pending',
  "attempts" = 0,
  "available_at" = now(),
  "locked_at" = NULL,
  "completed_at" = NULL,
  "last_error" = NULL,
  "updated_at" = now();
