import { z } from "zod";
import { and, eq } from "drizzle-orm";

import { AccountOnBusiness, Business } from "~/server/db/schema";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertMembership } from "../lib/guards";

export const accountOnBusinessRouter = createTRPCRouter({
	// Resumen de cuentas del guild: cada Business con sus cuentas (top-level)
	// y el detalle del plan de cuentas asociado. El cliente agrupa por tipo.
	guildSummary: protectedProcedure
		.input(z.object({ guildSlug: z.string() }))
		.query(async ({ ctx, input }) => {
			await assertMembership(ctx.db, ctx.user.id, input.guildSlug);

			const businesses = await ctx.db.query.Business.findMany({
				where: and(
					eq(Business.guildSlug, input.guildSlug),
					eq(Business.discharged, true),
				),
				orderBy: (b, { asc }) => [asc(b.createdAt)],
				with: {
					accountsOnBusinesses: {
						where: and(
							eq(AccountOnBusiness.discharged, true),
							eq(AccountOnBusiness.subAccount, false),
						),
						with: { dictionaryAccount: true },
					},
				},
			});

			return businesses.map((business) => ({
				id: business.id,
				name: business.name,
				businessSlug: business.businessSlug,
				image: business.image,
				accounts: business.accountsOnBusinesses
					.filter((a) => a.dictionaryAccount)
					.map((a) => ({
						id: a.id,
						name: a.name ?? a.dictionaryAccount!.name,
						currentBalance: a.currentBalance ?? "0",
						accountType: a.dictionaryAccount!.accountType,
						currency: a.dictionaryAccount!.currency,
						checkAccount: a.dictionaryAccount!.checkAccount,
						availability: a.dictionaryAccount!.availability,
						hasSubAccounts: a.dictionaryAccount!.hasSubAccounts,
						dictionaryAccountId: a.dictionaryAccountId,
					})),
			}));
		}),
});
