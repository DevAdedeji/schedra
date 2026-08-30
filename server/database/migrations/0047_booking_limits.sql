ALTER TABLE "event_types" ADD COLUMN "max_per_week" integer;--> statement-breakpoint
ALTER TABLE "event_types" ADD COLUMN "max_per_month" integer;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_max_per_week_positive" CHECK ("event_types"."max_per_week" is null or "event_types"."max_per_week" > 0);--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_max_per_month_positive" CHECK ("event_types"."max_per_month" is null or "event_types"."max_per_month" > 0);