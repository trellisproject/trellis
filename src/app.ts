import { Hono } from "hono";
import { cors } from "hono/cors";
import { projectRoutes } from "./routes/projects.js";
import { specRoutes } from "./routes/specs.js";
import { factRoutes } from "./routes/facts.js";
import { decisionRoutes } from "./routes/decisions.js";
import { taskRoutes } from "./routes/tasks.js";
import { challengeRoutes } from "./routes/challenges.js";
import { effortRoutes } from "./routes/efforts.js";
import { githubRoutes } from "./routes/github.js";
import { requestRoutes } from "./routes/requests.js";
import { worklistRoutes } from "./routes/worklist.js";
import { authenticate } from "./middleware/auth.js";
import type { AppEnv } from "./types.js";

export const app = new Hono<AppEnv>();

// Browser UI calls the API cross-origin. Dev: allow all; tighten for prod.
app.use("*", cors({ origin: (o) => o ?? "*", allowHeaders: ["Authorization", "Content-Type"], allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] }));
app.use("*", authenticate);

app.get("/health", (c) => c.json({ ok: true, service: "trellis" }));

app.route("/", projectRoutes);
app.route("/", specRoutes);
app.route("/", factRoutes);
app.route("/", decisionRoutes);
app.route("/", taskRoutes);
app.route("/", challengeRoutes);
app.route("/", effortRoutes);
app.route("/", githubRoutes);
app.route("/", requestRoutes);
app.route("/", worklistRoutes);

export type App = typeof app;
