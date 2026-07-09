ALTER TABLE "agent_tokens" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "captured_by" text;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_captured_by_principals_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;