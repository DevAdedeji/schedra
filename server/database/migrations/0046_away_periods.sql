CREATE TABLE "away_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "away_periods_dates_ordered" CHECK ("away_periods"."end_date" >= "away_periods"."start_date")
);
--> statement-breakpoint
ALTER TABLE "away_periods" ADD CONSTRAINT "away_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "away_periods_user_dates_idx" ON "away_periods" USING btree ("user_id","start_date","end_date");--> statement-breakpoint
ALTER TABLE "away_periods"
	ADD CONSTRAINT "away_periods_no_overlap_per_user"
	EXCLUDE USING gist (
		"user_id" WITH =,
		daterange("start_date", "end_date", '[]') WITH &&
	);--> statement-breakpoint
CREATE TRIGGER schedra_set_updated_at BEFORE UPDATE ON "away_periods" FOR EACH ROW EXECUTE FUNCTION public.schedra_set_updated_at();
