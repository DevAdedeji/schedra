CREATE TYPE "public"."assignment_mode" AS ENUM('single', 'round_robin', 'collective');--> statement-breakpoint
CREATE TABLE "event_type_hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"schedule_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"weight" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_type_hosts_weight_positive" CHECK ("event_type_hosts"."weight" > 0)
);
--> statement-breakpoint
DROP INDEX "event_types_user_id_slug_key";--> statement-breakpoint
ALTER TABLE "event_types" ADD COLUMN "assignment_mode" "assignment_mode" DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_type_hosts" ADD CONSTRAINT "event_type_hosts_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type_hosts" ADD CONSTRAINT "event_type_hosts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type_hosts" ADD CONSTRAINT "event_type_hosts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type_hosts" ADD CONSTRAINT "event_type_hosts_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_type_hosts_event_member_key" ON "event_type_hosts" USING btree ("event_type_id","member_id");--> statement-breakpoint
CREATE INDEX "event_type_hosts_event_enabled_idx" ON "event_type_hosts" USING btree ("event_type_id","enabled");--> statement-breakpoint
CREATE INDEX "event_type_hosts_user_idx" ON "event_type_hosts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_types_organization_slug_key" ON "event_types" USING btree ("organization_id","slug") WHERE "event_types"."organization_id" is not null;--> statement-breakpoint
CREATE INDEX "event_types_organization_hidden_idx" ON "event_types" USING btree ("organization_id","hidden","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_types_user_id_slug_key" ON "event_types" USING btree ("user_id","slug") WHERE "event_types"."organization_id" is null;