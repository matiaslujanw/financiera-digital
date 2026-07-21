import { z } from "zod";
import { and, eq } from "drizzle-orm";

import { Business } from "~/server/db/schema";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertMembership } from "../lib/guards";

export const businessRouter = createTRPCRouter({
	byGuildSlug: protectedProcedure
		.input(z.object({ guildSlug: z.string() }))
		.query(async ({ ctx, input }) => {
			await assertMembership(ctx.db, ctx.user.id, input.guildSlug);
			return ctx.db.query.Business.findMany({
				where: and(
					eq(Business.guildSlug, input.guildSlug),
					eq(Business.discharged, true),
				),
				orderBy: (b, { asc }) => [asc(b.createdAt)],
			});
		}),
});
