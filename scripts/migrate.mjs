// Apply pending migrations. Run in the Vercel production build (before the new
// code goes live) so schema and code ship together. Uses drizzle-orm's
// migrator (a runtime dep) + the direct/unpooled connection for DDL.
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL;
if (!url) {
  console.error("migrate: no database url in env");
  process.exit(1);
}

const client = postgres(url, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("migrate: applied");
} catch (e) {
  console.error("migrate: failed —", e.message);
  process.exit(1);
} finally {
  await client.end();
}
