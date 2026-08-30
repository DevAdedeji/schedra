CREATE TABLE "organization_brand_logos" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"size" integer NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_brand_logos_size_range" CHECK ("organization_brand_logos"."size" > 0 and "organization_brand_logos"."size" <= 2097152)
);
--> statement-breakpoint
CREATE TABLE "organization_event_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"defaults" jsonb NOT NULL,
	"source_event_type_id" uuid,
	"created_by_user_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "brand_color" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "brand_dark_color" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "booking_page_theme" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "hide_schedra_branding" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_brand_logos" ADD CONSTRAINT "organization_brand_logos_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_event_templates" ADD CONSTRAINT "organization_event_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_event_templates" ADD CONSTRAINT "organization_event_templates_source_event_type_id_event_types_id_fk" FOREIGN KEY ("source_event_type_id") REFERENCES "public"."event_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_event_templates" ADD CONSTRAINT "organization_event_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_event_templates_active_name_key" ON "organization_event_templates" USING btree ("organization_id",lower("name")) WHERE "organization_event_templates"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "organization_event_templates_organization_archived_idx" ON "organization_event_templates" USING btree ("organization_id","archived_at","created_at");
--> statement-breakpoint
CREATE TRIGGER schedra_set_updated_at BEFORE UPDATE ON "organization_brand_logos"
FOR EACH ROW EXECUTE FUNCTION public.schedra_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER schedra_set_updated_at BEFORE UPDATE ON "organization_event_templates"
FOR EACH ROW EXECUTE FUNCTION public.schedra_set_updated_at();
