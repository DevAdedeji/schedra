CREATE TABLE "organization_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"interval" text NOT NULL,
	"seats" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"collection_currency" text DEFAULT 'USD' NOT NULL,
	"settlement_amount_cents" integer,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"bachs_checkout_id" text,
	"bachs_charge_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_invoices_status_allowed" CHECK ("organization_invoices"."status" in ('pending', 'paid', 'failed', 'expired')),
	CONSTRAINT "organization_invoices_seats_positive" CHECK ("organization_invoices"."seats" > 0),
	CONSTRAINT "organization_invoices_amount_positive" CHECK ("organization_invoices"."amount_cents" > 0),
	CONSTRAINT "organization_invoices_period_ordered" CHECK ("organization_invoices"."period_end" > "organization_invoices"."period_start")
);
--> statement-breakpoint
ALTER TABLE "organization_invoices" ADD CONSTRAINT "organization_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invoices_reference_key" ON "organization_invoices" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "organization_invoices_organization_created_idx" ON "organization_invoices" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "organization_invoices_checkout_idx" ON "organization_invoices" USING btree ("bachs_checkout_id");