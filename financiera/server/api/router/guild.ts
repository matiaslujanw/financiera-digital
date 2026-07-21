import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { Guild, Member } from "~/server/db/schema";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const guildRouter = createTRPCRouter({
	// Todos los negocios (guilds) donde el usuario es miembro activo.
	all: protectedProcedure.query(async ({ ctx }) => {
		const members = await ctx.db.query.Member.findMany({
			where: and(eq(Member.userId, ctx.user.id), eq(Member.discharged, true)),
			with: { guild: true },
		});
		return members
			.map((m) => m.guild)
			.filter((g): g is NonNullable<typeof g> => !!g && g.discharged);
	}),

	bySlug: protectedProcedure
		.input(z.object({ guildSlug: z.string() }))
		.query(async ({ ctx, input }) => {
			const member = await ctx.db.query.Member.findFirst({
				where: and(
					eq(Member.userId, ctx.user.id),
					eq(Member.guildSlug, input.guildSlug),
					eq(Member.discharged, true),
				),
			});
			if (!member) {
				throw new TRPCError({ code: "FORBIDDEN", message: "Sin acceso a este negocio" });
			}
			const guild = await ctx.db.query.Guild.findFirst({
				where: eq(Guild.guildSlug, input.guildSlug),
			});
			if (!guild) throw new TRPCError({ code: "NOT_FOUND" });
			return { ...guild, role: member.role };
		}),
});
