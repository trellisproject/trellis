ALTER TABLE "assertions" ADD COLUMN "metric_key" text;--> statement-breakpoint
ALTER TABLE "assertions" ADD COLUMN "metric_comparator" text;--> statement-breakpoint
ALTER TABLE "assertions" ADD COLUMN "metric_target" double precision;--> statement-breakpoint
ALTER TABLE "assertions" ADD COLUMN "metric_unit" text;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "metric_key" text;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "measured_value" double precision;