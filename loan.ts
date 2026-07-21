// packages/api/src/router/loan.ts
import { TRPCError } from "@trpc/server";
import { ManipulateType } from "dayjs";
import {
	and,
	count,
	desc,
	eq,
	ilike,
	inArray,
	lt,
	or,
	SQL,
	sql,
} from "drizzle-orm";
import { z } from "zod";

import {
	AccountOnBusiness,
	AccountTypeEnum,
	Business,
	Currency,
	CurrencyEnum,
	DictionaryAccount,
	Document,
	Installment,
	Loan,
	LoanOnTransactionGroup,
	Member,
	Person,
	Transaction,
	TransactionGroup,
} from "@acme/db/schema";
import {
	AlertLeadTimeEnum,
	BusinessSlugSchema,
	createLoanSchema,
	GuildSlugCursorSchema,
	GuildSlugSchema,
	IdSchema,
	markInstallmentPaidSchema,
	modifyLoanSchema,
	PersonIdSchema,
	settleLoanEarlySchema,
} from "@acme/validators";

import { dayjs } from "../lib/dayjs";
import {
	combineDateWithCurrentTime,
	createLog,
	formatForSubmit,
	notEmpty,
	updateParentAccount,
} from "../lib/utils";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const loanRouter = createTRPCRouter({
	create: protectedProcedure
		.input(createLoanSchema)
		.mutation(async ({ ctx, input }) => {
			const member = await ctx.db.query.Member.findFirst({
				where: and(
					eq(Member.userId, ctx.user.id),
					eq(Member.guildSlug, input.guildSlug),
				),
			});
			if (!member)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Miembro inexistente.",
				});

			const originDictionaryAccount = await ctx.db.query.DictionaryAccount.findFirst({ where: eq(DictionaryAccount.id, input.accountId) });
			if (!originDictionaryAccount) throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta de origen no encontrada." });
			if (originDictionaryAccount.accountType !== 'ASSET') throw new TRPCError({ code: 'BAD_REQUEST', message: 'La cuenta de origen debe ser de tipo Activo.' });

			const loanCurrency = originDictionaryAccount.currency;

			const grossValue = Number.parseFloat(formatForSubmit(input.grossValue));
			const totalInterestToCharge = Number.parseFloat(
				formatForSubmit(input.totalInterestToCharge),
			);
			const totalLoanValue = grossValue + totalInterestToCharge;
			const numberOfInstallments = input.numberOfInstallments;

			if (grossValue <= 0)
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Monto del préstamo debe ser mayor a 0.",
				});
			if (totalInterestToCharge < 0)
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Interés total no puede ser negativo.",
				});
			if (numberOfInstallments <= 0)
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Número de cuotas debe ser mayor a 0.",
				});

			const principalPerInstallment = parseFloat(
				(grossValue / numberOfInstallments).toFixed(4),
			);
			const interestPerInstallment = parseFloat(
				(totalInterestToCharge / numberOfInstallments).toFixed(4),
			);
			const totalAmountPerInstallment =
				principalPerInstallment + interestPerInstallment;

			let paymentPeriodicityUnit: ManipulateType = "month";
			let paymentPeriodicityMultiplier = 1;

			switch (input.paymentPeriodicity) {
				case "DAILY":
					paymentPeriodicityUnit = "day";
					break;
				case "WEEKLY":
					paymentPeriodicityUnit = "week";
					break;
				case "BIWEEKLY":
					paymentPeriodicityUnit = "week";
					paymentPeriodicityMultiplier = 2;
					break;
				case "BIMONTHLY":
					paymentPeriodicityUnit = "month";
					paymentPeriodicityMultiplier = 2;
					break;
				case "QUARTERLY":
					paymentPeriodicityUnit = "month";
					paymentPeriodicityMultiplier = 3;
					break;
				case "SEMIANNUALLY":
					paymentPeriodicityUnit = "month";
					paymentPeriodicityMultiplier = 6;
					break;
				case "ANNUALLY":
					paymentPeriodicityUnit = "year";
					break;
				default:
					paymentPeriodicityUnit = "month";
			}

			const firstPaymentDueDate = dayjs(input.purchaseDate)
				.add(paymentPeriodicityMultiplier, paymentPeriodicityUnit)
				.toDate();
			let lastPaymentDate = dayjs(firstPaymentDueDate);
			for (let i = 1; i < numberOfInstallments; i++) {
				lastPaymentDate = lastPaymentDate.add(
					paymentPeriodicityMultiplier,
					paymentPeriodicityUnit,
				);
			}
			const finalExpectedCollectionDate = lastPaymentDate.toDate();

			const result = await ctx.db.transaction(async (tx) => {
				const findOrCreateSystemAoB = async (
					slug: string,
					name: string,
					type: "ASSET" | "REVENUE",
				) => {
					let dictAcc = await tx.query.DictionaryAccount.findFirst({
						where: and(
							eq(DictionaryAccount.guildSlug, input.guildSlug),
							eq(DictionaryAccount.slug, slug),
							eq(DictionaryAccount.currency, loanCurrency),
						),
					});
					if (!dictAcc) {
						dictAcc = (
							await tx
								.insert(DictionaryAccount)
								.values({
									accountType: type,
									guildSlug: input.guildSlug,
									name: `${name} ${loanCurrency}`,
									slug,
									currency: loanCurrency,
									availability: true,
									hasSubAccounts: false,
									checkAccount: false,
								})
								.returning()
						)[0];
					}
					if (!dictAcc)
						throw new TRPCError({
							code: "INTERNAL_SERVER_ERROR",
							message: `No se pudo encontrar o crear DictionaryAccount para ${slug} en ${loanCurrency}.`,
						});

					let aob = await tx.query.AccountOnBusiness.findFirst({
						where: and(
							eq(AccountOnBusiness.dictionaryAccountId, dictAcc.id),
							eq(AccountOnBusiness.businessId, input.fromBusinessId),
						),
					});
					if (!aob) {
						aob = (
							await tx
								.insert(AccountOnBusiness)
								.values({
									businessId: input.fromBusinessId,
									dictionaryAccountId: dictAcc.id,
								})
								.returning()
						)[0];
					}
					if (!aob)
						throw new TRPCError({
							code: "INTERNAL_SERVER_ERROR",
							message: `No se pudo crear AoB para Dict ${dictAcc.id}`,
						});
					return aob;
				};

				const loanAssetAoB = await findOrCreateSystemAoB(
					"prestamosotorgados",
					"Préstamos Otorgados",
					"ASSET",
				);
				const interestRevenueAoB = await findOrCreateSystemAoB(
					"interesesganadosprestamos",
					"Intereses Ganados por Préstamos",
					"REVENUE",
				);

				let fromAccountAoB = await tx.query.AccountOnBusiness.findFirst({
					where: and(
						eq(
							AccountOnBusiness.dictionaryAccountId,
							originDictionaryAccount.id,
						),
						eq(AccountOnBusiness.businessId, input.fromBusinessId),
					),
					with: { dictionaryAccount: true },
				});

				if (!fromAccountAoB) {
					const inserted = (
						await tx
							.insert(AccountOnBusiness)
							.values({
								businessId: input.fromBusinessId,
								dictionaryAccountId: originDictionaryAccount.id,
								currentBalance: "0",
								subAccount: false,
							})
							.returning({ id: AccountOnBusiness.id })
					)[0];
					if (!inserted)
						throw new TRPCError({
							code: "INTERNAL_SERVER_ERROR",
							message: `No se pudo crear AoB para Dict ${originDictionaryAccount.id}`,
						});

					fromAccountAoB = await tx.query.AccountOnBusiness.findFirst({
						where: eq(AccountOnBusiness.id, inserted.id),
						with: { dictionaryAccount: true },
					});
				}

				if (!fromAccountAoB)
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: `AoB de origen no encontrado tras creación/búsqueda.`,
					});
				fromAccountAoB.dictionaryAccount = originDictionaryAccount; // Adjuntar para el resto de la lógica

				const personName =
					(
						await tx.query.Person.findFirst({
							where: eq(Person.id, input.personId),
							columns: { name: true },
						})
					)?.name || "Cliente";
				const transactionGroupName = `Préstamo #${"S/N"} a ${personName} - ${dayjs(input.purchaseDate).format("DD/MM/YY")}`;

				const transactionGroup = (
					await tx
						.insert(TransactionGroup)
						.values({
							guildSlug: input.guildSlug,
							name: transactionGroupName,
							businessId: input.fromBusinessId,
							description: `Capital: ${formatForSubmit(input.grossValue)} ${loanCurrency}, Interés Total: ${formatForSubmit(input.totalInterestToCharge)} ${loanCurrency}.`,
							operationType: "LOAN",
						})
						.returning()
				)[0];
				if (!transactionGroup)
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Error al crear TransactionGroup.",
					});

				const mapAlertToDbFormat = (
					alertValue: z.infer<typeof AlertLeadTimeEnum> | undefined,
				) => {
					if (!alertValue || alertValue === "NONE") return null;

					switch (alertValue) {
						case "ON_DUE":
							return { days: 0, type: "ON_DUE" };
						case "1_DAY_BEFORE":
							return { days: -1, type: "BEFORE_DUE" };
						case "2_DAYS_BEFORE":
							return { days: -2, type: "BEFORE_DUE" };
						case "1_WEEK_BEFORE":
							return { days: -7, type: "BEFORE_DUE" };
						// Ignoramos los de minutos/horas por ahora para simplificar, pero aquí se mapearían
						case "5_MIN_BEFORE":
						case "15_MIN_BEFORE":
						case "30_MIN_BEFORE":
						case "1_HOUR_BEFORE":
						case "2_HOURS_BEFORE":
						case "4_HOURS_BEFORE":
							return null; // O manejarlo si tu backend soporta alertas con menos de 1 día de antelación
						default:
							return null;
					}
				};

				const alert1Db = mapAlertToDbFormat(input.alert1);
				const alert2Db = mapAlertToDbFormat(input.alert2);

				const alertsToSave = {
					leadTimes: [alert1Db, alert2Db].filter(Boolean) as {
						days: number;
						type: string;
					}[], // Filtrar nulos
				};

				const loanRecord = (
					await tx
						.insert(Loan)
						.values({
							guildSlug: input.guildSlug,
							businessId: input.fromBusinessId,
							memberId: member.id,
							currency: loanCurrency,
							personId: input.personId,
							purchaseDate: input.purchaseDate,
							finalExpectedCollectionDate: finalExpectedCollectionDate,
							grossValue: grossValue.toString(),
							totalInterestAmount: totalInterestToCharge.toString(),
							totalLoanValue: totalLoanValue.toString(),
							numberOfInstallments: numberOfInstallments,
							paymentPeriodicity: input.paymentPeriodicity,
							principalPerInstallment: principalPerInstallment.toString(),
							interestPerInstallment: interestPerInstallment.toString(),
							status: "ACTIVE",
							guaranteeDetails: input.guaranteeDetails || null,
							about: input.about || null,
							alertsConfig: alertsToSave as any,
							remainingPrincipal: grossValue.toString(),
						})
						.returning()
				)[0];
				if (!loanRecord)
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Error al crear el registro del préstamo.",
					});

				await tx
					.insert(LoanOnTransactionGroup)
					.values({
						loanId: loanRecord.id,
						transactionGroupId: transactionGroup.id,
					});

				const installmentsToCreate: (typeof Installment.$inferInsert)[] = [];
				let currentDueDate = dayjs(firstPaymentDueDate);
				for (let i = 1; i <= numberOfInstallments; i++) {
					installmentsToCreate.push({
						loanId: loanRecord.id,
						installmentNumber: i,
						dueDate: currentDueDate.toDate(),
						principalAmount: principalPerInstallment.toString(),
						interestAmount: interestPerInstallment.toString(),
						totalAmount: totalAmountPerInstallment.toString(),
						status: "PENDING",
						parentType:"LOAN"
					});
					currentDueDate = currentDueDate.add(
						paymentPeriodicityMultiplier,
						paymentPeriodicityUnit,
					);
				}
				if (installmentsToCreate.length > 0) {
					await tx.insert(Installment).values(installmentsToCreate);
				}

				const transactionsToInsert: (typeof Transaction.$inferInsert)[] = [];
				let transactionDateCounter = 0;
				const getTxDate = () =>
					dayjs(input.purchaseDate)
						.add(transactionDateCounter++, "second")
						.toDate();

				const currentFromBalance = parseFloat(
					fromAccountAoB.currentBalance ?? "0",
				);
				const newFromBalance = currentFromBalance - grossValue;
				transactionsToInsert.push({
					date: getTxDate(),
					amount: grossValue.toString(),
					balance: newFromBalance.toString(),
					transactionType: "CREDIT",
					toAccountId: fromAccountAoB.id,
					personId: input.personId,
					memberId: member.id,
					transactionGroupId: transactionGroup.id,
					about: `Otorgamiento préstamo capital a ${personName}`,
				});

				const currentLoanAssetBalance = parseFloat(
					loanAssetAoB.currentBalance ?? "0",
				);
				const newLoanAssetBalance = currentLoanAssetBalance + grossValue;
				transactionsToInsert.push({
					date: getTxDate(),
					amount: grossValue.toString(),
					balance: newLoanAssetBalance.toString(),
					transactionType: "DEBIT",
					toAccountId: loanAssetAoB.id,
					fromAccountId: fromAccountAoB.id,
					personId: input.personId,
					memberId: member.id,
					transactionGroupId: transactionGroup.id,
					about: `Registro activo préstamo capital ${personName}`,
				});

				if (totalInterestToCharge > 0) {
					const currentInterestRevenueBalance = parseFloat(
						interestRevenueAoB.currentBalance ?? "0",
					);
					const newInterestRevenueBalance =
						currentInterestRevenueBalance + totalInterestToCharge;
					transactionsToInsert.push({
						date: getTxDate(),
						amount: totalInterestToCharge.toString(),
						balance: newInterestRevenueBalance.toString(),
						transactionType: "DEBIT",
						toAccountId: interestRevenueAoB.id,
						personId: input.personId,
						memberId: member.id,
						transactionGroupId: transactionGroup.id,
						about: `Registro ingreso esperado por intereses préstamo ${personName}`,
					});
				}

				await tx.insert(Transaction).values(transactionsToInsert);

				await tx
					.update(AccountOnBusiness)
					.set({
						currentBalance: newFromBalance.toString(),
						lastTransactionDate: getTxDate(),
					})
					.where(eq(AccountOnBusiness.id, fromAccountAoB.id));
				await tx
					.update(AccountOnBusiness)
					.set({
						currentBalance: newLoanAssetBalance.toString(),
						lastTransactionDate: getTxDate(),
					})
					.where(eq(AccountOnBusiness.id, loanAssetAoB.id));
				if (totalInterestToCharge > 0) {
					await tx
						.update(AccountOnBusiness)
						.set({
							currentBalance: (
								parseFloat(interestRevenueAoB.currentBalance ?? "0") +
								totalInterestToCharge
							).toString(),
							lastTransactionDate: getTxDate(),
						})
						.where(eq(AccountOnBusiness.id, interestRevenueAoB.id));
				}

				if (fromAccountAoB.subAccount)
					await updateParentAccount(
						fromAccountAoB.dictionaryAccountId,
						fromAccountAoB.businessId,
					);
				if (loanAssetAoB.subAccount)
					await updateParentAccount(
						loanAssetAoB.dictionaryAccountId,
						loanAssetAoB.businessId,
					);
				if (interestRevenueAoB.subAccount && totalInterestToCharge > 0)
					await updateParentAccount(
						interestRevenueAoB.dictionaryAccountId,
						interestRevenueAoB.businessId,
					);

				const accountIdsToFix = [fromAccountAoB.id, loanAssetAoB.id];
				if (totalInterestToCharge > 0)
					accountIdsToFix.push(interestRevenueAoB.id);
				for (const accountId of accountIdsToFix) {
					if (accountId) {
						await tx.execute(
							sql`SELECT fix_single_account_balance(${accountId}::uuid);`,
						);
					}
				}
				return {
					loan: loanRecord,
					transactionGroup,
					installments: installmentsToCreate,
				};
			});

			return result;
		}),
	byId: protectedProcedure.input(IdSchema).query(async ({ ctx, input }) => {
		const loan = await ctx.db.query.Loan.findFirst({
			where: eq(Loan.id, input.id),
			with: {
				guild: true,
				business: true,
				member: true,
				person: true,
				loansOnTransactionGroup: {
					with: {
						transactionGroup: {
							with: {
								transactions: {
									with: {
										toAccount: {
											with: {
												dictionaryAccount: true,
												business: true,
											},
										},
										fromAccount: {
											with: {
												dictionaryAccount: true,
												business: true,
											},
										},
									},
								},
							},
						},
					},
				},
			},
		});

		if (!loan) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Préstamo no encontrado",
			});
		}

		return loan;
	}),

	byGuildSlug: protectedProcedure
		.input(GuildSlugSchema)
		.query(async ({ ctx, input }) => {
			const loans = await ctx.db.query.Loan.findMany({
				where: eq(Loan.guildSlug, input.guildSlug),
				with: {
					guild: true,
					business: true,
					member: {
						with: {
							user: true,
						},
					},
					person: true,
				},
				orderBy: [desc(Loan.createdAt)],
			});

			return loans;
		}),
	byGuildSlugWithCursor: protectedProcedure
		.input(GuildSlugCursorSchema)
		.query(async ({ ctx, input }) => {
			const { guildSlug, limit, cursor, searchTerm } = input;

			const conditions: SQL[] = []; // Inicializa como SQL[]

			conditions.push(eq(Loan.guildSlug, guildSlug));
			// conditions.push(eq(Loan.discharged, true)); // Descomenta si solo quieres activos

			if (searchTerm && searchTerm.trim() !== "") {
				const searchTermLower = `%${searchTerm.toLowerCase().trim()}%`;
				conditions.push(
					or(
						ilike(Loan.about, searchTermLower),
						sql`EXISTS (SELECT 1 FROM ${Person} p WHERE p.id = ${Loan.personId} AND ${ilike(Person.name, searchTermLower)})`,
					)!, // El ! al final es para decirle a TS que or() no devolverá undefined aquí
				);
			}

			if (cursor) {
				conditions.push(
					or(
						lt(Loan.createdAt, new Date(cursor.createdAt)),
						and(
							eq(Loan.createdAt, new Date(cursor.createdAt)),
							lt(Loan.id, cursor.id),
						),
					)!, // El ! al final
				);
			}

			const finalWhereCondition =
				conditions.length > 0 ? and(...conditions) : undefined;

			const itemsFetchedFromDB = await ctx.db.query.Loan.findMany({
				where: finalWhereCondition, // Drizzle where() puede aceptar undefined (sin filtro)
				with: {
					business: { columns: { id: true, name: true, businessSlug: true } },
					member: {
						with: {
							user: {
								columns: {
									id: true,
									firstname: true,
									lastname: true,
									email: true,
								},
							},
						},
					},
					person: { columns: { id: true, name: true } },
				},
				orderBy: [desc(Loan.purchaseDate), desc(Loan.id)],
				limit: limit + 1,
			});

			let nextCursorResult:
				| z.TypeOf<typeof GuildSlugCursorSchema>["cursor"]
				| undefined = undefined;

			if (itemsFetchedFromDB.length > limit) {
				const lastItem = itemsFetchedFromDB[limit - 1];
				if (lastItem?.createdAt && lastItem?.id) {
					// Asegurarse que los campos del cursor existan
					nextCursorResult = {
						createdAt: lastItem.createdAt.toISOString(),
						id: lastItem.id,
					};
				}
			}

			return {
				items: itemsFetchedFromDB.slice(0, limit),
				nextCursor: nextCursorResult,
			};
		}),

	countByGuildSlug: protectedProcedure
		.input(GuildSlugSchema.extend({ searchTerm: z.string().optional() }))
		.query(async ({ ctx, input }) => {
			const { guildSlug, searchTerm } = input;

			const conditions: SQL[] = [];
			conditions.push(eq(Loan.guildSlug, guildSlug));
			// conditions.push(eq(Loan.discharged, true));

			if (searchTerm && searchTerm.trim() !== "") {
				const searchTermLower = `%${searchTerm.toLowerCase().trim()}%`;
				conditions.push(
					or(
						ilike(Loan.about, searchTermLower),
						sql`EXISTS (SELECT 1 FROM ${Person} p WHERE p.id = ${Loan.personId} AND ${ilike(Person.name, searchTermLower)})`,
					)!,
				);
			}

			const finalWhereCondition =
				conditions.length > 0 ? and(...conditions) : undefined;

			const result = await ctx.db
				.select({ total: count() })
				.from(Loan)
				.where(finalWhereCondition);

			return { total: result[0]?.total ? Number(result[0].total) : 0 };
		}),
	byBusinessSlug: protectedProcedure
		.input(BusinessSlugSchema)
		.query(async ({ ctx, input }) => {
			// Buscar primero el business con los slugs
			const business = await ctx.db.query.Business.findFirst({
				where: and(
					eq(Business.guildSlug, input.guildSlug),
					eq(Business.businessSlug, input.businessSlug),
				),
			});

			if (!business) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Empresa no encontrada",
				});
			}

			const loans = await ctx.db.query.Loan.findMany({
				where: eq(Loan.businessId, business.id),
				with: {
					guild: true,
					business: true,
					member: {
						with: {
							user: true,
						},
					},
					person: true,
				},
				orderBy: [desc(Loan.createdAt)],
			});

			return loans;
		}),

	byPersonId: protectedProcedure
		.input(PersonIdSchema)
		.query(async ({ ctx, input }) => {
			const loans = await ctx.db.query.Loan.findMany({
				where: eq(Loan.personId, input.personId),
				with: {
					guild: true,
					business: true,
					member: {
						with: {
							user: true,
						},
					},
					person: true,
				},
				orderBy: [desc(Loan.createdAt)],
			});

			return loans;
		}),

	modify: protectedProcedure
		.input(modifyLoanSchema)
		.mutation(async ({ ctx, input }) => {
			const loan = await ctx.db.query.Loan.findFirst({
				where: eq(Loan.id, input.loanId),
			});

			if (!loan) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Préstamo no encontrado",
				});
			}

			// Construir objeto de actualización solo con los campos provistos
			const updatePayload: Partial<typeof Loan.$inferInsert> = {
				updatedAt: new Date(),
			};
			if (input.discharged !== undefined) {
				updatePayload.discharged = input.discharged;
			}
			if (input.status !== undefined) {
				updatePayload.status = input.status;
			}
			if (input.about !== undefined) {
				updatePayload.about = input.about;
			}

			if (
				Object.keys(updatePayload).length === 1 &&
				"updatedAt" in updatePayload
			) {
				// No hay nada que actualizar más que updatedAt, podrías retornar el préstamo actual o un mensaje.
				// Opcionalmente, podrías lanzar un error si esperas al menos un campo modificable.
				// Por ahora, permitimos que solo se actualice updatedAt si es el caso.
				// Pero es mejor si el frontend asegura que al menos un campo cambiable sea enviado.
				if (Object.keys(input).length <= 1) {
					// solo loanId enviado
					return loan; // Devuelve el préstamo sin cambios si solo se envió loanId
				}
			}

			// Realizar las modificaciones
			const updatedLoan = await ctx.db
				.update(Loan)
				.set({
					discharged:
						input.discharged !== undefined ? input.discharged : loan.discharged,
					about: input.about !== undefined ? input.about : loan.about,
					updatedAt: new Date(),
				})
				.where(eq(Loan.id, input.loanId))
				.returning();

			if (!updatedLoan || updatedLoan.length === 0 || !updatedLoan[0]) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Error al modificar el préstamo",
				});
			}

			// Registrar la acción
			// await createLog(
			//     "Loan",
			//     updatedLoan[0].id,
			//     "MODIFY",
			//     ctx.user.id,
			//     updatedLoan[0].guildSlug,
			//     1,
			//     {
			//         discharged: updatedLoan[0].discharged,
			//         about: updatedLoan[0].about
			//     },
			//     updatedLoan[0].businessId
			// );

			return updatedLoan[0];
		}),
	delete: protectedProcedure
		.input(IdSchema)
		.mutation(async ({ ctx, input }) => {
			const { id } = input;

			// Verificar si el préstamo existe
			const loan = await ctx.db.query.Loan.findFirst({
				where: eq(Loan.id, id),
			});

			if (!loan) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Préstamo no encontrado",
				});
			}

			// Buscar las relaciones con grupos de transacciones
			const loanOnTransactionGroups =
				await ctx.db.query.LoanOnTransactionGroup.findMany({
					where: eq(LoanOnTransactionGroup.loanId, id),
					with: {
						transactionGroup: true,
					},
				});

			// Obtener los IDs de los grupos de transacciones relacionados
			const transactionGroupIds = loanOnTransactionGroups.map(
				(lotg) => lotg.transactionGroupId,
			);

			// Eliminar en una transacción para asegurar consistencia
			return await ctx.db.transaction(async (tx) => {
				// 1. Eliminar las relaciones de préstamos con grupos de transacciones
				if (loanOnTransactionGroups.length > 0) {
					await tx
						.delete(LoanOnTransactionGroup)
						.where(eq(LoanOnTransactionGroup.loanId, id));
				}

				// 2. Eliminar todas las transacciones relacionadas con los grupos de transacciones
				if (transactionGroupIds.length > 0) {
					// 2.1 Primero buscar las transacciones relacionadas
					const transactions = await tx.query.Transaction.findMany({
						where: inArray(Transaction.transactionGroupId, transactionGroupIds),
					});

					const transactionIds = transactions.map((t) => t.id);
					const accountIds = [
						...transactions
							.flatMap((t) => t.toAccountId)
							.filter((item) => item !== null),
						...transactions
							.flatMap((t) => t.fromAccountId)
							.filter((item) => item !== null),
					];

					if (transactionIds.length > 0) {
						// Eliminar documentos
						await tx
							.delete(Document)
							.where(inArray(Document.transactionId, transactionIds));

						// Eliminar transacciones
						await tx
							.delete(Transaction)
							.where(inArray(Transaction.id, transactionIds));
					}

					for (const accountId of accountIds) {
						await ctx.db.execute(
							sql`SELECT fix_single_account_balance(${accountId});`,
						);
					}

					// 2.2 Eliminar los grupos de transacciones
					await tx
						.delete(TransactionGroup)
						.where(inArray(TransactionGroup.id, transactionGroupIds));
				}

				// 3. Finalmente eliminar el préstamo
				await tx.delete(Loan).where(eq(Loan.id, id));

				return { success: true };
			});
		}),
	byIdWithInstallments: protectedProcedure
		.input(z.object({ loanId: z.string().uuid(), guildSlug: z.string() })) // Añadir guildSlug para verificación de pertenencia
		.query(async ({ ctx, input }) => {
			// Verificar que el usuario actual pertenece al guildSlug
			const memberAccess = await ctx.db.query.Member.findFirst({
				where: and(
					eq(Member.userId, ctx.user.id),
					eq(Member.guildSlug, input.guildSlug),
				),
				columns: { id: true },
			});
			if (!memberAccess) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "No tienes acceso a esta organización.",
				});
			}

			const loan = await ctx.db.query.Loan.findFirst({
				where: and(
					eq(Loan.id, input.loanId),
					eq(Loan.guildSlug, input.guildSlug), // Asegurar que el préstamo pertenezca al guild correcto
				),
				with: {
					person: true,
					business: true,
					member: { with: { user: true } },
					installments: {
						// Cargar las cuotas ordenadas
						orderBy: (fields, { asc }) => [asc(fields.installmentNumber)],
						with: {
							// Opcional: Cargar la transacción de pago si ya existe
							paymentTransaction: {
								columns: { id: true, date: true, amount: true },
							},
						},
					},
					// loanOnTransactionGroups: { with: { transactionGroup: { with: { transactions: true }}}} // Si necesitas los grupos de transacciones originales
				},
			});
			if (!loan) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Préstamo no encontrado.",
				});
			}
			return loan;
		}),

	markInstallmentPaid: protectedProcedure
		.input(markInstallmentPaidSchema)
		.mutation(async ({ ctx, input }) => {
			const {
				guildSlug,
				loanId,
				installmentId,
				paymentDate,
				receivingDictionaryAccountId,
				notes,
				exchangeRate,
				rateFromCurrency,
			} = input;

			const member = await ctx.db.query.Member.findFirst({
				where: and(
					eq(Member.userId, ctx.user.id),
					eq(Member.guildSlug, guildSlug)
				)
			});
			if (!member) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "No tienes permiso para realizar esta acción.",
				});
			}

			return await ctx.db.transaction(async (tx) => {
				const installment = await tx.query.Installment.findFirst({
					where: and(eq(Installment.id, installmentId), eq(Installment.loanId, loanId)),
					with: { loan: true }
				});

				if (!installment || !installment.loan) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Cuota o préstamo no encontrado.",
					});
				}
				if (installment.status !== 'PENDING') {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Esta cuota ya ha sido procesada o cancelada.",
					});
				}
				if (installment.loan.guildSlug !== guildSlug) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "Acceso denegado al préstamo.",
					});
				}


				const receivingBusinessId = installment.loan.businessId;
				const loanCurrency = installment.loan.currency;

				const receivingDictionaryAccount = await tx.query.DictionaryAccount.findFirst({
					where: eq(DictionaryAccount.id, receivingDictionaryAccountId),
				});
				if (!receivingDictionaryAccount) {
					throw new TRPCError({ code: "NOT_FOUND", message: "Tipo de cuenta receptora no encontrado." });
				}
				if (receivingDictionaryAccount.accountType !== 'ASSET') {
					throw new TRPCError({ code: 'BAD_REQUEST', message: 'La cuenta receptora debe ser de tipo Activo.' });
				}

				let receivingAoB = await tx.query.AccountOnBusiness.findFirst({
					where: and(
						eq(AccountOnBusiness.dictionaryAccountId, receivingDictionaryAccountId),
						eq(AccountOnBusiness.businessId, receivingBusinessId)
					),
					with: { dictionaryAccount: true }
				});

				if (!receivingAoB) {
					const inserted = (await tx.insert(AccountOnBusiness).values({
						businessId: receivingBusinessId,
						dictionaryAccountId: receivingDictionaryAccountId,
					}).returning({ id: AccountOnBusiness.id }))[0];
					if (!inserted) {
						throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo crear la cuenta receptora en la empresa." });
					}
					receivingAoB = await tx.query.AccountOnBusiness.findFirst({
						where: eq(AccountOnBusiness.id, inserted.id),
						with: { dictionaryAccount: true }
					});
				}
				if (!receivingAoB) {
					throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Cuenta receptora no encontrada." });
				}

				const receivingCurrency = receivingAoB.dictionaryAccount.currency;
				const requiresConversion = loanCurrency !== receivingCurrency;
				let amountToCreditInReceivingCurrency = parseFloat(installment.totalAmount);
				let finalExchangeRateForTx: string | undefined = undefined;

				if (requiresConversion) {
					if (!exchangeRate || !rateFromCurrency) {
						throw new TRPCError({ code: 'BAD_REQUEST', message: "Se requiere tipo de cambio para el pago en otra divisa." });
					}
					const rate = parseFloat(exchangeRate.replace(",", "."));
					if (rate <= 0) {
						throw new TRPCError({ code: 'BAD_REQUEST', message: 'La cotización debe ser un número positivo.' });
					}

					if (rateFromCurrency === loanCurrency) {
						amountToCreditInReceivingCurrency = parseFloat(installment.totalAmount) / rate;
						finalExchangeRateForTx = (1 / rate).toString();
					} else {
						amountToCreditInReceivingCurrency = parseFloat(installment.totalAmount) * rate;
						finalExchangeRateForTx = rate.toString();
					}
				}

				const loanAssetAoB = await tx.query.AccountOnBusiness.findFirst({
					where: and(
						eq(AccountOnBusiness.dictionaryAccountId, (await tx.query.DictionaryAccount.findFirst({ where: and(eq(DictionaryAccount.slug, "prestamosotorgados"), eq(DictionaryAccount.guildSlug, guildSlug), eq(DictionaryAccount.currency, loanCurrency)) }))!.id),
						eq(AccountOnBusiness.businessId, installment.loan.businessId)
					),
				});
				if (!loanAssetAoB) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Cuenta 'prestamosotorgados' (${loanCurrency}) no encontrada.` });

				const interestRevenueAoB = await tx.query.AccountOnBusiness.findFirst({
					where: and(
						eq(AccountOnBusiness.dictionaryAccountId, (await tx.query.DictionaryAccount.findFirst({ where: and(eq(DictionaryAccount.slug, "interesesganadosprestamos"), eq(DictionaryAccount.guildSlug, guildSlug), eq(DictionaryAccount.currency, loanCurrency)) }))!.id),
						eq(AccountOnBusiness.businessId, installment.loan.businessId)
					),
				});
				if (!interestRevenueAoB) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Cuenta 'interesesganadosprestamos' (${loanCurrency}) no encontrada.` });

				const transactionGroupName = `Pago Cuota ${installment.installmentNumber} Préstamo #${installment.loan.id.substring(0, 8)}`;
				const transactionGroup = (await tx.insert(TransactionGroup).values({
					guildSlug: guildSlug, name: transactionGroupName, businessId: installment.loan.businessId,
					description: `Pago de la cuota ${installment.installmentNumber}.`, operationType: "REGULAR"
				}).returning())[0];
				if (!transactionGroup) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al crear TransactionGroup." });

				let transactionDateCounter = 0;
				const getTxDate = () => dayjs(paymentDate).add(transactionDateCounter++, 'second').toDate();

				const principalPaid = parseFloat(installment.principalAmount);
				const interestPaid = parseFloat(installment.interestAmount);

				const currentReceivingBalance = parseFloat(receivingAoB.currentBalance ?? "0");
				const newReceivingBalance = currentReceivingBalance + amountToCreditInReceivingCurrency;

				const currentLoanAssetBalance = parseFloat(loanAssetAoB.currentBalance ?? "0");
				const newLoanAssetBalance = currentLoanAssetBalance - principalPaid;

				const currentInterestRevenueBalance = parseFloat(interestRevenueAoB.currentBalance ?? "0");
				const newInterestRevenueBalance = currentInterestRevenueBalance - interestPaid;

				const transactionInserts = [];

				const receivingTx = {
					date: getTxDate(), amount: amountToCreditInReceivingCurrency.toString(), balance: newReceivingBalance.toString(),
					transactionType: 'DEBIT' as const, toAccountId: receivingAoB.id,
					personId: installment.loan.personId, memberId: member.id, transactionGroupId: transactionGroup.id,
					about: `Cobro cuota ${installment.installmentNumber} en ${receivingCurrency}`,
					exchangeRate: finalExchangeRateForTx,
				};
				transactionInserts.push(receivingTx);

				if (principalPaid > 0) {
					transactionInserts.push({
						date: getTxDate(), amount: principalPaid.toString(), balance: newLoanAssetBalance.toString(),
						transactionType: 'CREDIT' as const, toAccountId: loanAssetAoB.id, fromAccountId: receivingAoB.id,
						personId: installment.loan.personId, memberId: member.id, transactionGroupId: transactionGroup.id,
						about: `Capital cuota ${installment.installmentNumber}`,
					});
				}

				if (interestPaid > 0) {
					transactionInserts.push({
						date: getTxDate(), amount: interestPaid.toString(), balance: newInterestRevenueBalance.toString(),
						transactionType: 'CREDIT' as const, toAccountId: interestRevenueAoB.id, fromAccountId: receivingAoB.id,
						personId: installment.loan.personId, memberId: member.id, transactionGroupId: transactionGroup.id,
						about: `Interés cuota ${installment.installmentNumber}`,
					});
				}

				const createdTransactions = await tx.insert(Transaction).values(transactionInserts).returning();
				const receivingTransactionRecord = createdTransactions.find(t => t.toAccountId === receivingAoB.id);

				await tx.update(AccountOnBusiness).set({ currentBalance: newReceivingBalance.toString(), lastTransactionDate: receivingTx.date }).where(eq(AccountOnBusiness.id, receivingAoB.id));
				if (principalPaid > 0) {
					await tx.update(AccountOnBusiness).set({ currentBalance: newLoanAssetBalance.toString(), lastTransactionDate: receivingTx.date }).where(eq(AccountOnBusiness.id, loanAssetAoB.id));
				}
				if (interestPaid > 0) {
					await tx.update(AccountOnBusiness).set({ currentBalance: newInterestRevenueBalance.toString(), lastTransactionDate: receivingTx.date }).where(eq(AccountOnBusiness.id, interestRevenueAoB.id));
				}

				await tx.update(Installment).set({
					status: 'PAID', paidDate: paymentDate, paidAmount: installment.totalAmount,
					notes: notes, paymentTransactionId: receivingTransactionRecord?.id ?? null,
				}).where(eq(Installment.id, installmentId));

				const newPaidPrincipal = parseFloat(installment.loan.paidPrincipal ?? "0") + principalPaid;
				const newPaidInterest = parseFloat(installment.loan.paidInterest ?? "0") + interestPaid;
				const newRemainingPrincipal = parseFloat(installment.loan.grossValue) - newPaidPrincipal;

				let loanFinalStatus = installment.loan.status;
				if (newRemainingPrincipal <= 0.01) {
					loanFinalStatus = 'PAID_OFF';
				}

				await tx.update(Loan).set({
					paidPrincipal: newPaidPrincipal.toString(), paidInterest: newPaidInterest.toString(),
					remainingPrincipal: newRemainingPrincipal.toString(), status: loanFinalStatus,
					updatedAt: new Date(),
				}).where(eq(Loan.id, loanId));

				if (receivingAoB.subAccount) await updateParentAccount(receivingAoB.dictionaryAccountId, receivingAoB.businessId);
				if (loanAssetAoB.subAccount) await updateParentAccount(loanAssetAoB.dictionaryAccountId, loanAssetAoB.businessId);
				if (interestRevenueAoB.subAccount) await updateParentAccount(interestRevenueAoB.dictionaryAccountId, interestRevenueAoB.businessId);

				const accountIdsToFix = [receivingAoB.id, loanAssetAoB.id, interestRevenueAoB.id];
				for (const accountId of accountIdsToFix) {
					if (accountId) await tx.execute(sql`SELECT fix_single_account_balance(${accountId}::uuid);`);
				}

				return { success: true, installmentId, loanId, transactionGroupId: transactionGroup.id };
			});
		}),
	settleEarly: protectedProcedure
		.input(settleLoanEarlySchema)
		.mutation(async ({ ctx, input }) => {
			const {
				loanId, guildSlug, settlementDate,
				receivingDictionaryAccountId, notes,
				exchangeRate, rateFromCurrency
			} = input;

			const member = await ctx.db.query.Member.findFirst({
				where: and(eq(Member.userId, ctx.user.id), eq(Member.guildSlug, guildSlug))
			});
			if (!member) {
				throw new TRPCError({ code: "FORBIDDEN", message: "No tienes permiso para realizar esta acción." });
			}

			return await ctx.db.transaction(async (tx) => {
				const loan = await tx.query.Loan.findFirst({
					where: and(eq(Loan.id, loanId), eq(Loan.guildSlug, guildSlug)),
					with: { installments: { orderBy: (f, { asc }) => [asc(f.installmentNumber)] } }
				});

				if (!loan || loan.status !== 'ACTIVE') {
					throw new TRPCError({ code: "BAD_REQUEST", message: "Solo se pueden liquidar préstamos activos." });
				}

				const receivingDictionaryAccount = await tx.query.DictionaryAccount.findFirst({
					where: eq(DictionaryAccount.id, receivingDictionaryAccountId),
				});
				if (!receivingDictionaryAccount) {
					throw new TRPCError({ code: "NOT_FOUND", message: "Tipo de cuenta receptora no encontrado." });
				}
				if (receivingDictionaryAccount.accountType !== 'ASSET') {
					throw new TRPCError({ code: 'BAD_REQUEST', message: 'La cuenta receptora debe ser de tipo Activo.' });
				}

				const receivingBusinessId = loan.businessId;
				const loanCurrency = loan.currency;
				const receivingCurrency = receivingDictionaryAccount.currency;
				const requiresConversion = loanCurrency !== receivingCurrency;

				if (requiresConversion && (!exchangeRate || !rateFromCurrency)) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "Se requiere tipo de cambio para liquidar en otra divisa." });
				}

				let receivingAoB = await tx.query.AccountOnBusiness.findFirst({
					where: and(
						eq(AccountOnBusiness.dictionaryAccountId, receivingDictionaryAccountId),
						eq(AccountOnBusiness.businessId, receivingBusinessId)
					),
					with: { dictionaryAccount: true }
				});
				if (!receivingAoB) {
					const inserted = (await tx.insert(AccountOnBusiness).values({
						businessId: receivingBusinessId,
						dictionaryAccountId: receivingDictionaryAccountId,
					}).returning({ id: AccountOnBusiness.id }))[0];
					if (!inserted) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo crear la cuenta receptora en la empresa." });
					receivingAoB = await tx.query.AccountOnBusiness.findFirst({ where: eq(AccountOnBusiness.id, inserted.id), with: { dictionaryAccount: true } });
				}
				if (!receivingAoB) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Cuenta receptora no encontrada." });

				const today = dayjs(settlementDate).startOf('day');
				const pendingInstallments = loan.installments.filter(i => i.status === 'PENDING' || i.status === 'OVERDUE');

				let interestToSettle = 0;
				const futureInstallmentsToCancel: string[] = [];
				pendingInstallments.forEach(inst => {
					if (dayjs(inst.dueDate).isSameOrBefore(today)) {
						interestToSettle += parseFloat(inst.interestAmount);
					} else {
						futureInstallmentsToCancel.push(inst.id);
					}
				});

				const capitalToSettle = parseFloat(loan.remainingPrincipal ?? loan.grossValue);
				const totalSettlementAmountInLoanCurrency = capitalToSettle + interestToSettle;

				let amountToCreditInReceivingCurrency = totalSettlementAmountInLoanCurrency;
				let finalExchangeRateForTx: string | undefined = undefined;

				if (requiresConversion) {
					const rate = parseFloat(exchangeRate!.replace(",", "."));
					if (rate <= 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'La cotización debe ser positiva.' });

					if (rateFromCurrency === loanCurrency) {
						amountToCreditInReceivingCurrency = totalSettlementAmountInLoanCurrency / rate;
						finalExchangeRateForTx = (1 / rate).toString();
					} else {
						amountToCreditInReceivingCurrency = totalSettlementAmountInLoanCurrency * rate;
						finalExchangeRateForTx = rate.toString();
					}
				}

				const findSystemAoB = async (slug: string) => {
					const dict = await tx.query.DictionaryAccount.findFirst({ where: and(eq(DictionaryAccount.slug, slug), eq(DictionaryAccount.guildSlug, guildSlug), eq(DictionaryAccount.currency, loanCurrency)) });
					if (!dict) return null;
					return await tx.query.AccountOnBusiness.findFirst({ where: and(eq(AccountOnBusiness.dictionaryAccountId, dict.id), eq(AccountOnBusiness.businessId, loan.businessId)) });
				}

				const loanAssetAoB = await findSystemAoB("prestamosotorgados");
				if (!loanAssetAoB) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Cuenta 'prestamosotorgados' (${loanCurrency}) no encontrada.` });

				const interestRevenueAoB = await findSystemAoB("interesesganadosprestamos");
				if (!interestRevenueAoB) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Cuenta 'interesesganadosprestamos' (${loanCurrency}) no encontrada.` });

				const personName = (await tx.query.Person.findFirst({ where: eq(Person.id, loan.personId!), columns: { name: true } }))?.name ?? 'Cliente';
				const transactionGroupName = `Liquidación Préstamo a ${personName} - ${dayjs(settlementDate).format("DD/MM/YY")}`;
				const transactionGroup = (await tx.insert(TransactionGroup).values({
					guildSlug: guildSlug, name: transactionGroupName, businessId: loan.businessId,
					description: `Liquidación anticipada del préstamo.`, operationType: "LOAN"
				}).returning())[0];
				if (!transactionGroup) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al crear TransactionGroup." });

				const transactionsToInsert: (Omit<typeof Transaction.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>)[] = [];
				let transactionDateCounter = 0;
				const getTxDate = () => dayjs(settlementDate).add(transactionDateCounter++, 'second').toDate();

				const newReceivingBalance = parseFloat(receivingAoB.currentBalance ?? "0") + amountToCreditInReceivingCurrency;
				transactionsToInsert.push({
					date: getTxDate(), amount: amountToCreditInReceivingCurrency.toString(), balance: newReceivingBalance.toString(),
					transactionType: 'DEBIT', toAccountId: receivingAoB.id,
					personId: loan.personId, memberId: member.id, transactionGroupId: transactionGroup.id,
					about: `Liquidación préstamo #${loan.id.substring(0, 8)}`,
					exchangeRate: finalExchangeRateForTx,
				});

				const newLoanAssetBalance = parseFloat(loanAssetAoB.currentBalance ?? "0") - capitalToSettle;
				transactionsToInsert.push({
					date: getTxDate(), amount: capitalToSettle.toString(), balance: newLoanAssetBalance.toString(),
					transactionType: 'CREDIT', toAccountId: loanAssetAoB.id, fromAccountId: receivingAoB.id,
					personId: loan.personId, memberId: member.id, transactionGroupId: transactionGroup.id,
					about: `Cancelación capital por liquidación`,
				});

				const interestForgiven = parseFloat(loan.totalInterestAmount) - parseFloat(loan.paidInterest ?? "0") - interestToSettle;
				if (Math.abs(interestForgiven) > 0.01) { // Solo registrar si hay un interés perdonado significativo
					const newInterestRevenueBalance = parseFloat(interestRevenueAoB.currentBalance ?? "0") - interestForgiven; // Un CRÉDITO disminuye esta cuenta de Ingreso (Saldo Deudor)
					transactionsToInsert.push({
						date: getTxDate(), amount: interestForgiven.toString(),
						balance: newInterestRevenueBalance.toString(),
						transactionType: 'CREDIT', toAccountId: interestRevenueAoB.id, fromAccountId: receivingAoB.id,
						personId: loan.personId, memberId: member.id, transactionGroupId: transactionGroup.id,
						about: `Reversión de intereses futuros por liquidación`,
					});
				}

				await tx.insert(Transaction).values(transactionsToInsert);

				await tx.update(AccountOnBusiness).set({ currentBalance: newReceivingBalance.toString() }).where(eq(AccountOnBusiness.id, receivingAoB.id));
				await tx.update(AccountOnBusiness).set({ currentBalance: newLoanAssetBalance.toString() }).where(eq(AccountOnBusiness.id, loanAssetAoB.id));
				if (Math.abs(interestForgiven) > 0.01) {
					await tx.update(AccountOnBusiness).set({ currentBalance: (parseFloat(interestRevenueAoB.currentBalance ?? "0") - interestForgiven).toString() }).where(eq(AccountOnBusiness.id, interestRevenueAoB.id));
				}

				const installmentsToPayNow = pendingInstallments.filter(i => dayjs(i.dueDate).isSameOrBefore(today));
				if (installmentsToPayNow.length > 0) {
					await tx.update(Installment).set({ status: 'PAID', paidDate: settlementDate })
						.where(inArray(Installment.id, installmentsToPayNow.map(i => i.id)));
				}

				if (futureInstallmentsToCancel.length > 0) {
					await tx.update(Installment).set({ status: 'SETTLED_EARLY' })
						.where(inArray(Installment.id, futureInstallmentsToCancel));
				}

				await tx.update(Loan).set({
					status: 'PAID_OFF', remainingPrincipal: "0",
					paidPrincipal: loan.grossValue,
					paidInterest: (parseFloat(loan.paidInterest ?? "0") + interestToSettle).toString(),
					updatedAt: new Date()
				}).where(eq(Loan.id, loanId));

				const accountIdsToFix = [receivingAoB.id, loanAssetAoB.id, interestRevenueAoB.id];
				for (const accountId of accountIdsToFix) {
					if (accountId) await tx.execute(sql`SELECT fix_single_account_balance(${accountId}::uuid);`);
				}

				return { success: true, settlementAmount: totalSettlementAmountInLoanCurrency, currency: loanCurrency };
			});
		}),
});
