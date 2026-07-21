import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";

import {
	AccountOnBusiness,
	Business,
	Check,
	CheckOnTransactionGroup,
	Person,
	Transaction,
	TransactionGroup,
} from "~/server/db/schema";
import { CheckPurchaseSchema, CheckSaleSchema } from "~/server/validators";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { calculatePurchaseValues, calculateSaleValues } from "../lib/financial-utils";
import { assertMembership } from "../lib/guards";
import { dayjs } from "../lib/dayjs";

function money(value: number): string {
	return value.toFixed(2);
}

function normalizeAccountSlug(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const checkRouter = createTRPCRouter({
	availableForSale: protectedProcedure
		.input(CheckSaleSchema.pick({ guildSlug: true, businessId: true }))
		.query(async ({ ctx, input }) => {
			await assertMembership(ctx.db, ctx.user.id, input.guildSlug);
			const business = await ctx.db.query.Business.findFirst({
				where: and(
					eq(Business.id, input.businessId),
					eq(Business.guildSlug, input.guildSlug),
					eq(Business.discharged, true),
				),
			});
			if (!business) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Empresa no encontrada" });
			}

			return ctx.db.query.Check.findMany({
				where: and(
					eq(Check.guildSlug, input.guildSlug),
					eq(Check.businessId, input.businessId),
					eq(Check.status, "PURCHASED"),
					eq(Check.discharged, true),
				),
				orderBy: [asc(Check.collectionDate), asc(Check.createdAt)],
				with: { person: true, business: true },
			});
		}),

	purchase: protectedProcedure
		.input(CheckPurchaseSchema)
		.mutation(async ({ ctx, input }) => {
			const member = await assertMembership(
				ctx.db,
				ctx.user.id,
				input.guildSlug,
			);

			return ctx.db.transaction(async (tx) => {
				const business = await tx.query.Business.findFirst({
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

				// Serializa compras concurrentes sobre las mismas cuentas para evitar
				// que dos operaciones pisen el currentBalance de la otra.
				await tx
					.select({ id: AccountOnBusiness.id })
					.from(AccountOnBusiness)
					.where(
						and(
							eq(AccountOnBusiness.businessId, business.id),
							eq(AccountOnBusiness.subAccount, false),
							eq(AccountOnBusiness.discharged, true),
						),
					)
					.for("update");

				const businessAccounts = await tx.query.AccountOnBusiness.findMany({
					where: and(
						eq(AccountOnBusiness.businessId, business.id),
						eq(AccountOnBusiness.subAccount, false),
						eq(AccountOnBusiness.discharged, true),
					),
					with: { dictionaryAccount: true },
				});

				const arsAccounts = businessAccounts.filter(
					(account) =>
						account.dictionaryAccount?.guildSlug === input.guildSlug &&
						account.dictionaryAccount.currency === "ARS",
				);
				const accountBySlug = (slug: string) =>
					arsAccounts.find(
						(account) =>
							normalizeAccountSlug(account.dictionaryAccount!.slug) === slug,
					);

				const cashAccount = accountBySlug("efectivo");
				const checkWalletAccount = arsAccounts.find(
					(account) => account.dictionaryAccount?.checkAccount,
				);
				const serviceFeeAccount = accountBySlug("pesificacion");
				const interestAccount = accountBySlug("interesescobrados");

				if (
					!cashAccount ||
					!checkWalletAccount ||
					!serviceFeeAccount ||
					!interestAccount
				) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message:
							"Faltan cuentas del sistema en ARS: Efectivo, Cartera de cheques, Pesificación o Intereses cobrados",
					});
				}

				const activePeople = await tx
					.select()
					.from(Person)
					.where(
						and(
							eq(Person.guildSlug, input.guildSlug),
							eq(Person.discharged, true),
						),
					);
				const normalizedCustomerName = input.customerName.toLocaleLowerCase("es");
				let customer = activePeople.find(
					(person) =>
						person.name.trim().toLocaleLowerCase("es") === normalizedCustomerName,
				);
				if (!customer) {
					customer = (
						await tx
							.insert(Person)
							.values({ name: input.customerName, guildSlug: input.guildSlug })
							.returning()
					)[0];
				}
				if (!customer) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "No se pudo resolver el cliente",
					});
				}

				const now = dayjs();
				const operationDate = dayjs(input.purchaseDate)
					.hour(now.hour())
					.minute(now.minute())
					.second(now.second())
					.millisecond(now.millisecond())
					.toDate();

				const group = (
					await tx
						.insert(TransactionGroup)
						.values({
							guildSlug: input.guildSlug,
							businessId: business.id,
							name: `Compra de ${input.checks.length} cheque${input.checks.length === 1 ? "" : "s"}`,
							description:
								input.about || `Compra de cheques a ${customer.name}`,
							operationType: "CHECK_PURCHASE",
						})
						.returning()
				)[0];
				if (!group) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "No se pudo crear el grupo de la operación",
					});
				}

				const balances = new Map<string, number>(
					[
						cashAccount,
						checkWalletAccount,
						serviceFeeAccount,
						interestAccount,
					].map((account) => [
						account.id,
						Number.parseFloat(account.currentBalance ?? "0") || 0,
					]),
				);
				const transactionRows: (typeof Transaction.$inferInsert)[] = [];
				let transactionOffset = 0;
				let totalGross = 0;
				let totalNet = 0;
				let totalServiceFee = 0;
				let totalInterest = 0;

				const addMovement = (inputMovement: {
					accountId: string;
					amount: number;
					delta: number;
					transactionType: "DEBIT" | "CREDIT";
					about: string;
				}) => {
					const newBalance =
						(balances.get(inputMovement.accountId) ?? 0) + inputMovement.delta;
					balances.set(inputMovement.accountId, newBalance);
					transactionOffset += 1;
					transactionRows.push({
						date: new Date(operationDate.getTime() + transactionOffset),
						amount: money(inputMovement.amount),
						balance: money(newBalance),
						transactionType: inputMovement.transactionType,
						toAccountId: inputMovement.accountId,
						memberId: member.id,
						personId: customer.id,
						transactionGroupId: group.id,
						about: inputMovement.about,
					});
				};

				for (const checkInput of input.checks) {
					const values = calculatePurchaseValues({
						grossValue: checkInput.grossValue,
						serviceFeeRate: input.serviceFeeRate,
						monthlyInterestRate: input.monthlyInterestRate,
						purchaseDate: operationDate,
						collectionDate: checkInput.collectionDate,
						bankClearing: checkInput.bankClearing,
					});
					if (values.netValue <= 0) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `El neto del cheque ${checkInput.checkNumber || "sin número"} debe ser mayor a 0`,
						});
					}

					const createdCheck = (
						await tx
							.insert(Check)
							.values({
								purchaseDate: operationDate,
								collectionDate: checkInput.collectionDate,
								serviceFeeRate: values.serviceFeeRate.toString(),
								monthlyInterestRate: values.monthlyInterestRate.toString(),
								carriedInterestRate: values.carriedInterestRate.toString(),
								bankClearing: values.bankClearing,
								grossValue: money(values.grossValue),
								netValue: money(values.netValue),
								serviceFeeAmount: money(values.serviceFeeAmount),
								interestRateAmount: money(values.interestAmount),
								currency: "ARS",
								checkWriter: checkInput.checkWriter,
								checkNumber: checkInput.checkNumber || null,
								bankName: checkInput.bankName || null,
								about: checkInput.about || null,
								guildSlug: input.guildSlug,
								businessId: business.id,
								memberId: member.id,
								personId: customer.id,
								status: "PURCHASED",
							})
							.returning()
					)[0];
					if (!createdCheck) {
						throw new TRPCError({
							code: "INTERNAL_SERVER_ERROR",
							message: "No se pudo crear el cheque",
						});
					}

					await tx.insert(CheckOnTransactionGroup).values({
						checkId: createdCheck.id,
						transactionGroupId: group.id,
					});

					const suffix = createdCheck.checkNumber
						? ` ${createdCheck.checkNumber}`
						: "";
					addMovement({
						accountId: checkWalletAccount.id,
						amount: values.netValue,
						delta: values.netValue,
						transactionType: "DEBIT",
						about: `Ingreso a cartera por compra de cheque${suffix}`,
					});
					addMovement({
						accountId: cashAccount.id,
						amount: values.netValue,
						delta: -values.netValue,
						transactionType: "CREDIT",
						about: `Salida de efectivo por compra de cheque${suffix}`,
					});
					addMovement({
						accountId: serviceFeeAccount.id,
						amount: values.serviceFeeAmount,
						delta: values.serviceFeeAmount,
						transactionType: "DEBIT",
						about: `Pesificación por compra de cheque${suffix}`,
					});
					addMovement({
						accountId: interestAccount.id,
						amount: values.interestAmount,
						delta: values.interestAmount,
						transactionType: "DEBIT",
						about: `Interés cobrado por compra de cheque${suffix}`,
					});

					totalGross += values.grossValue;
					totalNet += values.netValue;
					totalServiceFee += values.serviceFeeAmount;
					totalInterest += values.interestAmount;
				}

				await tx.insert(Transaction).values(transactionRows);

				const lastTransactionDate = new Date(
					operationDate.getTime() + transactionOffset,
				);
				for (const [accountId, balance] of balances) {
					await tx
						.update(AccountOnBusiness)
						.set({
							currentBalance: money(balance),
							lastTransactionDate,
							updatedAt: new Date(),
						})
						.where(eq(AccountOnBusiness.id, accountId));
				}

				return {
					transactionGroupId: group.id,
					checksCreated: input.checks.length,
					transactionsCreated: transactionRows.length,
					totals: {
						grossValue: money(totalGross),
						netValue: money(totalNet),
						serviceFeeAmount: money(totalServiceFee),
						interestAmount: money(totalInterest),
					},
				};
			});
		}),

	sale: protectedProcedure
		.input(CheckSaleSchema)
		.mutation(async ({ ctx, input }) => {
			const member = await assertMembership(
				ctx.db,
				ctx.user.id,
				input.guildSlug,
			);
			const uniqueCheckIds = [...new Set(input.checkIds)];
			if (uniqueCheckIds.length !== input.checkIds.length) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "La selección contiene cheques repetidos",
				});
			}

			return ctx.db.transaction(async (tx) => {
				const business = await tx.query.Business.findFirst({
					where: and(
						eq(Business.id, input.businessId),
						eq(Business.guildSlug, input.guildSlug),
						eq(Business.discharged, true),
					),
				});
				if (!business) {
					throw new TRPCError({ code: "NOT_FOUND", message: "Empresa no encontrada" });
				}

				await tx
					.select({ id: AccountOnBusiness.id })
					.from(AccountOnBusiness)
					.where(
						and(
							eq(AccountOnBusiness.businessId, business.id),
							eq(AccountOnBusiness.subAccount, false),
							eq(AccountOnBusiness.discharged, true),
						),
					)
					.for("update");

				const lockedChecks = await tx
					.select()
					.from(Check)
					.where(
						and(
							inArray(Check.id, uniqueCheckIds),
							eq(Check.guildSlug, input.guildSlug),
							eq(Check.businessId, business.id),
							eq(Check.status, "PURCHASED"),
							eq(Check.discharged, true),
						),
					)
					.for("update");
				if (lockedChecks.length !== uniqueCheckIds.length) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "Uno o más cheques ya no están disponibles para la venta",
					});
				}
				const checksById = new Map(lockedChecks.map((check) => [check.id, check]));
				const checks = uniqueCheckIds.map((id) => checksById.get(id)!);
				if (checks.some((check) => check.currency !== "ARS")) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Por ahora la venta de cheques opera en ARS",
					});
				}

				const now = dayjs();
				const saleDate = dayjs(input.saleDate)
					.hour(now.hour())
					.minute(now.minute())
					.second(now.second())
					.millisecond(now.millisecond())
					.toDate();
				for (const check of checks) {
					if (!check.purchaseDate) {
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message: `El cheque ${check.checkNumber || "sin número"} no tiene fecha de compra`,
						});
					}
					if (
						dayjs(saleDate).startOf("day").isBefore(dayjs(check.purchaseDate).startOf("day"))
					) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `La venta no puede ser anterior a la compra del cheque ${check.checkNumber || "sin número"}`,
						});
					}
					if (
						dayjs(saleDate).startOf("day").isAfter(dayjs(check.collectionDate).startOf("day"))
					) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `El cheque ${check.checkNumber || "sin número"} está vencido`,
						});
					}
				}

				const businessAccounts = await tx.query.AccountOnBusiness.findMany({
					where: and(
						eq(AccountOnBusiness.businessId, business.id),
						eq(AccountOnBusiness.subAccount, false),
						eq(AccountOnBusiness.discharged, true),
					),
					with: { dictionaryAccount: true },
				});
				const arsAccounts = businessAccounts.filter(
					(account) =>
						account.dictionaryAccount?.guildSlug === input.guildSlug &&
						account.dictionaryAccount.currency === "ARS",
				);
				const accountBySlug = (slug: string) =>
					arsAccounts.find(
						(account) =>
							normalizeAccountSlug(account.dictionaryAccount!.slug) === slug,
					);
				const cashAccount = accountBySlug("efectivo");
				const checkWalletAccount = arsAccounts.find(
					(account) => account.dictionaryAccount?.checkAccount,
				);
				const serviceFeeAccount = accountBySlug("pesificacion");
				const interestAccount = accountBySlug("interesescobrados");
				if (
					!cashAccount ||
					!checkWalletAccount ||
					!serviceFeeAccount ||
					!interestAccount
				) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message:
							"Faltan cuentas del sistema en ARS: Efectivo, Cartera de cheques, Pesificación o Intereses cobrados",
					});
				}

				const activePeople = await tx
					.select()
					.from(Person)
					.where(
						and(
							eq(Person.guildSlug, input.guildSlug),
							eq(Person.discharged, true),
						),
					);
				const normalizedBuyerName = input.buyerName.toLocaleLowerCase("es");
				let buyer = activePeople.find(
					(person) =>
						person.name.trim().toLocaleLowerCase("es") === normalizedBuyerName,
				);
				if (!buyer) {
					buyer = (
						await tx
							.insert(Person)
							.values({ name: input.buyerName, guildSlug: input.guildSlug })
							.returning()
					)[0];
				}
				if (!buyer) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "No se pudo resolver el comprador",
					});
				}

				const group = (
					await tx
						.insert(TransactionGroup)
						.values({
							guildSlug: input.guildSlug,
							businessId: business.id,
							name: `Venta de ${checks.length} cheque${checks.length === 1 ? "" : "s"}`,
							description: input.about || `Venta de cheques a ${buyer.name}`,
							operationType: "CHECK_SALE",
						})
						.returning()
				)[0];
				if (!group) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "No se pudo crear el grupo de la operación",
					});
				}

				const balances = new Map<string, number>(
					[
						cashAccount,
						checkWalletAccount,
						serviceFeeAccount,
						interestAccount,
					].map((account) => [
						account.id,
						Number.parseFloat(account.currentBalance ?? "0") || 0,
					]),
				);
				const transactionRows: (typeof Transaction.$inferInsert)[] = [];
				let transactionOffset = 0;
				let totalGross = 0;
				let totalPurchaseCost = 0;
				let totalSaleValue = 0;
				let totalServiceFee = 0;
				let totalInterest = 0;
				let totalProfit = 0;
				let totalHoldingDays = 0;

				const addMovement = (movement: {
					accountId: string;
					amount: number;
					delta: number;
					transactionType: "DEBIT" | "CREDIT";
					about: string;
				}) => {
					const newBalance = (balances.get(movement.accountId) ?? 0) + movement.delta;
					balances.set(movement.accountId, newBalance);
					transactionOffset += 1;
					transactionRows.push({
						date: new Date(saleDate.getTime() + transactionOffset),
						amount: money(movement.amount),
						balance: money(newBalance),
						transactionType: movement.transactionType,
						toAccountId: movement.accountId,
						memberId: member.id,
						personId: buyer.id,
						transactionGroupId: group.id,
						about: movement.about,
					});
				};

				for (const check of checks) {
					const values = calculateSaleValues({
						grossValue: Number.parseFloat(check.grossValue),
						serviceFeeRate: input.serviceFeeRate,
						monthlyInterestRate: input.monthlyInterestRate,
						saleDate,
						collectionDate: check.collectionDate,
						bankClearing: check.bankClearing ?? 0,
					});
					if (values.netValue <= 0) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `El valor de venta del cheque ${check.checkNumber || "sin número"} debe ser mayor a 0`,
						});
					}
					const purchaseCost = Number.parseFloat(check.netValue);
					const profit = values.netValue - purchaseCost;
					const holdingDays = dayjs(saleDate)
						.startOf("day")
						.diff(dayjs(check.purchaseDate!).startOf("day"), "day");

					await tx
						.update(Check)
						.set({
							status: "SOLD",
							saleDate,
							buyerPersonId: buyer.id,
							saleServiceFeeRate: values.serviceFeeRate.toString(),
							saleMonthlyInterestRate: values.monthlyInterestRate.toString(),
							saleCarriedInterestRate: values.carriedInterestRate.toString(),
							saleGrossValue: money(values.grossValue),
							saleNetValue: money(values.netValue),
							saleServiceFeeAmount: money(values.serviceFeeAmount),
							saleInterestRateAmount: money(values.interestAmount),
							updatedAt: new Date(),
						})
						.where(eq(Check.id, check.id));
					await tx.insert(CheckOnTransactionGroup).values({
						checkId: check.id,
						transactionGroupId: group.id,
					});

					const suffix = check.checkNumber ? ` ${check.checkNumber}` : "";
					addMovement({
						accountId: checkWalletAccount.id,
						amount: purchaseCost,
						delta: -purchaseCost,
						transactionType: "CREDIT",
						about: `Salida de cartera por venta de cheque${suffix}`,
					});
					addMovement({
						accountId: cashAccount.id,
						amount: values.netValue,
						delta: values.netValue,
						transactionType: "DEBIT",
						about: `Ingreso de efectivo por venta de cheque${suffix}`,
					});
					addMovement({
						accountId: serviceFeeAccount.id,
						amount: values.serviceFeeAmount,
						delta: -values.serviceFeeAmount,
						transactionType: "CREDIT",
						about: `Pesificación cedida por venta de cheque${suffix}`,
					});
					addMovement({
						accountId: interestAccount.id,
						amount: values.interestAmount,
						delta: -values.interestAmount,
						transactionType: "CREDIT",
						about: `Interés cedido por venta de cheque${suffix}`,
					});

					totalGross += values.grossValue;
					totalPurchaseCost += purchaseCost;
					totalSaleValue += values.netValue;
					totalServiceFee += values.serviceFeeAmount;
					totalInterest += values.interestAmount;
					totalProfit += profit;
					totalHoldingDays += holdingDays;
				}

				await tx.insert(Transaction).values(transactionRows);
				const lastTransactionDate = new Date(saleDate.getTime() + transactionOffset);
				for (const [accountId, balance] of balances) {
					await tx
						.update(AccountOnBusiness)
						.set({
							currentBalance: money(balance),
							lastTransactionDate,
							updatedAt: new Date(),
						})
						.where(eq(AccountOnBusiness.id, accountId));
				}

				return {
					transactionGroupId: group.id,
					checksSold: checks.length,
					transactionsCreated: transactionRows.length,
					totals: {
						grossValue: money(totalGross),
						purchaseCost: money(totalPurchaseCost),
						saleValue: money(totalSaleValue),
						serviceFeeAmount: money(totalServiceFee),
						interestAmount: money(totalInterest),
						profit: money(totalProfit),
						averageHoldingDays: totalHoldingDays / checks.length,
					},
				};
			});
		}),
});
