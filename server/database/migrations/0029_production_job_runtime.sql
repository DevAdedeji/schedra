CREATE TABLE "worker_leases" (
	"name" text PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "worker_instances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_instances_role_allowed" CHECK ("worker_instances"."role" in ('worker', 'all'))
);--> statement-breakpoint
CREATE INDEX "worker_leases_expires_at_idx" ON "worker_leases" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "worker_instances_last_seen_idx" ON "worker_instances" USING btree ("last_seen_at");
