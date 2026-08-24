CREATE TABLE "user_avatars" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"size" integer NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_avatars_size_range" CHECK ("user_avatars"."size" > 0 and "user_avatars"."size" <= 2097152)
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "additional_guest_emails" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "event_types" ADD COLUMN "requires_confirmation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;