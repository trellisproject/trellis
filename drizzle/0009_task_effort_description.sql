ALTER TABLE "tasks" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "effort_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_effort_id_milestones_id_fk" FOREIGN KEY ("effort_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;