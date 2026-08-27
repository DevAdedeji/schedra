DROP INDEX "calendar_connections_one_write_destination_per_user";--> statement-breakpoint
WITH ranked_destinations AS (
	SELECT "id", row_number() OVER (
		PARTITION BY "user_id"
		ORDER BY ("status" = 'active') DESC, "updated_at" DESC, "created_at" DESC, "id" DESC
	) AS destination_rank
	FROM "calendar_connections"
	WHERE "write_calendar_id" IS NOT NULL
)
UPDATE "calendar_connections"
SET "write_calendar_id" = NULL, "updated_at" = now()
FROM ranked_destinations
WHERE "calendar_connections"."id" = ranked_destinations."id"
	AND ranked_destinations.destination_rank > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connections_one_write_destination_per_user" ON "calendar_connections" USING btree ("user_id") WHERE "calendar_connections"."write_calendar_id" is not null;
