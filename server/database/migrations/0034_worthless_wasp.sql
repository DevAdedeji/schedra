ALTER TABLE "routing_responses" DROP CONSTRAINT "routing_responses_form_id_routing_forms_id_fk";
--> statement-breakpoint
ALTER TABLE "routing_responses" ADD CONSTRAINT "routing_responses_form_id_routing_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."routing_forms"("id") ON DELETE cascade ON UPDATE no action;