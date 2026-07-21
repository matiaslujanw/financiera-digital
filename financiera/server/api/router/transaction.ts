import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";

import {
	AccountOnBusiness,
	Business,
	DictionaryAccount,
	Document,
	Transaction,
	TransactionGroup,
} from "~/server/db/schema";
import {
	CurrencyExchangeSchema,
	TransactionCreateSchema,
} from "~/server/validators";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertMembership } from "../lib/guards";
import { dayjs } from "../lib/dayjs";
import { calculateCurrencyExchange } from "../lib/financial-utils";
import {
	combineDateWithCurrentTime,
	convertAmount,
	formatForSubmit,
	updateParentAccount,
} from "../lib/utils";

// --- Lógica contable ---
// ASSET/REVENUE: incremento = DEBIT, decremento = CREDIT.
// EXPENSE/LIABILITY: incremento = CREDIT, decremento = DEBIT.
function getTransactionType(
	accountType: string,
	isIncrement: boolean,
): "DEBIT" | "CREDIT" {
	if (accountType === "ASSET" || accountType === "REVENUE") {
		return isIncrement ? "DEBIT" : "CREDIT";
	}
	return isIncrement ? "CREDIT" : "DEBIT";
}

function calculateNewBalance(
	accountType: string,
	oldBalance: number,
	transactionType: "DEBIT" | "CREDIT",
	amount: number,
): number {
	if (accountType === "ASSET" || accountType === "REVENUE") {
		return transactionType === "DEBIT" ? oldBalance + amount : oldBalance - amount;
	}
	return transactionType === "CREDIT" ? oldBalance + amount : oldBalance - amount;
}

function decimalForStorage(value: number): string {
	return value.toFixed(8).replace(/\.?0+$/, "") || "0";
}

/** IDs de las cuentas (top-level y subcuentas) de todos los negocios del guild. */
async function guildAccountIds(
	db: Parameters<typeof assertMembership>[0],
	guildSlug: string,
): Promise<string[]> {
	const businesses = await db
		.select({ id: Business.id })
		.from(Business)
		.where(and(eq(Business.guildSlug, guildSlug), eq(Business.discharged, true)));
	if (businesses.length === 0) return [];
	const accounts = await db
		.select({ id: AccountOnBusiness.id })
		.from(AccountOnBusiness)
		.where(
			inArray(
				AccountOnBusiness.businessId,
				businesses.map((b) => b.id),
			),
		);
	return accounts.map((a) => a.id);
}

const ENTITY_FIELD_MAP = {
	PERSON: "personId",
	MACHINERY: "machineryId",
	VEHICLE: "vehicleId",
	PROPERTY: "propertyId",
} as const;

export const transactionRouter = createTRPCRouter({
	create: protectedProcedure
		.input(TransactionCreateSchema)
		.mutation(async ({ ctx, input }) => {
			if (!input.toAccountId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Debes seleccionar una cuenta hacia.",
				});
			}
			if (!input.toBusinessId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Debes seleccionar una empresa hacia.",
				});
			}

			const member = await assertMembership(
				ctx.db,
				ctx.user.id,
				input.guildSlug,
			);

			const combinedDate = combineDateWithCurrentTime(
				input.date,
				input.isMidnight,
			);

			const amount =
				Number(formatForSubmit(input.movement.increment ?? "0")) ||
				Number(formatForSubmit(input.movement.decrement ?? "0")) ||
				0;

			if (amount <= 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Debe ingresar un monto válido mayor a 0",
				});
			}

			const getAccountWithDictionaryAccount = (accountId: string) =>
				ctx.db.query.AccountOnBusiness.findFirst({
					where: eq(AccountOnBusiness.id, accountId),
					with: { dictionaryAccount: true },
				});

			const getOrCreateMainAccount = async (
				dictionaryAccountId: string,
				businessId: string,
			) => {
				const existing = await ctx.db.query.AccountOnBusiness.findFirst({
					where: and(
						eq(AccountOnBusiness.dictionaryAccountId, dictionaryAccountId),
						eq(AccountOnBusiness.businessId, businessId),
						eq(AccountOnBusiness.subAccount, false),
					),
					with: { dictionaryAccount: true },
				});
				if (existing) return existing;
				const inserted = (
					await ctx.db
						.insert(AccountOnBusiness)
						.values({ businessId, dictionaryAccountId, subAccount: false })
						.returning()
				)[0];
				return getAccountWithDictionaryAccount(inserted!.id);
			};

			// --- Diccionarios de cuenta ---
			const toDictionaryAccount = await ctx.db.query.DictionaryAccount.findFirst({
				where: eq(DictionaryAccount.id, input.toAccountId),
			});
			if (!toDictionaryAccount) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Cuenta de destino no encontrada",
				});
			}

			let fromDictionaryAccount;
			if (input.fromAccountId) {
				fromDictionaryAccount = await ctx.db.query.DictionaryAccount.findFirst({
					where: eq(DictionaryAccount.id, input.fromAccountId),
				});
			}

			const isEntityRequired =
				toDictionaryAccount.hasSubAccounts ||
				(fromDictionaryAccount?.hasSubAccounts ?? false);
			if (isEntityRequired && !input.entityId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"Debe seleccionar una entidad para transacciones con cuentas agregadas",
				});
			}

			// Resuelve (o crea) la AccountOnBusiness real para un dictionaryAccount.
			const resolveAccount = async (
				dict: NonNullable<typeof toDictionaryAccount>,
				dictionaryAccountId: string,
				businessId: string,
			) => {
				if (dict.hasSubAccounts && input.entityId) {
					const entityField =
						ENTITY_FIELD_MAP[
							dict.entityType as keyof typeof ENTITY_FIELD_MAP
						];
					if (!entityField) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: "Tipo de entidad no válido para cuenta agregada",
						});
					}
					await getOrCreateMainAccount(dictionaryAccountId, businessId);
					const existingSub = await ctx.db.query.AccountOnBusiness.findFirst({
						where: and(
							eq(AccountOnBusiness.dictionaryAccountId, dictionaryAccountId),
							eq(AccountOnBusiness.businessId, businessId),
							eq(AccountOnBusiness.subAccount, true),
							eq(AccountOnBusiness[entityField], input.entityId),
						),
						with: { dictionaryAccount: true },
					});
					if (existingSub) return existingSub;
					const newSub: typeof AccountOnBusiness.$inferInsert = {
						businessId,
						dictionaryAccountId,
						subAccount: true,
						[entityField]: input.entityId,
					};
					const inserted = (
						await ctx.db.insert(AccountOnBusiness).values(newSub).returning()
					)[0];
					return getAccountWithDictionaryAccount(inserted!.id);
				}

				const existing = await ctx.db.query.AccountOnBusiness.findFirst({
					where: and(
						eq(AccountOnBusiness.dictionaryAccountId, dictionaryAccountId),
						eq(AccountOnBusiness.businessId, businessId),
						eq(AccountOnBusiness.subAccount, false),
					),
					with: { dictionaryAccount: true },
				});
				if (existing) return existing;
				const inserted = (
					await ctx.db
						.insert(AccountOnBusiness)
						.values({ businessId, dictionaryAccountId, subAccount: false })
						.returning()
				)[0];
				return getAccountWithDictionaryAccount(inserted!.id);
			};

			const toAccount = await resolveAccount(
				toDictionaryAccount,
				input.toAccountId,
				input.toBusinessId,
			);
			if (!toAccount) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "No se pudo resolver la cuenta de destino",
				});
			}

			let fromAccount;
			if (input.fromAccountId && fromDictionaryAccount) {
				fromAccount = await resolveAccount(
					fromDictionaryAccount,
					input.fromAccountId,
					input.fromBusinessId ?? input.toBusinessId,
				);
			}

			const entityPersonId =
				input.entityType === "PERSON" ? input.entityId : undefined;

			// ===== Caso 1: transacción simple (una sola cuenta) =====
			if (!fromAccount) {
				const lastTx = await ctx.db.query.Transaction.findFirst({
					where: eq(Transaction.toAccountId, toAccount.id),
					orderBy: [desc(Transaction.createdAt)],
				});
				const transactionType = getTransactionType(
					toAccount.dictionaryAccount.accountType,
					!!input.movement.increment,
				);
				const newBalance = calculateNewBalance(
					toAccount.dictionaryAccount.accountType,
					Number.parseFloat(lastTx?.balance ?? "0"),
					transactionType,
					amount,
				);

				const group = (
					await ctx.db
						.insert(TransactionGroup)
						.values({
							guildSlug: input.guildSlug,
							name: `Transacción del ${dayjs(combinedDate).format("DD/MM/YY HH:mm")}`,
							businessId: toAccount.businessId,
							description: "Transacción realizada.",
							operationType: "REGULAR",
						})
						.returning()
				)[0];
				if (!group) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Error al crear el grupo",
					});
				}

				const created = (
					await ctx.db
						.insert(Transaction)
						.values({
							amount: amount.toString(),
							exchangeRate: input.exchangeRate?.toString(),
							about: input.about,
							balance: newBalance.toString(),
							transactionType,
							categoryId: input.categoryId,
							toAccountId: toAccount.id,
							memberId: member.id,
							personId: entityPersonId,
							date: combinedDate,
							requiresSignature: input.requiresSignature ?? false,
							transactionGroupId: group.id,
						})
						.returning()
				)[0];

				await ctx.db
					.update(AccountOnBusiness)
					.set({
						currentBalance: newBalance.toString(),
						lastTransactionDate: combinedDate,
						updatedAt: new Date(),
					})
					.where(eq(AccountOnBusiness.id, toAccount.id));

				if (toAccount.subAccount) {
					await updateParentAccount(
						toAccount.dictionaryAccountId,
						toAccount.businessId,
					);
				}

				if (input.documents?.length) {
					await ctx.db.insert(Document).values(
						input.documents.map((d) => ({
							date: d.date,
							name: d.name,
							about: d.about,
							amount: d.amount ? Number.parseFloat(d.amount) : null,
							transactionId: created!.id,
						})),
					);
				}

				return created;
			}

			// ===== Caso 2: transacción entre dos cuentas (doble entrada) =====
			const hasDifferentCurrencies =
				fromAccount.dictionaryAccount.currency !==
				toAccount.dictionaryAccount.currency;
			if (hasDifferentCurrencies && !input.exchangeRate) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"Se requiere tipo de cambio para transacciones entre diferentes monedas",
				});
			}

			const exchangeRate = Number(input.exchangeRate) || 1;
			const fromAmount = amount;
			const toAmount = hasDifferentCurrencies
				? convertAmount(
						fromAccount.dictionaryAccount.currency,
						toAccount.dictionaryAccount.currency,
						fromAmount,
						exchangeRate,
						input.fromCurrency,
					)
				: fromAmount;

			const lastToTx = await ctx.db.query.Transaction.findFirst({
				where: eq(Transaction.toAccountId, toAccount.id),
				orderBy: [desc(Transaction.createdAt)],
			});
			const lastFromTx = await ctx.db.query.Transaction.findFirst({
				where: eq(Transaction.toAccountId, fromAccount.id),
				orderBy: [desc(Transaction.createdAt)],
			});

			const isIncrement = !!input.movement.increment;
			// increment: origen AUMENTA, destino DISMINUYE. decrement: al revés.
			const fromAccountTxType = getTransactionType(
				fromAccount.dictionaryAccount.accountType,
				isIncrement,
			);
			const toAccountTxType = getTransactionType(
				toAccount.dictionaryAccount.accountType,
				!isIncrement,
			);

			const newFromBalance = calculateNewBalance(
				fromAccount.dictionaryAccount.accountType,
				Number.parseFloat(lastFromTx?.balance ?? "0"),
				fromAccountTxType,
				fromAmount,
			);
			const newToBalance = calculateNewBalance(
				toAccount.dictionaryAccount.accountType,
				Number.parseFloat(lastToTx?.balance ?? "0"),
				toAccountTxType,
				toAmount,
			);

			const group = (
				await ctx.db
					.insert(TransactionGroup)
					.values({
						guildSlug: input.guildSlug,
						name: `Transacción del ${dayjs(combinedDate).format("DD/MM/YY HH:mm")}`,
						businessId: toAccount.businessId,
						description: "Transacción realizada.",
						operationType: hasDifferentCurrencies
							? "CURRENCY_EXCHANGE"
							: "REGULAR",
					})
					.returning()
			)[0];
			if (!group) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Error al crear el grupo",
				});
			}

			const exchangeRateStr = hasDifferentCurrencies
				? input.exchangeRate?.toString()
				: undefined;

			const created = await ctx.db
				.insert(Transaction)
				.values([
					{
						date: combinedDate,
						amount: fromAmount.toString(),
						balance: newFromBalance.toString(),
						transactionType: fromAccountTxType,
						exchangeRate: exchangeRateStr,
						toAccountId: fromAccount.id,
						memberId: member.id,
						personId: entityPersonId,
						requiresSignature: input.requiresSignature ?? false,
						transactionGroupId: group.id,
					},
					{
						date: combinedDate,
						amount: toAmount.toString(),
						balance: newToBalance.toString(),
						about: input.about,
						transactionType: toAccountTxType,
						exchangeRate: exchangeRateStr,
						categoryId: input.categoryId,
						toAccountId: toAccount.id,
						fromAccountId: fromAccount.id,
						memberId: member.id,
						personId: entityPersonId,
						requiresSignature: input.requiresSignature ?? false,
						transactionGroupId: group.id,
					},
				])
				.returning();

			await ctx.db
				.update(AccountOnBusiness)
				.set({
					currentBalance: newFromBalance.toString(),
					lastTransactionDate: combinedDate,
					updatedAt: new Date(),
				})
				.where(eq(AccountOnBusiness.id, fromAccount.id));

			await ctx.db
				.update(AccountOnBusiness)
				.set({
					currentBalance: newToBalance.toString(),
					lastTransactionDate: combinedDate,
					updatedAt: new Date(),
				})
				.where(eq(AccountOnBusiness.id, toAccount.id));

			if (fromAccount.subAccount) {
				await updateParentAccount(
					fromAccount.dictionaryAccountId,
					fromAccount.businessId,
				);
			}
			if (toAccount.subAccount) {
				await updateParentAccount(
					toAccount.dictionaryAccountId,
					toAccount.businessId,
				);
			}

			if (input.documents?.length) {
				await ctx.db.insert(Document).values(
					input.documents.map((d) => ({
						date: d.date,
						name: d.name,
						about: d.about,
						amount: d.amount ? Number.parseFloat(d.amount) : null,
						transactionId: created[1]!.id,
					})),
				);
			}

			return created;
		}),

	exchangeCurrency: protectedProcedure
		.input(CurrencyExchangeSchema)
		.mutation(async ({ ctx, input }) => {
			const member = await assertMembership(
				ctx.db,
				ctx.user.id,
				input.guildSlug,
			);
			if (input.fromAccountId === input.toAccountId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Las cuentas de origen y destino deben ser distintas",
				});
			}

			return ctx.db.transaction(async (tx) => {
				await tx.execute(
					sql`select id from ${AccountOnBusiness} where ${AccountOnBusiness.id} = ${input.fromAccountId} for update`,
				);
				await tx.execute(
					sql`select id from ${AccountOnBusiness} where ${AccountOnBusiness.id} = ${input.toAccountId} for update`,
				);

				const fromAccount = await tx.query.AccountOnBusiness.findFirst({
					where: and(
						eq(AccountOnBusiness.id, input.fromAccountId),
						eq(AccountOnBusiness.discharged, true),
					),
					with: { dictionaryAccount: true, business: true },
				});
				const toAccount = await tx.query.AccountOnBusiness.findFirst({
					where: and(
						eq(AccountOnBusiness.id, input.toAccountId),
						eq(AccountOnBusiness.discharged, true),
					),
					with: { dictionaryAccount: true, business: true },
				});

				if (!fromAccount || !toAccount) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "No se encontró una de las cuentas seleccionadas",
					});
				}
				if (
					fromAccount.businessId !== input.businessId ||
					toAccount.businessId !== input.businessId ||
					fromAccount.business.guildSlug !== input.guildSlug ||
					toAccount.business.guildSlug !== input.guildSlug
				) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "Las cuentas deben pertenecer a la empresa seleccionada",
					});
				}
				if (fromAccount.subAccount || toAccount.subAccount) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "El cambio de divisas opera únicamente con cuentas principales",
					});
				}
				if (
					fromAccount.dictionaryAccount.accountType !== "ASSET" ||
					toAccount.dictionaryAccount.accountType !== "ASSET"
				) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "El cambio de divisas requiere dos cuentas de Activo",
					});
				}

				const fromCurrency = fromAccount.dictionaryAccount.currency;
				const toCurrency = toAccount.dictionaryAccount.currency;
				if (fromCurrency === toCurrency) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Elegí cuentas de monedas diferentes",
					});
				}

				const targetAmount = calculateCurrencyExchange(input);
				if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "La cotización produce un monto de destino inválido",
					});
				}

				const sourceBalance =
					Number.parseFloat(fromAccount.currentBalance ?? "0") -
					input.sourceAmount;
				const targetBalance =
					Number.parseFloat(toAccount.currentBalance ?? "0") + targetAmount;
				const operationDate = combineDateWithCurrentTime(input.date, false);
				const operationName =
					fromCurrency === "ARS"
						? `Compra de ${toCurrency}`
						: toCurrency === "ARS"
							? `Venta de ${fromCurrency}`
							: `Cambio de ${fromCurrency} a ${toCurrency}`;
				const quote =
					input.rateDirection === "FROM_TO"
						? `1 ${fromCurrency} = ${decimalForStorage(input.exchangeRate)} ${toCurrency}`
						: `1 ${toCurrency} = ${decimalForStorage(input.exchangeRate)} ${fromCurrency}`;

				const [group] = await tx
					.insert(TransactionGroup)
					.values({
						guildSlug: input.guildSlug,
						businessId: input.businessId,
						name: operationName,
						description: input.about || quote,
						operationType: "CURRENCY_EXCHANGE",
					})
					.returning();
				if (!group) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "No se pudo crear la operación de cambio",
					});
				}

				const exchangeRate = decimalForStorage(input.exchangeRate);
				const sourceAmount = decimalForStorage(input.sourceAmount);
				const destinationAmount = decimalForStorage(targetAmount);
				const transactions = await tx
					.insert(Transaction)
					.values([
						{
							date: operationDate,
							amount: sourceAmount,
							balance: decimalForStorage(sourceBalance),
							exchangeRate,
							transactionType: "CREDIT",
							toAccountId: fromAccount.id,
							memberId: member.id,
							transactionGroupId: group.id,
							about: `Salida por ${operationName.toLocaleLowerCase("es")}`,
						},
						{
							date: operationDate,
							amount: destinationAmount,
							balance: decimalForStorage(targetBalance),
							exchangeRate,
							transactionType: "DEBIT",
							toAccountId: toAccount.id,
							fromAccountId: fromAccount.id,
							memberId: member.id,
							transactionGroupId: group.id,
							about: `Ingreso por ${operationName.toLocaleLowerCase("es")}`,
						},
					])
					.returning();

				await tx
					.update(AccountOnBusiness)
					.set({
						currentBalance: decimalForStorage(sourceBalance),
						lastTransactionDate: operationDate,
						updatedAt: new Date(),
					})
					.where(eq(AccountOnBusiness.id, fromAccount.id));
				await tx
					.update(AccountOnBusiness)
					.set({
						currentBalance: decimalForStorage(targetBalance),
						lastTransactionDate: operationDate,
						updatedAt: new Date(),
					})
					.where(eq(AccountOnBusiness.id, toAccount.id));

				return {
					groupId: group.id,
					operationName,
					quote,
					fromCurrency,
					toCurrency,
					sourceAmount,
					destinationAmount,
					transactions,
				};
			});
		}),

	countByGuildSlug: protectedProcedure
		.input(z.object({ guildSlug: z.string() }))
		.query(async ({ ctx, input }) => {
			await assertMembership(ctx.db, ctx.user.id, input.guildSlug);
			const accountIds = await guildAccountIds(ctx.db, input.guildSlug);
			if (accountIds.length === 0) return 0;
			const rows = await ctx.db
				.select({ id: Transaction.id })
				.from(Transaction)
				.where(
					and(
						inArray(Transaction.toAccountId, accountIds),
						eq(Transaction.discharged, true),
					),
				);
			return rows.length;
		}),

	byGuildSlugWithCursor: protectedProcedure
		.input(
			z.object({
				guildSlug: z.string(),
				limit: z.number().min(1).max(100).default(25),
				cursor: z.string().nullish(),
			}),
		)
		.query(async ({ ctx, input }) => {
			await assertMembership(ctx.db, ctx.user.id, input.guildSlug);
			const accountIds = await guildAccountIds(ctx.db, input.guildSlug);
			if (accountIds.length === 0) {
				return { items: [], nextCursor: null as string | null };
			}

			const items = await ctx.db.query.Transaction.findMany({
				where: and(
					inArray(Transaction.toAccountId, accountIds),
					eq(Transaction.discharged, true),
					input.cursor ? lt(Transaction.date, new Date(input.cursor)) : undefined,
				),
				orderBy: [desc(Transaction.date), desc(Transaction.createdAt)],
				limit: input.limit + 1,
				with: {
					toAccount: { with: { business: true, dictionaryAccount: true } },
					fromAccount: { with: { business: true, dictionaryAccount: true } },
					member: { with: { user: true } },
					person: true,
					transactionGroup: true,
				},
			});

			let nextCursor: string | null = null;
			if (items.length > input.limit) {
				const next = items.pop()!;
				nextCursor = next.date.toISOString();
			}
			return { items, nextCursor };
		}),
});
