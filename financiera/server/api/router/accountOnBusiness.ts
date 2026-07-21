import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";

import {
	AccountTypeEnum,
	AccountOnBusiness,
	Business,
	CurrencyEnum,
	DictionaryAccount,
	Transaction,
} from "~/server/db/schema";
import { slugify } from "~/server/bootstrap";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertMembership } from "../lib/guards";

export const accountOnBusinessRouter = createTRPCRouter({
	create: protectedProcedure
		.input(
			z.object({
				guildSlug: z.string().min(1),
				businessId: z.string().uuid(),
				name: z.string().trim().min(2).max(255),
				accountType: z.enum(AccountTypeEnum.enumValues),
				currency: z.enum(CurrencyEnum.enumValues),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await assertMembership(ctx.db, ctx.user.id, input.guildSlug);

			const business = await ctx.db.query.Business.findFirst({
				where: and(
					eq(Business.id, input.businessId),
					eq(Business.guildSlug, input.guildSlug),
					eq(Business.discharged, true),
				),
			});
			if (!business) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Empresa no encontrada",
				});
			}

			return ctx.db.transaction(async (tx) => {
				const currentAccounts = await tx.query.AccountOnBusiness.findMany({
					where: and(
						eq(AccountOnBusiness.businessId, business.id),
						eq(AccountOnBusiness.subAccount, false),
						eq(AccountOnBusiness.discharged, true),
					),
					with: { dictionaryAccount: true },
				});
				const normalizedName = input.name.trim().toLocaleLowerCase("es");
				const duplicate = currentAccounts.some(
					(account) =>
						(account.name ?? account.dictionaryAccount.name)
							.trim()
							.toLocaleLowerCase("es") === normalizedName &&
						account.dictionaryAccount.currency === input.currency,
				);
				if (duplicate) {
					throw new TRPCError({
						code: "CONFLICT",
						message: `Ya existe una cuenta ${input.name.trim()} en ${input.currency}`,
					});
				}

				const [dictionaryAccount] = await tx
					.insert(DictionaryAccount)
					.values({
						name: input.name.trim(),
						accountType: input.accountType,
						currency: input.currency,
						guildSlug: input.guildSlug,
						slug: slugify(`${input.name}-${input.currency}`),
						availability: input.accountType === "ASSET",
						checkAccount: false,
						hasSubAccounts: false,
					})
					.returning();
				if (!dictionaryAccount) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "No se pudo crear la definición de cuenta",
					});
				}

				const [account] = await tx
					.insert(AccountOnBusiness)
					.values({
						businessId: business.id,
						dictionaryAccountId: dictionaryAccount.id,
						currentBalance: "0",
						subAccount: false,
					})
					.returning();

				return {
					id: account!.id,
					name: dictionaryAccount.name,
					accountType: dictionaryAccount.accountType,
					currency: dictionaryAccount.currency,
					businessId: business.id,
					businessName: business.name,
					currentBalance: account!.currentBalance ?? "0",
				};
			});
		}),

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

	/** Mayor contable de una cuenta. Las cuentas agregadas incluyen sus subcuentas. */
	accountMovements: protectedProcedure
		.input(
			z.object({
				guildSlug: z.string(),
				accountId: z.string().uuid(),
				limit: z.number().min(1).max(100).default(30),
				cursor: z
					.object({ date: z.date(), createdAt: z.date() })
					.nullish(),
			}),
		)
		.query(async ({ ctx, input }) => {
			await assertMembership(ctx.db, ctx.user.id, input.guildSlug);

			const account = await ctx.db.query.AccountOnBusiness.findFirst({
				where: and(
					eq(AccountOnBusiness.id, input.accountId),
					eq(AccountOnBusiness.discharged, true),
				),
				with: {
					business: true,
					dictionaryAccount: true,
					person: true,
					machinery: true,
					vehicle: true,
					property: true,
				},
			});

			if (!account || account.business.guildSlug !== input.guildSlug) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Cuenta no encontrada",
				});
			}

			let accountIds = [account.id];
			if (account.dictionaryAccount.hasSubAccounts && !account.subAccount) {
				const children = await ctx.db
					.select({ id: AccountOnBusiness.id })
					.from(AccountOnBusiness)
					.where(
						and(
							eq(AccountOnBusiness.businessId, account.businessId),
							eq(
								AccountOnBusiness.dictionaryAccountId,
								account.dictionaryAccountId,
							),
							eq(AccountOnBusiness.subAccount, true),
							eq(AccountOnBusiness.discharged, true),
						),
					);
				accountIds = [account.id, ...children.map((child) => child.id)];
			}

			const rows = await ctx.db.query.Transaction.findMany({
				where: and(
					inArray(Transaction.toAccountId, accountIds),
					eq(Transaction.discharged, true),
					input.cursor
						? or(
								lt(Transaction.date, input.cursor.date),
								and(
									eq(Transaction.date, input.cursor.date),
									lt(Transaction.createdAt, input.cursor.createdAt),
								),
							)
						: undefined,
				),
				orderBy: [desc(Transaction.date), desc(Transaction.createdAt)],
				limit: input.limit + 1,
				with: {
					toAccount: {
						with: {
							business: true,
							dictionaryAccount: true,
							person: true,
							machinery: true,
							vehicle: true,
							property: true,
						},
					},
					fromAccount: {
						with: { business: true, dictionaryAccount: true },
					},
					member: { with: { user: true } },
					person: true,
					category: true,
					transactionGroup: true,
				},
			});

			let nextCursor: { date: Date; createdAt: Date } | null = null;
			if (rows.length > input.limit) {
				rows.pop();
				const last = rows.at(-1);
				nextCursor = last
					? { date: last.date, createdAt: last.createdAt }
					: null;
			}

			return {
				account: {
					id: account.id,
					name: account.name ?? account.dictionaryAccount.name,
					businessName: account.business.name,
					currentBalance: account.currentBalance ?? "0",
					currency: account.dictionaryAccount.currency,
					accountType: account.dictionaryAccount.accountType,
					hasSubAccounts: account.dictionaryAccount.hasSubAccounts,
				},
				items: rows,
				nextCursor,
			};
		}),
});
