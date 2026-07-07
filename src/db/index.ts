import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// prepare:false keeps us compatible with transaction-pooled connections
// (Neon/PgBouncer) used in serverless; harmless locally.
const client = postgres(url, { prepare: false });
export const db = drizzle(client, { schema });
export { schema };
