DROP INDEX "event_type_hosts_event_enabled_idx";--> statement-breakpoint
ALTER TABLE "event_type_hosts" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH ordered_hosts AS (
	SELECT "id", row_number() OVER (
		PARTITION BY "event_type_id"
		ORDER BY "created_at", "id"
	) - 1 AS "position"
	FROM "event_type_hosts"
)
UPDATE "event_type_hosts"
SET "position" = ordered_hosts."position"
FROM ordered_hosts
WHERE "event_type_hosts"."id" = ordered_hosts."id";--> statement-breakpoint
CREATE INDEX "event_type_hosts_event_enabled_idx" ON "event_type_hosts" USING btree ("event_type_id","enabled","position");--> statement-breakpoint
ALTER TABLE "event_type_hosts" ADD CONSTRAINT "event_type_hosts_position_non_negative" CHECK ("event_type_hosts"."position" >= 0);
