import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";

const handler = (req: Request) =>
	fetchRequestHandler({
		endpoint: "/api/trpc",
		req,
		router: appRouter,
		createContext: () => createTRPCContext({ headers: req.headers }),
		onError({ error, path }) {
			console.error(`❌ tRPC error en ${path ?? "<no-path>"}:`, error.message);
		},
	});

export { handler as GET, handler as POST };
