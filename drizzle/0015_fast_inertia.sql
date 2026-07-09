CREATE TABLE "chat_installs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"provider" text NOT NULL,
	"workspace_id" text NOT NULL,
	"capture_principal_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_installs" ADD CONSTRAINT "chat_installs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_installs" ADD CONSTRAINT "chat_installs_capture_principal_id_principals_id_fk" FOREIGN KEY ("capture_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_install_provider_workspace" ON "chat_installs" USING btree ("provider","workspace_id");