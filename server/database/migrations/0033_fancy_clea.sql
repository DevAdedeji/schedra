CREATE TABLE "routing_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"default_event_type_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routing_forms_exactly_one_owner" CHECK (("routing_forms"."user_id" is null) <> ("routing_forms"."organization_id" is null)),
	CONSTRAINT "routing_forms_questions_limit" CHECK (jsonb_array_length("routing_forms"."questions") between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "routing_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"matched_rule_id" uuid,
	"event_type_id" uuid NOT NULL,
	"respondent_name" text NOT NULL,
	"respondent_email" text NOT NULL,
	"answers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"event_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"conditions" jsonb NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routing_rules_position_non_negative" CHECK ("routing_rules"."position" >= 0),
	CONSTRAINT "routing_rules_conditions_limit" CHECK (jsonb_array_length("routing_rules"."conditions") between 1 and 10)
);
--> statement-breakpoint
ALTER TABLE "routing_forms" ADD CONSTRAINT "routing_forms_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_forms" ADD CONSTRAINT "routing_forms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_forms" ADD CONSTRAINT "routing_forms_default_event_type_id_event_types_id_fk" FOREIGN KEY ("default_event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_responses" ADD CONSTRAINT "routing_responses_form_id_routing_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."routing_forms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_responses" ADD CONSTRAINT "routing_responses_matched_rule_id_routing_rules_id_fk" FOREIGN KEY ("matched_rule_id") REFERENCES "public"."routing_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_responses" ADD CONSTRAINT "routing_responses_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_form_id_routing_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."routing_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "routing_forms_user_slug_key" ON "routing_forms" USING btree ("user_id",lower("slug")) WHERE "routing_forms"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "routing_forms_organization_slug_key" ON "routing_forms" USING btree ("organization_id",lower("slug")) WHERE "routing_forms"."organization_id" is not null;--> statement-breakpoint
CREATE INDEX "routing_forms_user_idx" ON "routing_forms" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "routing_forms_organization_idx" ON "routing_forms" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "routing_responses_form_created_idx" ON "routing_responses" USING btree ("form_id","created_at");--> statement-breakpoint
CREATE INDEX "routing_responses_event_created_idx" ON "routing_responses" USING btree ("event_type_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "routing_rules_form_position_key" ON "routing_rules" USING btree ("form_id","position");--> statement-breakpoint
CREATE INDEX "routing_rules_form_idx" ON "routing_rules" USING btree ("form_id");