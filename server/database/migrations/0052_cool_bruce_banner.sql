ALTER TABLE "email_outbox" ADD COLUMN "branding" jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "booking_email_templates" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "booking_email_templates" jsonb;