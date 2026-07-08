CREATE TABLE "diagram_edges" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"diagram_id" text NOT NULL,
	"from_node_id" text NOT NULL,
	"to_node_id" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagram_nodes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"diagram_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'step' NOT NULL,
	"effort_id" text,
	"assertion_id" text,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagrams" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"direction" text DEFAULT 'TD' NOT NULL,
	"parent_node_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diagram_edges" ADD CONSTRAINT "diagram_edges_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_edges" ADD CONSTRAINT "diagram_edges_diagram_id_diagrams_id_fk" FOREIGN KEY ("diagram_id") REFERENCES "public"."diagrams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_edges" ADD CONSTRAINT "diagram_edges_from_node_id_diagram_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."diagram_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_edges" ADD CONSTRAINT "diagram_edges_to_node_id_diagram_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."diagram_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_nodes" ADD CONSTRAINT "diagram_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_nodes" ADD CONSTRAINT "diagram_nodes_diagram_id_diagrams_id_fk" FOREIGN KEY ("diagram_id") REFERENCES "public"."diagrams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_nodes" ADD CONSTRAINT "diagram_nodes_effort_id_milestones_id_fk" FOREIGN KEY ("effort_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_nodes" ADD CONSTRAINT "diagram_nodes_assertion_id_assertions_id_fk" FOREIGN KEY ("assertion_id") REFERENCES "public"."assertions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagrams" ADD CONSTRAINT "diagrams_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dedge_diagram" ON "diagram_edges" USING btree ("diagram_id");--> statement-breakpoint
CREATE INDEX "dnode_diagram" ON "diagram_nodes" USING btree ("diagram_id");--> statement-breakpoint
CREATE INDEX "diagram_project_key" ON "diagrams" USING btree ("project_id","key");