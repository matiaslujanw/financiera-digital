// Proceso dedicado que corre UNA sola instancia de PGlite (Postgres embebido)
// y la sirve por socket (protocolo Postgres). Así todos los procesos/workers de
// Next dev comparten la misma DB, sin conflictos de múltiples escritores.
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const dataDir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".pglite");
const port = Number(process.env.PGLITE_PORT ?? 5433);

const pglite = new PGlite(dataDir);
await pglite.waitReady;
console.log(`[pg-server] PGlite lista (${dataDir})`);

// Migraciones: instancia única, sin race.
await migrate(drizzle(pglite), {
	migrationsFolder: path.join(process.cwd(), "drizzle"),
});
console.log("[pg-server] migraciones aplicadas");

const server = new PGLiteSocketServer({
	db: pglite,
	port,
	host: "127.0.0.1",
	maxConnections: 100,
});
await server.start();
console.log(`[pg-server] escuchando en 127.0.0.1:${port}`);

async function shutdown() {
	try {
		await server.stop();
		await pglite.close();
	} finally {
		process.exit(0);
	}
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
