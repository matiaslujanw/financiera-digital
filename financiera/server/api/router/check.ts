import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import {
	AccountOnBusiness,
	Business,
	Check,
	CheckOnTransactionGroup,
	Person,
	Transaction,
	TransactionGroup,
} from "~/server/db/schema";
import { CheckPurchaseSchema } from "~/server/validators";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { calculatePurchaseValues } from "../lib/financial-utils";
import { assertMembership } from "../lib/guards";
import { dayjs } from "../lib/dayjs";

function money(value: number): string {
	return value.toFixed(2);
}

function normalizeAccountSlug(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const checkRouter = createTRPCRouter({
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
});
