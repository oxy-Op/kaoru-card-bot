import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config.js";
import * as schema from "./schema.js";

const queryClient = postgres(config.DATABASE_URL, {
  max: 20, // connection pool size
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });
export type Database = typeof db;
