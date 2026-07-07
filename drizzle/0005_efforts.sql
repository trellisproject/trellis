ALTER TABLE "milestones" ADD COLUMN "status" text DEFAULT 'next' NOT NULL;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "goal_type" text DEFAULT 'checklist' NOT NULL;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "goal_target" text;