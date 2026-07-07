ALTER TABLE "milestones" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "commitment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_owner_id_principals_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;