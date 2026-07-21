import { z } from "zod";
import {
	and,
	countDistinct,
	desc,
	eq,
	gte,
	ilike,
	inArray,
	lte,
	max,
	or,
} from "drizzle-orm";

import {
	OperationTypeEnum,
	Transaction,
	TransactionGroup,
} from "~/server/db/schema";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertMembership } from "../lib/guards";

const filtersSchema = z.object({
	guildSlug: z.string(),
	limit: z.number().min(1).max(100).default(25),
	cursor: z.number().int().min(0).nullish(),
	search: z.string().trim().max(100).optional(),
	operationType: z.enum(OperationTypeEnum.enumValues).optional(),
	dateFrom: z.date().optional(),
	dateTo: z.date().optional(),
});

function decimal(value: string | null | undefined): number {
	return Number.parseFloat(value ?? "0") || 0;
}

function decimalForDisplay(value: number): string {
	return new Intl.NumberFormat("es-AR", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 8,
	}).format(value);
}

export const operationRouter = createTRPCRouter({
	byGuildSlug: protectedProcedure
		.input(filtersSchema)
		.query(async ({ ctx, input }) => {
			await assertMembership(ctx.db, ctx.user.id, input.guildSlug);

			const search = input.search?.trim();
			const where = and(
				eq(TransactionGroup.guildSlug, input.guildSlug),
				eq(TransactionGroup.discharged, true),
				input.operationType
					? eq(TransactionGroup.operationType, input.operationType)
					: undefined,
				input.dateFrom
					? gte(Transaction.date, input.dateFrom)
					: undefined,
				input.dateTo
					? lte(Transaction.date, input.dateTo)
					: undefined,
				search
					? or(
							ilike(TransactionGroup.name, `%${search}%`),
							ilike(TransactionGroup.description, `%${search}%`),
						)
					: undefined,
			);

			const offset = input.cursor ?? 0;

			const [totalRow, groupRows] = await Promise.all([
				ctx.db
					.select({ value: countDistinct(TransactionGroup.id) })
					.from(TransactionGroup)
					.leftJoin(
						Transaction,
						eq(Transaction.transactionGroupId, TransactionGroup.id),
					)
					.where(where),
				ctx.db
					.select({
						id: TransactionGroup.id,
						operationDate: max(Transaction.date),
						createdAt: TransactionGroup.createdAt,
					})
					.from(TransactionGroup)
					.leftJoin(
						Transaction,
						eq(Transaction.transactionGroupId, TransactionGroup.id),
					)
					.where(where)
					.groupBy(TransactionGroup.id)
					.orderBy(desc(max(Transaction.date)), desc(TransactionGroup.createdAt))
					.limit(input.limit + 1)
					.offset(offset),
			]);

			let nextCursor: number | null = null;
			if (groupRows.length > input.limit) {
				groupRows.pop();
				nextCursor = offset + input.limit;
			}

			const unorderedGroups =
				groupRows.length === 0
					? []
					: await ctx.db.query.TransactionGroup.findMany({
						where: inArray(
							TransactionGroup.id,
							groupRows.map((row) => row.id),
						),
						with: {
							business: true,
							transactions: {
								where: (transaction, { eq }) =>
									eq(transaction.discharged, true),
								orderBy: (transaction, { desc }) => [
									desc(transaction.date),
									desc(transaction.createdAt),
								],
								with: {
									toAccount: {
										with: { dictionaryAccount: true, business: true },
									},
									fromAccount: {
										with: { dictionaryAccount: true, business: true },
									},
									person: true,
									member: { with: { user: true } },
									category: true,
								},
							},
							checksOnTransactionGroup: {
								with: {
									check: {
										with: { person: true, buyerPerson: true },
									},
								},
							},
						},
					});
			const groupMap = new Map(unorderedGroups.map((group) => [group.id, group]));
			const groups = groupRows.flatMap((row) => {
				const group = groupMap.get(row.id);
				return group ? [group] : [];
			});

			const items = groups.map((group) => {
				const checks = group.checksOnTransactionGroup.map((link) => link.check);
				const grossAmount = checks.reduce(
					(sum, check) => sum + decimal(check.grossValue),
					0,
				);
				const purchaseNetAmount = checks.reduce(
					(sum, check) => sum + decimal(check.netValue),
					0,
				);
				const saleNetAmount = checks.reduce(
					(sum, check) => sum + decimal(check.saleNetValue),
					0,
				);
				const purchaseDiscount = checks.reduce(
					(sum, check) =>
						sum +
						decimal(check.serviceFeeAmount) +
						decimal(check.interestRateAmount),
					0,
				);
				const saleDiscount = checks.reduce(
					(sum, check) =>
						sum +
						decimal(check.saleServiceFeeAmount) +
						decimal(check.saleInterestRateAmount),
					0,
				);

				let amount = group.transactions.reduce(
					(max, transaction) => Math.max(max, decimal(transaction.amount)),
					0,
				);
				let secondaryAmount: number | null = null;
				let secondaryLabel: string | null = null;
				let secondaryCurrency: string | null = null;
				let metricAmount: number | null = null;
				let metricLabel: string | null = null;
				let metricText: string | null = null;
				let currency =
					checks[0]?.currency ??
					group.transactions[0]?.toAccount.dictionaryAccount.currency ??
					"ARS";

				if (group.operationType === "CHECK_PURCHASE") {
					amount = purchaseNetAmount;
					secondaryAmount = grossAmount;
					secondaryLabel = "Nominal";
					secondaryCurrency = currency;
					metricAmount = purchaseDiscount;
					metricLabel = "Descuento";
				} else if (group.operationType === "CHECK_SALE") {
					amount = saleNetAmount;
					secondaryAmount = grossAmount;
					secondaryLabel = "Nominal";
					secondaryCurrency = currency;
					metricAmount = saleNetAmount - purchaseNetAmount;
					metricLabel = "Resultado";
				} else if (
					group.operationType === "CHECK_DEPOSIT" ||
					group.operationType === "CHECK_REJECTION"
				) {
					amount = grossAmount;
				} else if (group.operationType === "CURRENCY_EXCHANGE") {
					const destinationTransaction = group.transactions.find(
						(transaction) => transaction.fromAccountId,
					);
					const sourceTransaction = destinationTransaction?.fromAccountId
						? group.transactions.find(
								(transaction) =>
									transaction.toAccountId ===
									destinationTransaction.fromAccountId,
							)
						: undefined;
					if (sourceTransaction && destinationTransaction) {
						const sourceAmount = decimal(sourceTransaction.amount);
						const destinationAmount = decimal(destinationTransaction.amount);
						const sourceCurrency =
							sourceTransaction.toAccount.dictionaryAccount.currency;
						const destinationCurrency =
							destinationTransaction.toAccount.dictionaryAccount.currency;
						amount = destinationAmount;
						currency = destinationCurrency;
						secondaryAmount = sourceAmount;
						secondaryCurrency = sourceCurrency;
						secondaryLabel = "Sale";
						metricLabel = "Cotización";
						metricText =
							sourceCurrency === "ARS" && destinationCurrency !== "ARS"
								? `1 ${destinationCurrency} = ${decimalForDisplay(sourceAmount / destinationAmount)} ${sourceCurrency}`
								: `1 ${sourceCurrency} = ${decimalForDisplay(destinationAmount / sourceAmount)} ${destinationCurrency}`;
					}
				}

				const firstCheck = checks[0];
				const counterpart =
					group.operationType === "CHECK_SALE"
						? firstCheck?.buyerPerson?.name
						: firstCheck?.person?.name ?? group.transactions[0]?.person?.name;

				return {
					id: group.id,
					createdAt: group.createdAt,
					date: group.transactions[0]?.date ?? group.createdAt,
					name: group.name,
					description: group.description,
					operationType: group.operationType,
					businessName: group.business?.name ?? null,
					counterpart: counterpart ?? null,
					currency,
					amount,
					secondaryAmount,
					secondaryLabel,
					secondaryCurrency,
					metricAmount,
					metricLabel,
					metricText,
					purchaseDiscount,
					saleDiscount,
					transactions: group.transactions,
					checks,
				};
			});

			return {
				items,
				total: totalRow[0]?.value ?? 0,
				nextCursor,
			};
		}),
});
