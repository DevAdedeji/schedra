CREATE TABLE "booking_link_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_link_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_link_slots_ends_after_starts" CHECK ("booking_link_slots"."ends_at" > "booking_link_slots"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "booking_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_links_kind_allowed" CHECK ("booking_links"."kind" in ('single_use', 'one_off')),
	CONSTRAINT "booking_links_expiry_after_creation" CHECK ("booking_links"."expires_at" > "booking_links"."created_at")
);
--> statement-breakpoint
ALTER TABLE "booking_link_slots" ADD CONSTRAINT "booking_link_slots_booking_link_id_booking_links_id_fk" FOREIGN KEY ("booking_link_id") REFERENCES "public"."booking_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_links" ADD CONSTRAINT "booking_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_links" ADD CONSTRAINT "booking_links_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_link_slots_link_start_key" ON "booking_link_slots" USING btree ("booking_link_id","starts_at");--> statement-breakpoint
CREATE INDEX "booking_link_slots_link_idx" ON "booking_link_slots" USING btree ("booking_link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_links_token_hash_key" ON "booking_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "booking_links_user_created_idx" ON "booking_links" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "booking_links_event_type_idx" ON "booking_links" USING btree ("event_type_id");