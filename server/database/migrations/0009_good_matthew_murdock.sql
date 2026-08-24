ALTER TABLE "email_outbox" ADD COLUMN "preheader" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "details" jsonb;