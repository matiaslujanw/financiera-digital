import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import type { db as Database } from "~/server/db";
import { Member } from "~/server/db/schema";

/** Verifica que el usuario sea miembro activo del guild. Devuelve el Member. */
export async function assertMembership(
	db: typeof Database,
	userId: string,
	guildSlug: string,
) {
	const member = await db.query.Member.findFirst({
		where: and(
			eq(Member.userId, userId),
			eq(Member.guildSlug, guildSlug),
			eq(Member.discharged, true),
		),
	});
	if (!member) {
		throw new TRPCError({ code: "FORBIDDEN", message: "Sin acceso a este negocio" });
	}
	return member;
}
