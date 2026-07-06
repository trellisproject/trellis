import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

// Creates and migrates the trellis_test database once before the suite. The
// dev container (npm run db:up) must be running.
const HOST = process.env.TEST_PG_HOST ?? "postgres://trellis:trellis@localhost:5440";
const TEST_DB = "trellis_test";

export default async function setup() {
  const admin = postgres(`${HOST}/trellis`, { max: 1 });
  try {
    const existing = await admin`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB}`;
    if (existing.length === 0) await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }

  const client = postgres(`${HOST}/${TEST_DB}`, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  } finally {
    await client.end();
  }
}
