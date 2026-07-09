DROP INDEX "chat_install_provider_workspace";--> statement-breakpoint
ALTER TABLE "chat_installs" ADD COLUMN "channel_id" text;--> statement-breakpoint
ALTER TABLE "chat_installs" ADD CONSTRAINT "chat_install_provider_workspace_channel" UNIQUE NULLS NOT DISTINCT("provider","workspace_id","channel_id");