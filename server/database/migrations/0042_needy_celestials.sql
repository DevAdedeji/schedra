CREATE TABLE "security_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"actor_user_id" uuid,
	"actor_email" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"request_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "security_audit_logs" ADD CONSTRAINT "security_audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_audit_logs" ADD CONSTRAINT "security_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "security_audit_logs_created_idx" ON "security_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "security_audit_logs_action_created_idx" ON "security_audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "security_audit_logs_actor_created_idx" ON "security_audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "security_audit_logs_organization_created_idx" ON "security_audit_logs" USING btree ("organization_id","created_at");