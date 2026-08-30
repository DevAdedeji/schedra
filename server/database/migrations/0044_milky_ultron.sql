CREATE TABLE "personal_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"interval" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"collection_currency" text DEFAULT 'USD' NOT NULL,
	"collection_amount" text,
	"exchange_rate" text,
	"settlement_amount_cents" integer,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"bachs_checkout_id" text,
	"checkout_url" text,
	"bachs_charge_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_invoices_status_allowed" CHECK ("personal_invoices"."status" in ('pending', 'paid', 'failed', 'expired')),
	CONSTRAINT "personal_invoices_amount_positive" CHECK ("personal_invoices"."amount_cents" > 0),
	CONSTRAINT "personal_invoices_period_ordered" CHECK ("personal_invoices"."period_end" > "personal_invoices"."period_start"),
	CONSTRAINT "personal_invoices_currency_allowed" CHECK ("personal_invoices"."collection_currency" in ('USD', 'NGN'))
);
--> statement-breakpoint
CREATE TABLE "personal_subscriptions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'canceled' NOT NULL,
	"interval" text DEFAULT 'yearly' NOT NULL,
	"collection_currency" text DEFAULT 'USD' NOT NULL,
	"collection_method" text DEFAULT 'invoice' NOT NULL,
	"current_period_end" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"bachs_customer_id" text,
	"bachs_subscription_id" text,
	"last_invoice_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_subscriptions_status_allowed" CHECK ("personal_subscriptions"."status" in ('trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled')),
	CONSTRAINT "personal_subscriptions_collection_method_allowed" CHECK ("personal_subscriptions"."collection_method" in ('charge_automatically', 'invoice')),
	CONSTRAINT "personal_subscriptions_interval_allowed" CHECK ("personal_subscriptions"."interval" in ('monthly', 'yearly')),
	CONSTRAINT "personal_subscriptions_currency_allowed" CHECK ("personal_subscriptions"."collection_currency" in ('USD', 'NGN'))
);
--> statement-breakpoint
CREATE TABLE "user_brand_logos" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"size" integer NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_brand_logos_size_range" CHECK ("user_brand_logos"."size" > 0 and "user_brand_logos"."size" <= 2097152)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "brand_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "brand_logo_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "brand_color" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "brand_dark_color" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "booking_page_theme" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "hide_schedra_branding" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "personal_invoices" ADD CONSTRAINT "personal_invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_subscriptions" ADD CONSTRAINT "personal_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_brand_logos" ADD CONSTRAINT "user_brand_logos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "personal_invoices_reference_key" ON "personal_invoices" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "personal_invoices_user_created_idx" ON "personal_invoices" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "personal_invoices_checkout_idx" ON "personal_invoices" USING btree ("bachs_checkout_id");--> statement-breakpoint
CREATE INDEX "personal_subscriptions_status_idx" ON "personal_subscriptions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_subscriptions_bachs_subscription_key" ON "personal_subscriptions" USING btree ("bachs_subscription_id") WHERE "personal_subscriptions"."bachs_subscription_id" is not null;--> statement-breakpoint
CREATE TRIGGER schedra_set_updated_at BEFORE UPDATE ON "personal_invoices" FOR EACH ROW EXECUTE FUNCTION public.schedra_set_updated_at();--> statement-breakpoint
CREATE TRIGGER schedra_set_updated_at BEFORE UPDATE ON "personal_subscriptions" FOR EACH ROW EXECUTE FUNCTION public.schedra_set_updated_at();--> statement-breakpoint
CREATE TRIGGER schedra_set_updated_at BEFORE UPDATE ON "user_brand_logos" FOR EACH ROW EXECUTE FUNCTION public.schedra_set_updated_at();
