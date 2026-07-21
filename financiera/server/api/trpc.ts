import { initTRPC, TRPCError } from "@trpc/server";
import SuperJSON from "superjson";
import { ZodError } from "zod";

import { db, dbReady } from "~/server/db";
import { getSessionUser } from "~/server/auth";

/**
 * Contexto de tRPC. Se crea tanto en RSC como en el route handler.
 * Expone `db` y `user` (el usuario logueado, o null).
 */
export const createTRPCContext = async (opts?: { headers?: Headers }) => {
	await dbReady;
	const user = await getSessionUser();
	return { db, user, headers: opts?.headers };
};

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<TRPCContext>().create({
	transformer: SuperJSON,
	errorFormatter({ shape, error }) {
		return {
			...shape,
			data: {
				...shape.data,
				zodError:
					error.cause instanceof ZodError ? error.cause.flatten() : null,
			},
		};
	},
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;

export const publicProcedure = t.procedure;

/** Requiere sesión. Garantiza `ctx.user` no-nulo para el resto del pipeline. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.user) {
		throw new TRPCError({ code: "UNAUTHORIZED", message: "No autenticado" });
	}
	return next({ ctx: { ...ctx, user: ctx.user } });
});
