import { z } from "zod";
import { and, eq } from "drizzle-orm";

import { DictionaryAccount } from "~/server/db/schema";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertMembership } from "../lib/guards";

export const dictionaryAccountRouter = createTRPCRouter({
	// Plan de cuentas del guild.
	byGuildSlug: protectedProcedure
		.input(z.object({ guildSlug: z.string() }))
		.query(async ({ ctx, input }) => {
			await assertMembership(ctx.db, ctx.user.id, input.guildSlug);
			return ctx.db.query.DictionaryAccount.findMany({
				where: and(
					eq(DictionaryAccount.guildSlug, input.guildSlug),
					eq(DictionaryAccount.discharged, true),
				),
				orderBy: (d, { asc }) => [asc(d.accountType), asc(d.name)],
			});
		}),
});
