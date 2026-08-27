CREATE TYPE "public"."webhook_delivery_status" AS ENUM('processing', 'completed', 'ignored', 'failed');--> statement-breakpoint
CREATE TYPE "public"."operations_alert_status" AS ENUM('active', 'resolved');--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text,
	"event_type" text NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'processing' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"payload_encrypted" text,
	"request_id" text,
	"last_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_attempts_positive" CHECK ("webhook_deliveries"."attempts" > 0)
);--> statement-breakpoint
CREATE TABLE "operations_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"status" "operations_alert_status" DEFAULT 'active' NOT NULL,
	"summary" text NOT NULL,
	"details" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_notified_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_alerts_severity_allowed" CHECK ("operations_alerts"."severity" in ('warning', 'critical'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_provider_event_key" ON "webhook_deliveries" USING btree ("provider","provider_event_id") WHERE "webhook_deliveries"."provider_event_id" is not null;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_received_idx" ON "webhook_deliveries" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_provider_received_idx" ON "webhook_deliveries" USING btree ("provider","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operations_alerts_key_key" ON "operations_alerts" USING btree ("key");--> statement-breakpoint
CREATE INDEX "operations_alerts_status_seen_idx" ON "operations_alerts" USING btree ("status","last_seen_at");
