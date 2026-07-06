import { Hono } from "hono";
import { projectRoutes } from "./routes/projects.js";
import { specRoutes } from "./routes/specs.js";
import { factRoutes } from "./routes/facts.js";
import { decisionRoutes } from "./routes/decisions.js";
import { taskRoutes } from "./routes/tasks.js";
import { challengeRoutes } from "./routes/challenges.js";
import { authenticate } from "./middleware/auth.js";
import type { AppEnv } from "./types.js";

export const app = new Hono<AppEnv>();

app.use("*", authenticate);

app.get("/health", (c) => c.json({ ok: true, service: "trellis" }));

app.route("/", projectRoutes);
app.route("/", specRoutes);
app.route("/", factRoutes);
app.route("/", decisionRoutes);
app.route("/", taskRoutes);
app.route("/", challengeRoutes);

export type App = typeof app;
