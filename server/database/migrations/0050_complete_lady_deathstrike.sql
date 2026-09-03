CREATE TABLE "organization_event_template_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"event_type_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_event_templates" ADD COLUMN "member_editable_fields" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_event_template_assignments" ADD CONSTRAINT "organization_event_template_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_event_template_assignments" ADD CONSTRAINT "organization_event_template_assignments_template_id_organization_event_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."organization_event_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_event_template_assignments" ADD CONSTRAINT "organization_event_template_assignments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_event_template_assignments" ADD CONSTRAINT "organization_event_template_assignments_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_event_template_assignments_template_member_key" ON "organization_event_template_assignments" USING btree ("template_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_event_template_assignments_event_type_key" ON "organization_event_template_assignments" USING btree ("event_type_id");--> statement-breakpoint
CREATE INDEX "organization_event_template_assignments_organization_idx" ON "organization_event_template_assignments" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "organization_event_template_assignments_member_idx" ON "organization_event_template_assignments" USING btree ("member_id");