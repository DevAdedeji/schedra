ALTER TABLE "rate_limits" DROP CONSTRAINT "rate_limits_pkey";--> statement-breakpoint
ALTER TABLE "rate_limits" ADD COLUMN "id" text;--> statement-breakpoint
UPDATE "rate_limits" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;--> statement-breakpoint
ALTER TABLE "rate_limits" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_limits" ADD CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limits_key_key" ON "rate_limits" USING btree ("key");
