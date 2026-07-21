import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { AuthUsers } from "./auth";
import * as schema from "./schema";

const fullSchema = { ...schema, AuthUsers };

// Nos conectamos al pg-server (PGlite por socket). Cambiar DATABASE_URL para
// apuntar a un Postgres real (Neon/Supabase) sin tocar el resto del código.
const connectionString =
	process.env.DATABASE_URL ??
	`postgres://postgres:postgres@127.0.0.1:${process.env.PGLITE_PORT ?? 5433}/postgres`;

const globalForDb = globalThis as unknown as {
	__pgPool?: Pool;
	__dbReady?: Promise<unknown>;
};

const pool = globalForDb.__pgPool ?? new Pool({ connectionString, max: 5 });
if (process.env.NODE_ENV !== "production") globalForDb.__pgPool = pool;

export const db = drizzle(pool, { schema: fullSchema });

// Espera a que el pg-server esté disponible (arranca en paralelo con `next dev`).
// Awaiteá `dbReady` antes de tocar la DB (contexto tRPC, auth, server actions).
async function waitForDb(): Promise<void> {
	for (let i = 0; i < 60; i++) {
		try {
			await pool.query("select 1");
			return;
		} catch {
			await new Promise((r) => setTimeout(r, 300));
		}
	}
	throw new Error("No se pudo conectar a la DB (¿está corriendo el pg-server?)");
}

export const dbReady = globalForDb.__dbReady ?? waitForDb();
globalForDb.__dbReady = dbReady;

export { schema };
