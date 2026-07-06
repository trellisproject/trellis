import { Hono } from "hono";
import { projectRoutes } from "./routes/projects.js";
import { specRoutes } from "./routes/specs.js";
import { factRoutes } from "./routes/facts.js";

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, service: "trellis" }));

app.route("/", projectRoutes);
app.route("/", specRoutes);
app.route("/", factRoutes);

export type App = typeof app;
