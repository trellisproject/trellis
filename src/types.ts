// Shared Hono environment: request-scoped auth context set by the
// authenticate middleware and read by route handlers.
export type AppEnv = {
  Variables: {
    principalId?: string;
    principalKind?: "human" | "agent";
    tokenProjectId?: string;
    tokenScope?: "full" | "capture";
  };
};
