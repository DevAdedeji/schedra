CREATE TABLE "booking_hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_organizer" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_hosts_ends_after_starts" CHECK ("booking_hosts"."ends_at" > "booking_hosts"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "booking_hosts" ADD CONSTRAINT "booking_hosts_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_hosts" ADD CONSTRAINT "booking_hosts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_hosts_booking_user_key" ON "booking_hosts" USING btree ("booking_id","user_id");--> statement-breakpoint
CREATE INDEX "booking_hosts_user_starts_idx" ON "booking_hosts" USING btree ("user_id","starts_at");