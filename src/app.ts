import { Hono } from "hono";
import { projectRoutes } from "./routes/projects.js";
import { specRoutes } from "./routes/specs.js";

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, service: "trellis" }));

app.route("/", projectRoutes);
app.route("/", specRoutes);

export type App = typeof app;
