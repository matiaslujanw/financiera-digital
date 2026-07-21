// Ruta: packages/api/src/router/transaction.ts

import { TRPCError } from "@trpc/server";
import {
	and,
	asc,
	count,
	desc,
	eq,
	gte,
	inArray,
	lt,
	lte,
	or,
	sql,
} from "drizzle-orm";
import Papa from "papaparse";
import { z } from "zod";

import {
	AccountOnBusiness,
	AccountOnBusinessSchema,
	AccountType,
	Business,
	Cable,
	CableOnTransactionGroup,
	Check,
	CheckOnTransactionGroup,
	Credit,
	CreditOnTransactionGroup,
	Currency,
	CurrencyEnum,
	DictionaryAccount,
	DictionaryAccountSchema,
	Document,
	Loan,
	LoanOnTransactionGroup,
	Member,
	MemberOnAccountOnBusiness,
	MemberOnBusiness,
	Transaction,
	TransactionGroup,
	TransactionType,
	User,
} from "@acme/db/schema";
import {
	AccountIdSchema,
	BusinessSlugSchema,
	GuildSlugSchema,
	modifyTransactionSchema,
	MultipleTransactionInputSchema,
	SubAccountIdentityInputSchema,
	TransactionByAccountCursorInputSchema,
	TransactionByBusinessCursorInputSchema,
	TransactionBySubAccountCursorInputSchema,
	TransactionCreateSchema,
	TransactionCursorInputSchema,
	TransactionsByAccountForPeriodInputSchema,
} from "@acme/validators";

import { dayjs } from "../lib/dayjs";
import {
	calculatePurchaseValues,
	calculateSaleValues,
	formatForStorage,
	parseNumericValue,
} from "../lib/financial-utils";
import {
	combineDateWithCurrentTime,
	convertAmount,
	formatForSubmit,
	updateParentAccount,
} from "../lib/utils";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

export const transactionRouter = createTRPCRouter({
	// create transaction
	create: protectedProcedure
		.input(TransactionCreateSchema)
		.mutation(async ({ ctx, input }) => {
			console.log(input, "caputo");

			if (input.toAccountId === "") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Debes seleccionar una cuenta hacia.",
				});
			}

			if (input.toBusinessId === "") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Debes seleccionar una empresa hacia.",
				});
			}

			// Crear una fecha que combine el día/mes/año del input con la hora actual
			const combinedDate = combineDateWithCurrentTime(
				input.date,
				input.isMidnight,
			);

			const amount =
				Number(formatForSubmit(input.movement.increment ?? "0")) ||
				Number(formatForSubmit(input.movement.decrement ?? "0")) ||
				0;

			// Validar que haya un valor de cantidad
			if (amount <= 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Debe ingresar un monto válido mayor a 0",
				});
			}

			const member = await ctx.db.query.Member.findFirst({
				where: and(
					eq(Member.userId, ctx.user.id),
					eq(Member.guildSlug, input.guildSlug),
				),
			});

			if (!member) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Miembro inexistente",
				});
			}

			// Función auxiliar para obtener una cuenta con su diccionario
			const getAccountWithDictionaryAccount = async (accountId: string) => {
				return await ctx.db.query.AccountOnBusiness.findFirst({
					where: eq(AccountOnBusiness.id, accountId),
					with: {
						dictionaryAccount: true,
					},
				});
			};

			// Función para buscar o crear la cuenta principal para cuentas agregadas
			const getOrCreateMainAccount = async (
				db: typeof ctx.db,
				dictionaryAccountId: string,
				businessId: string,
			) => {
				// Buscar la cuenta principal (no subcuenta)
				const existingMainAccount = await db.query.AccountOnBusiness.findFirst({
					where: and(
						eq(AccountOnBusiness.dictionaryAccountId, dictionaryAccountId),
						eq(AccountOnBusiness.businessId, businessId),
						eq(AccountOnBusiness.subAccount, false),
					),
					with: {
						dictionaryAccount: true,
					},
				});

				// Si existe, la devolvemos
				if (existingMainAccount) {
					return existingMainAccount;
				}

				// Si no existe, la creamos
				const insertedMainAccount = (
					await db
						.insert(AccountOnBusiness)
						.values({
							businessId: businessId,
							dictionaryAccountId: dictionaryAccountId,
							subAccount: false,
							// No asignamos saldo aquí, se calculará mediante updateParentAccount
						})
						.returning()
				)[0];

				// Devolvemos la cuenta recién creada con su diccionario
				return await db.query.AccountOnBusiness.findFirst({
					where: eq(AccountOnBusiness.id, insertedMainAccount!.id),
					with: {
						dictionaryAccount: true,
					},
				});
			}; // Obtener información de los diccionarios de cuenta
			const toDictionaryAccount =
				await ctx.db.query.DictionaryAccount.findFirst({
					where: eq(DictionaryAccount.id, input.toAccountId),
				});

			if (!toDictionaryAccount) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Cuenta de diccionario de destino no encontrada",
				});
			}

			let fromDictionaryAccount;
			if (input.fromAccountId) {
				fromDictionaryAccount = await ctx.db.query.DictionaryAccount.findFirst({
					where: eq(DictionaryAccount.id, input.fromAccountId),
				});
			}

			// Validar si se requiere una entidad
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

			// Manejo de la cuenta de destino (toAccount)
			let toAccount;
			let toMainAccount; // Referencia a la cuenta principal si estamos usando subcuentas

			if (toDictionaryAccount.hasSubAccounts && input.entityId) {
				// Si es cuenta agregada, buscar o crear la subcuenta específica para la entidad
				const entityFieldMap = {
					PERSON: "personId",
					MACHINERY: "machineryId",
					VEHICLE: "vehicleId",
					PROPERTY: "propertyId",
				};

				const entityField =
					entityFieldMap[
					toDictionaryAccount.entityType as keyof typeof entityFieldMap
					];

				if (!entityField) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Tipo de entidad no válido para cuenta agregada",
					});
				}

				// Asegurarse de que exista la cuenta principal agregada
				toMainAccount = await getOrCreateMainAccount(
					ctx.db,
					input.toAccountId,
					input.toBusinessId,
				);

				// Buscar si ya existe una subcuenta para esta entidad
				const existingSubAccount =
					await ctx.db.query.AccountOnBusiness.findFirst({
						where: and(
							eq(AccountOnBusiness.dictionaryAccountId, input.toAccountId),
							eq(AccountOnBusiness.businessId, input.toBusinessId),
							eq(AccountOnBusiness.subAccount, true),
							// @ts-ignore - Esto es seguro porque entityField viene del mapeo
							eq(AccountOnBusiness[entityField], input.entityId),
						),
						with: {
							dictionaryAccount: true,
						},
					});

				if (existingSubAccount) {
					toAccount = existingSubAccount;
				} else {
					// Si no existe, crear la subcuenta
					const newSubAccount: any = {
						businessId: input.toBusinessId,
						dictionaryAccountId: input.toAccountId,
						subAccount: true,
					};
					// Asignar el ID de la entidad al campo correspondiente
					newSubAccount[entityField] = input.entityId;

					const insertedAccount = (
						await ctx.db
							.insert(AccountOnBusiness)
							.values(newSubAccount)
							.returning()
					)[0];
					toAccount = await getAccountWithDictionaryAccount(
						insertedAccount!.id,
					);
				}
			} else if (toDictionaryAccount.hasSubAccounts && !input.entityId) {
				// No debería llegar aquí debido a la validación anterior, pero por seguridad
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"Debe seleccionar una entidad para la cuenta de destino agregada",
				});
			} else {
				// Si es cuenta colectiva, buscar o crear la cuenta normal
				const existingAccount = await ctx.db.query.AccountOnBusiness.findFirst({
					where: and(
						eq(AccountOnBusiness.dictionaryAccountId, input.toAccountId),
						eq(AccountOnBusiness.businessId, input.toBusinessId),
						eq(AccountOnBusiness.subAccount, false),
					),
					with: {
						dictionaryAccount: true,
					},
				});

				if (existingAccount) {
					toAccount = existingAccount;
				} else {
					const insertedAccount = (
						await ctx.db
							.insert(AccountOnBusiness)
							.values({
								businessId: input.toBusinessId,
								dictionaryAccountId: input.toAccountId,
								subAccount: false,
							})
							.returning()
					)[0];

					toAccount = await getAccountWithDictionaryAccount(
						insertedAccount!.id,
					);
				}
			} // Manejo de la cuenta de origen (fromAccount)
			let fromAccount;
			let fromMainAccount; // Referencia a la cuenta principal si estamos usando subcuentas

			if (input.fromAccountId && fromDictionaryAccount) {
				if (fromDictionaryAccount.hasSubAccounts && input.entityId) {
					// Si es cuenta agregada, buscar o crear la subcuenta específica para la entidad
					const entityFieldMap = {
						PERSON: "personId",
						MACHINERY: "machineryId",
						VEHICLE: "vehicleId",
						PROPERTY: "propertyId",
					};

					const entityField =
						entityFieldMap[
						fromDictionaryAccount.entityType as keyof typeof entityFieldMap
						];

					if (!entityField) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: "Tipo de entidad no válido para cuenta agregada",
						});
					}

					// Asegurarse de que exista la cuenta principal agregada
					fromMainAccount = await getOrCreateMainAccount(
						ctx.db,
						input.fromAccountId,
						input.fromBusinessId ?? input.toBusinessId,
					);

					// Buscar si ya existe una subcuenta para esta entidad
					const existingSubAccount =
						await ctx.db.query.AccountOnBusiness.findFirst({
							where: and(
								eq(AccountOnBusiness.dictionaryAccountId, input.fromAccountId),
								eq(
									AccountOnBusiness.businessId,
									input.fromBusinessId ?? input.toBusinessId,
								),
								eq(AccountOnBusiness.subAccount, true),
								// @ts-ignore - Esto es seguro porque entityField viene del mapeo
								eq(AccountOnBusiness[entityField], input.entityId),
							),
							with: {
								dictionaryAccount: true,
							},
						});

					if (existingSubAccount) {
						fromAccount = existingSubAccount;
					} else {
						// Si no existe, crear la subcuenta
						const newSubAccount: any = {
							businessId: input.fromBusinessId ?? input.toBusinessId,
							dictionaryAccountId: input.fromAccountId,
							subAccount: true,
						};
						// Asignar el ID de la entidad al campo correspondiente
						newSubAccount[entityField] = input.entityId;

						const insertedAccount = (
							await ctx.db
								.insert(AccountOnBusiness)
								.values(newSubAccount)
								.returning()
						)[0];
						fromAccount = await getAccountWithDictionaryAccount(
							insertedAccount!.id,
						);
					}
				} else if (fromDictionaryAccount.hasSubAccounts && !input.entityId) {
					// No debería llegar aquí debido a la validación anterior, pero por seguridad
					throw new TRPCError({
						code: "BAD_REQUEST",
						message:
							"Debe seleccionar una entidad para la cuenta de origen agregada",
					});
				} else {
					// Si es cuenta colectiva, buscar o crear la cuenta normal
					const existingAccount =
						await ctx.db.query.AccountOnBusiness.findFirst({
							where: and(
								eq(AccountOnBusiness.dictionaryAccountId, input.fromAccountId),
								eq(
									AccountOnBusiness.businessId,
									input.fromBusinessId ?? input.toBusinessId,
								),
								eq(AccountOnBusiness.subAccount, false),
							),
							with: {
								dictionaryAccount: true,
							},
						});

					if (existingAccount) {
						fromAccount = existingAccount;
					} else {
						const insertedAccount = (
							await ctx.db
								.insert(AccountOnBusiness)
								.values({
									businessId: input.fromBusinessId ?? input.toBusinessId,
									dictionaryAccountId: input.fromAccountId,
									subAccount: false,
								})
								.returning()
						)[0];

						fromAccount = await getAccountWithDictionaryAccount(
							insertedAccount!.id,
						);
					}
				}
			} // Función actualizada para determinar el tipo de transacción según el tipo de cuenta
			function getTransactionType(
				accountType: string,
				isIncrement: boolean,
			): "DEBIT" | "CREDIT" {
				if (accountType === "ASSET" || accountType === "REVENUE") {
					// Cuentas de activo e ingreso: incremento en DEBE (DEBIT), decremento en HABER (CREDIT)
					return isIncrement ? "DEBIT" : "CREDIT";
				} else {
					// EXPENSE o LIABILITY
					// Cuentas de pasivo y gasto: incremento en HABER (CREDIT), decremento en DEBE (DEBIT)
					return isIncrement ? "CREDIT" : "DEBIT";
				}
			}

			// Función actualizada para calcular el nuevo balance según el tipo de cuenta
			function calculateNewBalance(
				accountType: string,
				oldBalance: number,
				transactionType: "DEBIT" | "CREDIT",
				amount: number,
			) {
				// Para cuentas de activo e ingreso
				if (accountType === "ASSET" || accountType === "REVENUE") {
					// DEBIT aumenta, CREDIT disminuye
					return transactionType === "DEBIT"
						? oldBalance + amount
						: oldBalance - amount;
				}
				// Para cuentas de pasivo y gasto
				else {
					// CREDIT aumenta, DEBIT disminuye
					return transactionType === "CREDIT"
						? oldBalance + amount
						: oldBalance - amount;
				}
			}

			// Si no tenemos cuenta de origen (transacción simple)
			if (!fromAccount) {
				const lastToAccountTransaction =
					await ctx.db.query.Transaction.findFirst({
						where: eq(Transaction.toAccountId, toAccount!.id),
						orderBy: [desc(Transaction.createdAt)],
					});

				// Determinar el tipo de transacción basado en el tipo de cuenta y el movimiento
				const transactionType = getTransactionType(
					toAccount!.dictionaryAccount.accountType,
					!!input.movement.increment,
				);

				// Calcular nuevo balance según el tipo de cuenta
				const currentBalance = Number.parseFloat(
					lastToAccountTransaction?.balance ?? "0",
				);
				const newBalance = calculateNewBalance(
					toAccount!.dictionaryAccount.accountType,
					currentBalance,
					transactionType,
					amount,
				);

				const group = await ctx.db
					.insert(TransactionGroup)
					.values({
						guildSlug: input.guildSlug,
						name: `Transacción del ${dayjs(combinedDate).format("DD/MM/YY HH:mm")}`,
						businessId: toAccount?.businessId,
						description: `Transacción realizada.`,
						operationType: "REGULAR",
					})
					.returning();

				if (!group[0]) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Error al crear el grupo",
					});
				}

				// Preparar los datos de la transacción
				const transactionData: any = {
					amount: amount.toString(),
					exchangeRate: input.exchangeRate?.toString(),
					about: input.about,
					balance: newBalance.toString(),
					transactionType: transactionType,
					categoryId: input.categoryId,
					toAccountId: toAccount!.id,
					memberId: member.id,
					date: combinedDate,
					requiresSignature: input.requiresSignature,
					transactionGroupId: group[0].id,
				};

				// Si hay un entityId y entityType, asignar al campo correspondiente
				if (input.entityId && input.entityType) {
					switch (input.entityType) {
						case "PERSON":
							transactionData.personId = input.entityId;
							break;
						case "MACHINERY":
							transactionData.machineryId = input.entityId;
							break;
						case "VEHICLE":
							transactionData.vehicleId = input.entityId;
							break;
						case "PROPERTY":
							transactionData.propertyId = input.entityId;
							break;
					}
				}

				const createTransaction = await ctx.db
					.insert(Transaction)
					.values(transactionData)
					.returning();

				if (!createTransaction || createTransaction.length === 0) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Error al crear transacciones.",
					});
				}

				// Actualizar el balance actual en la cuenta afectada
				await ctx.db
					.update(AccountOnBusiness)
					.set({
						currentBalance: newBalance.toString(),
						lastTransactionDate: combinedDate,
						updatedAt: new Date(),
					})
					.where(eq(AccountOnBusiness.id, toAccount!.id));

				// Si es una subcuenta, actualizar la cuenta principal
				if (toAccount!.subAccount) {
					await updateParentAccount(
						toAccount!.dictionaryAccountId,
						toAccount!.businessId,
					);
				}

				if (input.documents) {
					await ctx.db.insert(Document).values(
						input.documents.map((item) => ({
							date: item.date,
							name: item.name,
							about: item.about,
							amount: item.amount ? Number.parseFloat(item.amount) : null,
							transactionId: createTransaction[0]!.id,
						})),
					);
				}

				return createTransaction[0];
			} // Transacción entre dos cuentas
			const hasDifferentCurrencies =
				fromAccount.dictionaryAccount.currency !==
				toAccount!.dictionaryAccount.currency;

			// Si las monedas son diferentes y no hay tipo de cambio, lanzar error
			if (hasDifferentCurrencies && !input.exchangeRate) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"Se requiere tipo de cambio para transacciones entre diferentes monedas",
				});
			}



			const exchangeRate = Number(input.exchangeRate) || 1;

			// Calcular los montos según la moneda
			const fromAmount = amount;
			let toAmount;

			if (hasDifferentCurrencies) {
				const fromCurrency = fromAccount.dictionaryAccount.currency;
				const toCurrency = toAccount!.dictionaryAccount.currency;

				// Usar la función auxiliar para la conversión
				toAmount = convertAmount(
					fromCurrency,
					toCurrency,
					fromAmount,
					exchangeRate,
					input.fromCurrency,
				);
			} else {
				// Si las monedas son iguales, el monto es el mismo
				toAmount = fromAmount;
			}

			const lastToAccountTransaction = await ctx.db.query.Transaction.findFirst(
				{
					where: eq(Transaction.toAccountId, toAccount!.id),
					orderBy: [desc(Transaction.createdAt)],
				},
			);

			const lastFromAccountTransaction =
				await ctx.db.query.Transaction.findFirst({
					where: eq(Transaction.toAccountId, fromAccount.id),
					orderBy: [desc(Transaction.createdAt)],
				});

			// Determinar si estamos realizando un incremento o decremento desde la cuenta origen
			const isIncrement = !!input.movement.increment;

			// Para cada tipo de cuenta, determinamos el tipo de transacción adecuado según la dirección del flujo
			let fromAccountTxType: "DEBIT" | "CREDIT";
			let toAccountTxType: "DEBIT" | "CREDIT";

			// Si es un incremento: La cuenta origen AUMENTA, la cuenta destino DISMINUYE
			if (isIncrement) {
				// Para la cuenta origen (fromAccount) - debe AUMENTAR
				fromAccountTxType = getTransactionType(
					fromAccount.dictionaryAccount.accountType,
					true,
				);
				// Para la cuenta destino (toAccount) - debe DISMINUIR
				toAccountTxType = getTransactionType(
					toAccount!.dictionaryAccount.accountType,
					false,
				);
			}
			// Si es un decremento: La cuenta origen DISMINUYE, la cuenta destino AUMENTA
			else {
				// Para la cuenta origen (fromAccount) - debe DISMINUIR
				fromAccountTxType = getTransactionType(
					fromAccount.dictionaryAccount.accountType,
					false,
				);
				// Para la cuenta destino (toAccount) - debe AUMENTAR
				toAccountTxType = getTransactionType(
					toAccount!.dictionaryAccount.accountType,
					true,
				);
			}

			// Calcular los nuevos balances según el tipo de cuenta
			const currentFromBalance = Number.parseFloat(
				lastFromAccountTransaction?.balance ?? "0",
			);
			const newFromBalance = calculateNewBalance(
				fromAccount.dictionaryAccount.accountType,
				currentFromBalance,
				fromAccountTxType,
				fromAmount,
			);

			const currentToBalance = Number.parseFloat(
				lastToAccountTransaction?.balance ?? "0",
			);

			const newToBalance = calculateNewBalance(
				toAccount!.dictionaryAccount.accountType,
				currentToBalance,
				toAccountTxType,
				toAmount,
			);

			const group = await ctx.db
				.insert(TransactionGroup)
				.values({
					guildSlug: input.guildSlug,
					name: `Transacción del ${dayjs(combinedDate).format("DD/MM/YY HH:mm")}`,
					businessId: toAccount?.businessId,
					description: `Transacción realizada.`,
					operationType: hasDifferentCurrencies
						? "CURRENCY_EXCHANGE"
						: "REGULAR",
				})
				.returning();

			if (!group[0]) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Error al crear el grupo",
				});
			}

			// Preparar los datos de las transacciones
			const fromTransactionData: any = {
				date: combinedDate,
				amount: fromAmount.toString(),
				balance: newFromBalance.toString(),
				transactionType: fromAccountTxType,
				exchangeRate: hasDifferentCurrencies
					? input.exchangeRate?.toString()
					: undefined,
				toAccountId: fromAccount.id,
				memberId: member.id,
				requiresSignature: input.requiresSignature,
				transactionGroupId: group[0].id,
			};

			const toTransactionData: any = {
				date: combinedDate,
				exchangeRate: hasDifferentCurrencies
					? input.exchangeRate?.toString()
					: undefined,
				amount: toAmount.toString(),
				balance: newToBalance.toString(),
				about: input.about,
				transactionType: toAccountTxType,
				categoryId: input.categoryId,
				toAccountId: toAccount!.id,
				fromAccountId: fromAccount.id,
				memberId: member.id,
				requiresSignature: input.requiresSignature,
				transactionGroupId: group[0].id,
			};

			// Si hay un entityId y entityType, asignar al campo correspondiente en ambas transacciones
			if (input.entityId && input.entityType) {
				switch (input.entityType) {
					case "PERSON":
						fromTransactionData.personId = input.entityId;
						toTransactionData.personId = input.entityId;
						break;
					case "MACHINERY":
						fromTransactionData.machineryId = input.entityId;
						toTransactionData.machineryId = input.entityId;
						break;
					case "VEHICLE":
						fromTransactionData.vehicleId = input.entityId;
						toTransactionData.vehicleId = input.entityId;
						break;
					case "PROPERTY":
						fromTransactionData.propertyId = input.entityId;
						toTransactionData.propertyId = input.entityId;
						break;
				}
			}



			const createTransaction = await ctx.db
				.insert(Transaction)
				.values([fromTransactionData, toTransactionData])
				.returning();

			if (!createTransaction || createTransaction.length === 0) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Error al crear transacciones.",
				});
			}

			// Actualizar balances en las cuentas
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
				.where(eq(AccountOnBusiness.id, toAccount!.id));

			// Si alguna es subcuenta, actualizar las cuentas principales
			if (fromAccount.subAccount) {
				await updateParentAccount(
					fromAccount.dictionaryAccountId,
					fromAccount.businessId,
				);
			}

			if (toAccount!.subAccount) {
				await updateParentAccount(
					toAccount!.dictionaryAccountId,
					toAccount!.businessId,
				);
			}

			if (input.documents) {
				await ctx.db.insert(Document).values(
					input.documents.map((item) => ({
						date: item.date,
						name: item.name,
						about: item.about,
						amount: item.amount ? Number.parseFloat(item.amount) : null,
						transactionId: createTransaction[1]!.id,
					})),
				);
			}

			return createTransaction;
		}),
	modify: protectedProcedure
		.input(modifyTransactionSchema)
		.mutation(async ({ ctx, input }) => {
			// Verificar permisos
			const member = await ctx.db.query.Member.findFirst({
				where: and(
					eq(Member.userId, ctx.user.id),
					eq(Member.guildSlug, input.guildSlug),
				),
			});

			if (!member) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "No tenés permiso para modificar esta transacción",
				});
			}

			// Si solo es actualización de descripción
			if (input.about !== undefined) {
				await ctx.db
					.update(Transaction)
					.set({ about: input.about })
					.where(eq(Transaction.id, input.transactionId));

				return {
					message: "Descripción de la transacción actualizada exitosamente",
				};
			}

			// Para eliminación, identificar y eliminar
			const transaction = await ctx.db.query.Transaction.findFirst({
				where: eq(Transaction.id, input.transactionId),
				with: {
					transactionGroup: {
						with: {
							cablesOnTransactionGroup: {
								with: {
									cable: true,
								},
							},
							checksOnTransactionGroup: {
								with: {
									check: true,
								},
							},
							creditsOnTransactionGroup: {
								with: {
									credit: true,
								},
							},
							loansOnTransactionGroup: {
								with: {
									loan: true,
								},
							},
						},
					},
					documents: true,
				},
			});

			if (!transaction) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Transacción inexistente",
				});
			}

			// Eliminar en una transacción de base de datos para garantizar consistencia
			return await ctx.db.transaction(async (tx) => {
				// Primero obtener todas las cuentas afectadas para actualizarlas después
				let accountIds: string[] = [];

				// Si hay un grupo de transacciones
				if (transaction.transactionGroupId) {
					const transactionGroupId = transaction.transactionGroupId;

					// Obtener transacciones afectadas por el grupo
					const affectedTransactions = await tx.query.Transaction.findMany({
						where: eq(Transaction.transactionGroupId, transactionGroupId),
						columns: {
							id: true,
							toAccountId: true,
							fromAccountId: true,
						},
					});

					// Recolectar todas las cuentas afectadas
					accountIds = [
						...new Set([
							...affectedTransactions.map((t) => t.toAccountId),
							...affectedTransactions
								.map((t) => t.fromAccountId)
								.filter((id): id is string => id !== null),
						]),
					];

					// Primero eliminar documentos asociados a cada transacción
					for (const t of affectedTransactions) {
						await tx.delete(Document).where(eq(Document.transactionId, t.id));
					}

					// Eliminar relaciones del grupo con otras entidades
					if (transaction.transactionGroup?.checksOnTransactionGroup) {
						for (const check of transaction.transactionGroup
							?.checksOnTransactionGroup) {
							if (check.check.status != "SOLD") {
								await tx.delete(Check).where(eq(Check.id, check.checkId));
							} else {
								await tx
									.update(Check)
									.set({ status: "PURCHASED" })
									.where(eq(Check.id, check.checkId));
							}
						}
					}

					await tx
						.delete(CheckOnTransactionGroup)
						.where(
							eq(
								CheckOnTransactionGroup.transactionGroupId,
								transactionGroupId,
							),
						);

					if (transaction.transactionGroup?.loansOnTransactionGroup) {
						for (const loan of transaction.transactionGroup
							?.loansOnTransactionGroup) {
							await tx.delete(Loan).where(eq(Loan.id, loan.loanId));
						}
					}

					await tx
						.delete(LoanOnTransactionGroup)
						.where(
							eq(LoanOnTransactionGroup.transactionGroupId, transactionGroupId),
						);

					if (transaction.transactionGroup?.creditsOnTransactionGroup) {
						for (const credit of transaction.transactionGroup
							?.creditsOnTransactionGroup) {
							await tx.delete(Credit).where(eq(Credit.id, credit.creditId));
						}
					}

					await tx
						.delete(CreditOnTransactionGroup)
						.where(
							eq(
								CreditOnTransactionGroup.transactionGroupId,
								transactionGroupId,
							),
						);

					if (transaction.transactionGroup?.cablesOnTransactionGroup) {
						for (const cable of transaction.transactionGroup
							?.cablesOnTransactionGroup) {
							await tx.delete(Cable).where(eq(Cable.id, cable.cableId));
						}
					}

					await tx
						.delete(CableOnTransactionGroup)
						.where(
							eq(
								CableOnTransactionGroup.transactionGroupId,
								transactionGroupId,
							),
						);

					// Eliminar todas las transacciones del grupo
					await tx
						.delete(Transaction)
						.where(eq(Transaction.transactionGroupId, transactionGroupId));

					// Finalmente eliminar el grupo
					await tx
						.delete(TransactionGroup)
						.where(eq(TransactionGroup.id, transactionGroupId));
				} else {
					// Para transacciones individuales
					// Recolectar cuentas afectadas
					accountIds = [
						transaction.toAccountId,
						transaction.fromAccountId,
					].filter(Boolean) as string[];

					// Eliminar documentos asociados primero
					await tx
						.delete(Document)
						.where(eq(Document.transactionId, transaction.id));

					// Eliminar la transacción
					await tx
						.delete(Transaction)
						.where(eq(Transaction.id, transaction.id));
				}

				// Actualizar balances para cada cuenta afectada
				for (const accountId of accountIds) {
					// await tx.execute(sql`SELECT update_account_balance(${accountId}::uuid)`);
					await tx.execute(
						sql`SELECT fix_single_account_balance(${accountId});`,
					);
				}

				return { message: "Transacción(es) eliminada(s) correctamente" };
			});
		}),
	all: protectedProcedure.query(async ({ ctx }) => {
		const data = await ctx.db.query.Transaction.findMany({
			orderBy: [desc(Transaction.createdAt)],
			where: or(eq(Member.userId, ctx.user.id), eq(Member.userId, ctx.user.id)),
			with: {
				category: true,
				fromAccount: {
					with: {
						business: true,
					},
				},
				toAccount: {
					with: {
						business: true,
					},
				},
				person: true,
				documents: true,
				member: true,
				// transactionGroup: {
				//     with: {
				//         business: true,
				//         transactions: {
				//             with: {
				//                 toAccount: {
				//                     with: {
				//                         business: true,
				//                         dictionaryAccount: true
				//                     }
				//                 },
				//                 fromAccount: {
				//                     with: {
				//                         business: true,
				//                         dictionaryAccount: true
				//                     }
				//                 }
				//             }
				//         },
				//         guild: true
				//     }
				// }
				transactionGroup: true,
			},
		});

		return data;
	}),
	byGuildSlugWithCursor: protectedProcedure
		.input(TransactionCursorInputSchema)
		.query(async ({ ctx, input }) => {
			const { guildSlug, limit, cursor } = input;
			console.log(
				`[TRPC BACKEND byGuildSlugWithCursor] Input: guildSlug=${guildSlug}, limit=${limit}, cursor:`,
				cursor,
			);

			const businessesInGuild = await ctx.db.query.Business.findMany({
				where: eq(Business.guildSlug, guildSlug),
				columns: { id: true },
				with: {
					accountsOnBusinesses: {
						// Esta relación debe existir en tu schema Drizzle
						columns: { id: true }, // Asumiendo que AccountOnBusiness tiene 'id'
					},
				},
			});

			const relevantAccountIds = businessesInGuild.flatMap(
				(business) =>
					business.accountsOnBusinesses?.map((account) => account.id) ?? [],
			);

			if (relevantAccountIds.length === 0) {
				console.log(
					"[TRPC BACKEND byGuildSlugWithCursor] No relevant accounts, returning empty.",
				);
				return { items: [], nextCursor: null };
			}
			// Opcional: loguear solo una parte de los IDs si la lista es muy larga
			// console.log("[TRPC BACKEND byGuildSlugWithCursor] Relevant Account IDs count:", relevantAccountIds.length);

			const cursorCondition = cursor
				? or(
					lt(Transaction.date, new Date(cursor.createdAt)),
					and(
						eq(Transaction.date, new Date(cursor.createdAt)),
						lt(Transaction.id, cursor.id),
					),
				)
				: undefined;

			console.log(
				"[TRPC BACKEND byGuildSlugWithCursor] Effective Cursor for DB Query (logic based on input cursor):",
				cursor
					? {
						dateForLessThan: new Date(cursor.createdAt).toISOString(),
						idForLessThan: cursor.id,
						dateForEqualTo: new Date(cursor.createdAt).toISOString(),
					}
					: "no cursor (fetching first page)",
			);

			// 1. Pedir limit + 1 ítems para determinar si hay una página siguiente
			const itemsFetchedFromDB = await ctx.db.query.Transaction.findMany({
				where: and(
					or(
						inArray(Transaction.toAccountId, relevantAccountIds),
						inArray(Transaction.fromAccountId, relevantAccountIds),
					),
					cursorCondition,
				),
				with: {
					category: true,
					documents: true,
					member: { with: { user: true } },
					person: true,
					fromAccount: { with: { dictionaryAccount: true, business: true } },
					toAccount: { with: { dictionaryAccount: true, business: true } },
					transactionGroup: true,
				},
				orderBy: [desc(Transaction.date), desc(Transaction.id)],
				limit: limit + 1,
			});
			console.log(
				`[TRPC BACKEND byGuildSlugWithCursor] Fetched ${itemsFetchedFromDB.length} items from DB (limit was ${limit}, requested ${limit + 1}).`,
			);

			let nextCursorResult: z.TypeOf<
				typeof TransactionCursorInputSchema
			>["cursor"] = undefined;
			let itemsToReturnClient: typeof itemsFetchedFromDB;

			if (itemsFetchedFromDB.length > limit) {
				// Hay más ítems de los que caben en esta página.
				// El cursor para la *siguiente* llamada se basará en el último ítem de la página *actual que se va a mostrar*.
				const lastItemOfCurrentPageToDisplay = itemsFetchedFromDB[limit - 1];

				if (lastItemOfCurrentPageToDisplay) {
					// Debería existir si itemsFetchedFromDB.length > limit
					nextCursorResult = {
						createdAt: lastItemOfCurrentPageToDisplay.date.toISOString(),
						id: lastItemOfCurrentPageToDisplay.id,
					};
					console.log(
						"[TRPC BACKEND byGuildSlugWithCursor] More items exist beyond this page. Next cursor (based on LAST item of THIS page to be displayed):",
						nextCursorResult,
					);
				} else {
					// Este caso es muy improbable si itemsFetchedFromDB.length > limit y limit >= 1
					console.warn(
						"[TRPC BACKEND byGuildSlugWithCursor] Inconsistency: Fetched more than limit, but couldn't get lastItemOfCurrentPageToDisplay.",
					);
				}
				// Devolvemos solo los primeros 'limit' ítems al cliente.
				itemsToReturnClient = itemsFetchedFromDB.slice(0, limit);
			} else {
				// No hay más ítems que los que caben en esta página (o incluso menos).
				// Estos son los últimos ítems. No hay nextCursor.
				itemsToReturnClient = itemsFetchedFromDB;
				nextCursorResult = undefined;
				console.log(
					"[TRPC BACKEND byGuildSlugWithCursor] No extra item found (or fewer than limit), this is the last page. NextCursor is null.",
				);
			}

			console.log(
				`[TRPC BACKEND byGuildSlugWithCursor] Returning ${itemsToReturnClient.length} items to client.`,
			);
			return {
				items: itemsToReturnClient,
				nextCursor: nextCursorResult,
			};
		}),

	countByGuildSlug: protectedProcedure
		.input(GuildSlugSchema)
		.query(async ({ ctx, input }) => {
			const { guildSlug } = input;
			const businessesInGuild = await ctx.db.query.Business.findMany({
				where: eq(Business.guildSlug, guildSlug),
				columns: { id: true },
				with: { accountsOnBusinesses: { columns: { id: true } } }, // Asumiendo que esta relación es correcta
			});
			const relevantAccountIds = businessesInGuild.flatMap(
				(b) => b.accountsOnBusinesses?.map((a) => a.id) ?? [],
			);
			if (relevantAccountIds.length === 0) {
				console.log(
					`[TRPC BACKEND countByGuildSlug] Guild: ${guildSlug}, No relevant accounts, Total: 0`,
				);
				return { total: 0 };
			}
			const result = await ctx.db
				.select({ total: count() })
				.from(Transaction)
				.where(
					and(
						or(
							inArray(Transaction.toAccountId, relevantAccountIds),
							inArray(Transaction.fromAccountId, relevantAccountIds),
						),
					),
				);
			const totalCount = result[0]?.total ? Number(result[0].total) : 0;
			console.log(
				`[TRPC BACKEND countByGuildSlug] Guild: ${guildSlug}, Total calculated: ${totalCount}`,
			);
			return { total: totalCount };
		}),
	byGuildSlug: protectedProcedure
		.input(GuildSlugSchema)
		.query(async ({ ctx, input }) => {
			const businesses = await ctx.db.query.Business.findMany({
				where: eq(Business.guildSlug, input.guildSlug),
				with: {
					accountsOnBusinesses: true,
				},
			});

			const ids = businesses.flatMap((business) => {
				return business.accountsOnBusinesses.map((account) => {
					return account.id;
				});
			});

			const transactions = await ctx.db.query.Transaction.findMany({
				where: or(
					inArray(Transaction.toAccountId, ids),
					inArray(Transaction.fromAccountId, ids),
				),
				with: {
					category: true,
					documents: true,
					member: {
						with: {
							user: true,
						},
					},
					person: true,
					fromAccount: {
						with: {
							dictionaryAccount: true,
							business: true,
						},
					},
					toAccount: {
						with: {
							dictionaryAccount: true,
							business: true,
						},
					},
					// transactionGroup: {
					//     with: {
					//         business: true,
					//         transactions: {
					//             with: {
					//                 toAccount: {
					//                     with: {
					//                         business: true,
					//                         dictionaryAccount: true
					//                     }
					//                 },
					//                 fromAccount: {
					//                     with: {
					//                         business: true,
					//                         dictionaryAccount: true
					//                     }
					//                 },
					//                 category: true,
					//                 person: true,
					//                 member: true
					//             }
					//         },
					//         guild: true
					//     }
					// }
					transactionGroup: true,
				},
				orderBy: [desc(Transaction.date)],
			});

			return transactions;
		}),
	byId: protectedProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ ctx, input }) => {
			const data = await ctx.db.query.Transaction.findFirst({
				where: eq(Transaction.id, input.id),
				with: {
					category: true,
					fromAccount: true,
					toAccount: true,
					member: true,
					transactionGroup: {
						with: {
							business: true,
							transactions: {
								with: {
									toAccount: {
										with: {
											business: true,
											dictionaryAccount: true,
										},
									},
									fromAccount: {
										with: {
											business: true,
											dictionaryAccount: true,
										},
									},
									person: true,
									member: {
										with: {
											user: true,
										},
									},
								},
							},
							guild: true,
						},
					},
				},
			});

			return data;
		}),
	byBusinessSlug: protectedProcedure
		.input(
			z.object({
				guildSlug: z.string(),
				businessSlug: z.string(),
			}),
		)
		.query(async ({ ctx, input }) => {
			// Buscar el negocio con los slugs proporcionados
			const business = await ctx.db.query.Business.findFirst({
				where: and(
					eq(Business.guildSlug, input.guildSlug),
					eq(Business.businessSlug, input.businessSlug),
					eq(Business.discharged, true),
				),
				columns: {
					id: true,
				},
			});

			if (!business) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Empresa no encontrada o no existe",
				});
			}

			// Buscar el miembro actual
			const member = await ctx.db.query.Member.findFirst({
				where: and(
					eq(Member.userId, ctx.user.id),
					eq(Member.guildSlug, input.guildSlug),
					eq(Member.discharged, true),
				),
				columns: {
					id: true,
					role: true,
				},
			});

			if (!member) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "No tienes permiso para acceder a esta empresa",
				});
			}

			// OWNER y MANAGER tienen acceso completo
			const hasFullAccess =
				member.role === "OWNER" || member.role === "MANAGER";

			// Si es MEMBER, verificar qué cuentas puede ver
			let accessibleAccountIds: string[] = [];

			if (!hasFullAccess) {
				// Verificar si tiene acceso a la empresa
				const memberOnBusiness = await ctx.db.query.MemberOnBusiness.findFirst({
					where: and(
						eq(MemberOnBusiness.memberId, member.id),
						eq(MemberOnBusiness.businessId, business.id),
					),
					columns: {
						id: true,
						hasFullAccess: true,
					},
				});

				if (!memberOnBusiness) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "No tienes permiso para acceder a esta empresa",
					});
				}

				// Si tiene acceso completo a la empresa, puede ver todas las cuentas
				if (memberOnBusiness.hasFullAccess) {
					const allAccounts = await ctx.db.query.AccountOnBusiness.findMany({
						where: and(
							eq(AccountOnBusiness.businessId, business.id),
							eq(AccountOnBusiness.discharged, true),
						),
						columns: {
							id: true,
						},
					});
					accessibleAccountIds = allAccounts.map((acc) => acc.id);
				} else {
					// Si no tiene acceso completo, solo puede ver las cuentas asignadas
					const memberAccounts =
						await ctx.db.query.MemberOnAccountOnBusiness.findMany({
							where: eq(
								MemberOnAccountOnBusiness.memberOnBusinessId,
								memberOnBusiness.id,
							),
							columns: {
								accountOnBusinessId: true,
								canRead: true,
							},
						});

					accessibleAccountIds = memberAccounts
						.filter((ma) => ma.canRead)
						.map((ma) => ma.accountOnBusinessId);
				}
			} else {
				// Para OWNER y MANAGER, obtener todas las cuentas de la empresa
				const allAccounts = await ctx.db.query.AccountOnBusiness.findMany({
					where: and(
						eq(AccountOnBusiness.businessId, business.id),
						eq(AccountOnBusiness.discharged, true),
					),
					columns: {
						id: true,
					},
				});
				accessibleAccountIds = allAccounts.map((acc) => acc.id);
			}

			// Si no hay cuentas accesibles, devolver array vacío
			if (accessibleAccountIds.length === 0) {
				return [];
			}

			// Buscar las transacciones de las cuentas accesibles
			const transactions = await ctx.db.query.Transaction.findMany({
				where: or(
					inArray(Transaction.toAccountId, accessibleAccountIds),
					inArray(Transaction.fromAccountId, accessibleAccountIds),
				),
				with: {
					category: true,
					documents: true,
					member: {
						with: {
							user: true,
						},
					},
					person: true,
					fromAccount: {
						with: {
							dictionaryAccount: true,
							business: true,
						},
					},
					toAccount: {
						with: {
							dictionaryAccount: true,
							business: true,
						},
					},
					transactionGroup: true,
				},
				orderBy: [desc(Transaction.date)],
			});

			return transactions;
		}),
	byBusinessSlugWithCursor: protectedProcedure
		.input(TransactionByBusinessCursorInputSchema)
		.query(async ({ ctx, input }) => {
			const { guildSlug, businessSlug, limit, cursor } = input;
			const userId = ctx.user.id;

			console.log(
				`[TRPC Transaction.byBusinessSlugWithCursor] Input: guildSlug=${guildSlug}, businessSlug=${businessSlug}, limit=${limit}, userId=${userId}, cursor:`,
				cursor,
			);

			// Inicio de la lógica de permisos (basada en tu byBusinessSlug original)
			const business = await ctx.db.query.Business.findFirst({
				where: and(
					eq(Business.guildSlug, guildSlug),
					eq(Business.businessSlug, businessSlug),
					eq(Business.discharged, true), // SIGUIENDO TU LÓGICA: true = activo
				),
				columns: { id: true },
			});

			if (!business) {
				console.warn(
					`[TRPC Transaction.byBusinessSlugWithCursor] Business not found or not active for guildSlug: ${guildSlug}, businessSlug: ${businessSlug}`,
				);
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Empresa no encontrada o no activa.",
				});
			}
			const businessId = business.id;

			const memberCtx = await ctx.db.query.Member.findFirst({
				where: and(
					eq(Member.userId, userId),
					eq(Member.guildSlug, guildSlug),
					eq(Member.discharged, true), // SIGUIENDO TU LÓGICA: true = activo
					// eq(Member.status, "SUCCESS"), // Tu `byBusinessSlug` no tenía esto, pero considera añadirlo si un miembro "PENDING" no debería tener acceso.
				),
				columns: { id: true, role: true },
			});

			if (!memberCtx) {
				console.warn(
					`[TRPC Transaction.byBusinessSlugWithCursor] Member not found or not active for userId: ${userId}, guildSlug: ${guildSlug}`,
				);
				throw new TRPCError({
					code: "FORBIDDEN",
					message:
						"No tienes permiso para acceder a esta empresa (miembro no encontrado o inactivo).",
				});
			}
			const memberId = memberCtx.id;
			const memberRole = memberCtx.role;

			let accessibleAccountIds: string[] = [];
			const hasFullAccessByRole =
				memberRole === "OWNER" || memberRole === "MANAGER";

			if (hasFullAccessByRole) {
				const allAccounts = await ctx.db.query.AccountOnBusiness.findMany({
					where: and(
						eq(AccountOnBusiness.businessId, businessId),
						eq(AccountOnBusiness.discharged, true), // SIGUIENDO TU LÓGICA: true = activo
					),
					columns: { id: true },
				});
				accessibleAccountIds = allAccounts.map((acc) => acc.id);
				console.log(
					`[TRPC Transaction.byBusinessSlugWithCursor] User ${userId} (Role: ${memberRole}) has full access by role. Accessible accounts: ${accessibleAccountIds.length}`,
				);
			} else {
				// Miembro no es OWNER/MANAGER, verificar permisos específicos en MemberOnBusiness
				const memberOnBusiness = await ctx.db.query.MemberOnBusiness.findFirst({
					where: and(
						eq(MemberOnBusiness.memberId, memberId),
						eq(MemberOnBusiness.businessId, businessId),
					),
					columns: { id: true, hasFullAccess: true }, // Solo necesitamos hasFullAccess de aquí según tu lógica original
				});

				if (!memberOnBusiness) {
					console.warn(
						`[TRPC Transaction.byBusinessSlugWithCursor] User ${userId} (Role: ${memberRole}) has no MemberOnBusiness record for business ${businessId}.`,
					);
					throw new TRPCError({
						code: "FORBIDDEN",
						message:
							"No tienes permiso para acceder a esta empresa (sin asignación a la empresa).",
					});
				}

				if (memberOnBusiness.hasFullAccess) {
					const allAccounts = await ctx.db.query.AccountOnBusiness.findMany({
						where: and(
							eq(AccountOnBusiness.businessId, businessId),
							eq(AccountOnBusiness.discharged, true), // SIGUIENDO TU LÓGICA: true = activo
						),
						columns: { id: true },
					});
					accessibleAccountIds = allAccounts.map((acc) => acc.id);
					console.log(
						`[TRPC Transaction.byBusinessSlugWithCursor] User ${userId} (Role: ${memberRole}) has MemberOnBusiness.hasFullAccess=true. Accessible accounts: ${accessibleAccountIds.length}`,
					);
				} else {
					// No tiene fullAccess a nivel de MemberOnBusiness, verificar MemberOnAccountOnBusiness
					const memberAccounts =
						await ctx.db.query.MemberOnAccountOnBusiness.findMany({
							where: and(
								eq(
									MemberOnAccountOnBusiness.memberOnBusinessId,
									memberOnBusiness.id,
								),
								// No filtramos por canRead aquí en la query, sino después, como en tu lógica original
							),
							columns: { accountOnBusinessId: true, canRead: true }, // Traemos canRead para filtrar en la app
						});

					accessibleAccountIds = memberAccounts
						.filter((ma) => ma.canRead) // Filtro canRead aquí, como en tu código original
						.map((ma) => ma.accountOnBusinessId);
					console.log(
						`[TRPC Transaction.byBusinessSlugWithCursor] User ${userId} (Role: ${memberRole}) has specific account permissions. Accessible accounts from MemberOnAccountOnBusiness (canRead=true): ${accessibleAccountIds.length}`,
					);
				}
			}
			// Fin de la lógica de permisos

			if (accessibleAccountIds.length === 0) {
				console.log(
					`[TRPC Transaction.byBusinessSlugWithCursor] No accessible accounts determined for user ${userId} in business ${businessSlug}. Returning empty.`,
				);
				return { items: [], nextCursor: undefined }; // Devolver vacío si no hay cuentas accesibles, como en tu original.
			}
			console.log(
				`[TRPC Transaction.byBusinessSlugWithCursor] Final accessible account IDs (${accessibleAccountIds.length}) for user ${userId}. Sample:`,
				accessibleAccountIds.slice(0, 5),
			);

			// Lógica de paginación
			const cursorCondition = cursor
				? or(
					lt(Transaction.date, new Date(cursor.date)),
					and(
						eq(Transaction.date, new Date(cursor.date)),
						lt(Transaction.id, cursor.id),
					),
				)
				: undefined;

			console.log(
				`[TRPC Transaction.byBusinessSlugWithCursor] Effective Cursor for DB Query:`,
				cursor
					? {
						dateForLessThan: new Date(cursor.date).toISOString(),
						idForLessThan: cursor.id,
						dateForEqualTo: new Date(cursor.date).toISOString(),
					}
					: "no cursor (fetching first page)",
			);

			const itemsFetchedFromDB = await ctx.db.query.Transaction.findMany({
				where: and(
					or(
						inArray(Transaction.toAccountId, accessibleAccountIds),
						inArray(Transaction.fromAccountId, accessibleAccountIds),
					),
					// eq(Transaction.discharged, true), // SIGUIENDO TU LÓGICA: true = activo. Tu byBusinessSlug no filtraba discharged en Transaction. Añádelo si es necesario.
					cursorCondition,
				),
				with: {
					// Mismos with que tu byBusinessSlug original
					category: true,
					documents: true,
					member: { with: { user: true } },
					person: true,
					fromAccount: { with: { dictionaryAccount: true, business: true } },
					toAccount: { with: { dictionaryAccount: true, business: true } },
					transactionGroup: true,
				},
				orderBy: [desc(Transaction.date), desc(Transaction.id)], // Ordenación por cursor
				limit: limit + 1,
			});
			console.log(
				`[TRPC Transaction.byBusinessSlugWithCursor] Fetched ${itemsFetchedFromDB.length} items from DB (limit was ${limit}, requested ${limit + 1}).`,
			);

			let nextCursorResult:
				| z.TypeOf<typeof TransactionByBusinessCursorInputSchema>["cursor"]
				| undefined = undefined;
			let itemsToReturnClient: typeof itemsFetchedFromDB;

			if (itemsFetchedFromDB.length > limit) {
				const lastItemOfCurrentPageToDisplay = itemsFetchedFromDB[limit - 1];
				if (lastItemOfCurrentPageToDisplay) {
					nextCursorResult = {
						date: lastItemOfCurrentPageToDisplay.date.toISOString(),
						id: lastItemOfCurrentPageToDisplay.id,
					};
				}
				itemsToReturnClient = itemsFetchedFromDB.slice(0, limit);
			} else {
				itemsToReturnClient = itemsFetchedFromDB;
				// nextCursorResult ya es undefined
			}

			console.log(
				`[TRPC Transaction.byBusinessSlugWithCursor] Returning ${itemsToReturnClient.length} items to client.`,
			);
			return {
				items: itemsToReturnClient,
				nextCursor: nextCursorResult,
			};
		}),

	/**
	 * PROCEDURE: countByBusinessSlug
	 * Cuenta el total de transacciones para un Business específico, aplicando permisos.
	 * Mantiene la lógica de permisos original del procedure byBusinessSlug.
	 */
	countByBusinessSlug: protectedProcedure
		.input(BusinessSlugSchema)
		.query(async ({ ctx, input }) => {
			const { guildSlug, businessSlug } = input;
			const userId = ctx.user.id;
			console.log(
				`[TRPC Transaction.countByBusinessSlug] Input: guildSlug=${guildSlug}, businessSlug=${businessSlug}, userId=${userId}`,
			);

			// Inicio de la lógica de permisos (basada en tu byBusinessSlug original)
			const business = await ctx.db.query.Business.findFirst({
				where: and(
					eq(Business.guildSlug, guildSlug),
					eq(Business.businessSlug, businessSlug),
					eq(Business.discharged, true), // SIGUIENDO TU LÓGICA: true = activo
				),
				columns: { id: true },
			});

			if (!business) {
				return { total: 0 }; // Como en tu byBusinessSlug, no hay error, solo no hay empresa.
			}
			const businessId = business.id;

			const memberCtx = await ctx.db.query.Member.findFirst({
				where: and(
					eq(Member.userId, userId),
					eq(Member.guildSlug, guildSlug),
					eq(Member.discharged, true), // SIGUIENDO TU LÓGICA: true = activo
				),
				columns: { id: true, role: true },
			});

			if (!memberCtx) {
				return { total: 0 }; // Sin miembro, sin acceso, total 0
			}
			const memberId = memberCtx.id;
			const memberRole = memberCtx.role;

			let accessibleAccountIds: string[] = [];
			const hasFullAccessByRole =
				memberRole === "OWNER" || memberRole === "MANAGER";

			if (hasFullAccessByRole) {
				const allAccounts = await ctx.db.query.AccountOnBusiness.findMany({
					where: and(
						eq(AccountOnBusiness.businessId, businessId),
						eq(AccountOnBusiness.discharged, true), // SIGUIENDO TU LÓGICA: true = activo
					),
					columns: { id: true },
				});
				accessibleAccountIds = allAccounts.map((acc) => acc.id);
			} else {
				const memberOnBusiness = await ctx.db.query.MemberOnBusiness.findFirst({
					where: and(
						eq(MemberOnBusiness.memberId, memberId),
						eq(MemberOnBusiness.businessId, businessId),
					),
					columns: { id: true, hasFullAccess: true },
				});

				if (!memberOnBusiness) {
					return { total: 0 }; // Sin asignación a empresa, total 0
				}

				if (memberOnBusiness.hasFullAccess) {
					const allAccounts = await ctx.db.query.AccountOnBusiness.findMany({
						where: and(
							eq(AccountOnBusiness.businessId, businessId),
							eq(AccountOnBusiness.discharged, true), // SIGUIENDO TU LÓGICA: true = activo
						),
						columns: { id: true },
					});
					accessibleAccountIds = allAccounts.map((acc) => acc.id);
				} else {
					const memberAccounts =
						await ctx.db.query.MemberOnAccountOnBusiness.findMany({
							where: eq(
								MemberOnAccountOnBusiness.memberOnBusinessId,
								memberOnBusiness.id,
							),
							columns: { accountOnBusinessId: true, canRead: true },
						});
					accessibleAccountIds = memberAccounts
						.filter((ma) => ma.canRead)
						.map((ma) => ma.accountOnBusinessId);
				}
			}
			// Fin de la lógica de permisos

			if (accessibleAccountIds.length === 0) {
				console.log(
					`[TRPC Transaction.countByBusinessSlug] No accessible accounts determined for user ${userId} in business ${businessSlug}. Total: 0.`,
				);
				return { total: 0 };
			}
			console.log(
				`[TRPC Transaction.countByBusinessSlug] Final accessible account IDs (${accessibleAccountIds.length}) for user ${userId} to count transactions.`,
			);

			// Contar transacciones
			const result = await ctx.db
				.select({ total: count() })
				.from(Transaction)
				.where(
					and(
						// Tu byBusinessSlug no filtraba Transaction.discharged, considera si deberías.
						or(
							inArray(Transaction.toAccountId, accessibleAccountIds),
							inArray(Transaction.fromAccountId, accessibleAccountIds),
						),
						// Opcional: eq(Transaction.discharged, true) // SIGUIENDO TU LÓGICA: true = activo
					),
				);

			const totalCount = result[0]?.total ? Number(result[0].total) : 0;
			console.log(
				`[TRPC Transaction.countByBusinessSlug] Guild: ${guildSlug}, Business: ${businessSlug}, User: ${userId}. Total transactions for accessible accounts: ${totalCount}`,
			);
			return { total: totalCount };
		}),
	export: protectedProcedure
		.input(
			z.object({
				guildSlug: z.string(),
				dateFrom: z.date(),
				dateTo: z.date(),
				businessIds: z.array(z.string()).optional(),
				peopleIds: z.array(z.string()).optional(),
				categoriesIds: z.array(z.string()).optional(),
				dictionaryAccountsIds: z.array(z.string()).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const businesses = await ctx.db.query.Business.findMany({
				where: eq(Business.guildSlug, input.guildSlug),
			});

			const accountIds = await ctx.db.query.AccountOnBusiness.findMany({
				where: input.businessIds?.length
					? inArray(AccountOnBusiness.businessId, input.businessIds)
					: inArray(
						AccountOnBusiness.businessId,
						businesses.map((b) => b.id),
					),
			}).then((accounts) => accounts.map((a) => a.id));

			let conditions = [
				gte(Transaction.date, input.dateFrom),
				lte(Transaction.date, input.dateTo),
				or(
					inArray(Transaction.toAccountId, accountIds),
					inArray(Transaction.fromAccountId, accountIds),
				),
			];

			if (input.peopleIds?.length) {
				conditions = [
					...conditions,
					inArray(Transaction.personId, input.peopleIds),
				];
			}

			if (input.categoriesIds?.length) {
				conditions = [
					...conditions,
					inArray(Transaction.categoryId, input.categoriesIds),
				];
			}

			if (input.dictionaryAccountsIds?.length) {
				const filteredAccountIds =
					await ctx.db.query.AccountOnBusiness.findMany({
						where: inArray(
							AccountOnBusiness.dictionaryAccountId,
							input.dictionaryAccountsIds,
						),
					}).then((accounts) => accounts.map((a) => a.id));

				conditions = [
					...conditions,
					or(
						inArray(Transaction.toAccountId, filteredAccountIds),
						inArray(Transaction.fromAccountId, filteredAccountIds),
					),
				];
			}

			const transactions = await ctx.db.query.Transaction.findMany({
				where: and(...conditions),
				with: {
					category: true,
					person: true,
					member: {
						with: {
							user: true,
						},
					},
					fromAccount: {
						with: {
							business: true,
							dictionaryAccount: true,
						},
					},
					toAccount: {
						with: {
							business: true,
							dictionaryAccount: true,
						},
					},
				},
				orderBy: [desc(Transaction.date)],
			});

			const csvData = transactions.map((t) => ({
				Fecha: dayjs(t.date).format("DD/MM/YY HH:mm"),
				Monto: t.amount,
				"Tipo de transacción": t.transactionType,
				Saldo: t.balance,
				"Tasa de cambio": t.exchangeRate || "",
				Descripción: t.about || "",
				Categoría: t.category?.name || "",
				Persona: t.person?.name || "",
				Usuario: t.member?.user.firstname || "",
				"Cuenta origen": t.fromAccount?.dictionaryAccount.name || "",
				"Empresa origen": t.fromAccount?.business.name || "",
				"Cuenta destino": t.toAccount.dictionaryAccount.name,
				"Empresa destino": t.toAccount.business.name,
			}));

			return Papa.unparse(csvData, {
				delimiter: ",",
				header: true,
			});
		}),
	getPublicReceipt: publicProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				token: z.string().uuid(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const initialTransaction = await ctx.db.query.Transaction.findFirst({
				where: eq(Transaction.id, input.id),
				with: {
					transactionGroup: {
						with: {
							transactions: {
								with: {
									toAccount: {
										with: {
											dictionaryAccount: true,
										},
									},
									fromAccount: {
										with: {
											dictionaryAccount: true,
										},
									},
								},
							},
							cablesOnTransactionGroup: { with: { cable: true, }, },
							checksOnTransactionGroup: { with: { check: true, }, },
							business: { columns: { id: true, name: true, image: true, }, },
							creditsOnTransactionGroup: { with: { credit: true, }, },
							loansOnTransactionGroup: { with: { loan: true, }, },
						},
					},
					category: true,
					member: true,
					person: true,
					fromAccount: { with: { dictionaryAccount: true, }, },
					toAccount: { with: { dictionaryAccount: true, }, },
				},
			});

			if (!initialTransaction || initialTransaction.accessToken !== input.token) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "Token inválido o la transacción no existe.",
				});
			}

			// --- LÓGICA INTELIGENTE PARA OPERACIONES MÚLTIPLES ---
			// Si la operación es de tipo MULTIPLE, nos aseguramos de que los datos
			// principales provengan del grupo para dar consistencia al comprobante.
			if (initialTransaction.transactionGroup?.operationType === 'MULTIPLE') {
				const group = initialTransaction.transactionGroup;

				// Construimos un objeto de respuesta "sintético" que se parece a una
				// transacción principal, pero usando los datos del grupo.
				const syntheticReceiptData = {
					...initialTransaction, // Usamos la tx inicial como base para mantener todos los campos
					id: group.id, // Usamos el ID del grupo como ID principal para el recibo
					transactionGroupId: group.id, // El ID del grupo es el mismo

					// Sobreescribimos datos clave con los del grupo para consistencia
					date: group.createdAt, // La fecha de la operación es la de creación del grupo
					about: group.description, // La descripción es la del grupo
					amount: '0', // El monto individual no es relevante, lo quitamos.

					// El "person" debe ser consistente. Asumimos que es el mismo para todo el grupo,
					// así que el de la transacción inicial nos sirve. Si no, habría que buscarlo.
					// El `transactionGroup` ya está completo con todas sus transacciones anidadas.
					transactionGroup: {
						...group,
						name: group.name, // El nombre de la operación es el del grupo
					}
				};

				return syntheticReceiptData;
			}


			return initialTransaction;
		}),

	saveSignature: publicProcedure
		.input(
			z.object({
				id: z.string(),
				token: z.string(),
				signature: z.string(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const transaction = await ctx.db.query.Transaction.findFirst({
				where: eq(Transaction.id, input.id),
			});

			if (!transaction || transaction.accessToken !== input.token) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "Token inválido",
				});
			}

			await ctx.db
				.update(Transaction)
				.set({
					signature: input.signature,
					signed: true,
				})
				.where(eq(Transaction.id, input.id));

			return { success: true };
		}),

	updateSignatureRequirement: protectedProcedure
		.input(
			z.object({
				id: z.string({ message: "Obligatorio" }),
				requiresSignature: z.boolean({ message: "Obligatorio" }),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// Verificar que la transacción existe
			const transaction = await ctx.db.query.Transaction.findFirst({
				where: eq(Transaction.id, input.id),
				with: {
					transactionGroup: true,
				},
			});

			if (!transaction) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Transacción inexistente",
				});
			}

			// Obtener el guildSlug para verificar permisos
			let guildSlug = "";

			if (transaction.transactionGroup) {
				guildSlug = transaction.transactionGroup.guildSlug;
			} else {
				// Si no hay grupo, obtener el guildSlug de la cuenta
				const account = await ctx.db.query.AccountOnBusiness.findFirst({
					where: eq(AccountOnBusiness.id, transaction.toAccountId),
					with: {
						business: true,
					},
				});

				if (account && account.business) {
					guildSlug = account.business.guildSlug;
				}
			}

			// Verificar que el usuario tiene permisos
			const member = await ctx.db.query.Member.findFirst({
				where: and(
					eq(Member.userId, ctx.user.id),
					eq(Member.guildSlug, guildSlug),
				),
			});

			if (!member) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "No tienes permisos para actualizar esta transacción",
				});
			}

			// Actualizar el campo requiresSignature
			await ctx.db
				.update(Transaction)
				.set({ requiresSignature: input.requiresSignature })
				.where(eq(Transaction.id, input.id));

			return {
				success: true,
				message: "Requisito de firma actualizado con éxito",
			};
		}),
	bySubAccountId: protectedProcedure
		.input(
			z.object({
				subAccountId: z.string(),
			}),
		)
		.query(async ({ ctx, input }) => {
			// Verificar que la subcuenta existe
			const subAccount = await ctx.db.query.AccountOnBusiness.findFirst({
				where: and(
					eq(AccountOnBusiness.id, input.subAccountId),
					eq(AccountOnBusiness.discharged, true),
					eq(AccountOnBusiness.subAccount, true), // Debe ser una subcuenta
				),
				with: {
					business: true,
				},
			});

			if (!subAccount) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Subcuenta no encontrada",
				});
			}

			// Obtener el miembro actual
			const member = await ctx.db.query.Member.findFirst({
				where: and(
					eq(Member.guildSlug, subAccount.business.guildSlug),
					eq(Member.userId, ctx.user.id),
				),
			});

			if (!member) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "No tienes acceso a esta organización",
				});
			}

			// Si es OWNER o MANAGER, tiene acceso completo
			let hasAccess = member.role === "OWNER" || member.role === "MANAGER";

			// Si es MEMBER, verificar permisos específicos
			if (member.role === "MEMBER" && !hasAccess) {
				const memberOnBusiness = await ctx.db.query.MemberOnBusiness.findFirst({
					where: and(
						eq(MemberOnBusiness.memberId, member.id),
						eq(MemberOnBusiness.businessId, subAccount.businessId),
					),
					with: {
						accountPermissions: true,
					},
				});

				// Si no tiene relación con la empresa, no tiene acceso
				if (!memberOnBusiness) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "No tienes acceso a esta empresa",
					});
				}

				// Si tiene acceso completo a la empresa, tiene acceso a todas las cuentas
				if (memberOnBusiness.hasFullAccess) {
					hasAccess = true;
				} else {
					// Si no tiene acceso completo, verificar si tiene acceso a esta cuenta específica
					const hasAccountAccess = memberOnBusiness.accountPermissions.some(
						(permission) =>
							permission.accountOnBusinessId === input.subAccountId &&
							permission.canRead,
					);

					if (!hasAccountAccess) {
						throw new TRPCError({
							code: "UNAUTHORIZED",
							message: "No tienes permisos para ver esta cuenta",
						});
					}

					hasAccess = true;
				}
			}

			// Si llegamos aquí, el usuario tiene acceso a la cuenta
			// Buscar las transacciones de esta subcuenta específica
			const transactions = await ctx.db.query.Transaction.findMany({
				where: eq(Transaction.toAccountId, input.subAccountId),
				with: {
					category: true,
					documents: true,
					member: {
						with: {
							user: true,
						},
					},
					person: true,
					fromAccount: {
						with: {
							dictionaryAccount: true,
							business: true,
						},
					},
					toAccount: {
						with: {
							dictionaryAccount: true,
							business: true,
						},
					},
					transactionGroup: true,
				},
				orderBy: [desc(Transaction.date)],
			});

			return transactions;
		}),
	byAccountId: protectedProcedure
		.input(
			z.object({
				accountId: z.string(),
			}),
		)
		.query(async ({ ctx, input }) => {
			// Obtener la cuenta para determinar si es agregada o colectiva
			const account = await ctx.db.query.AccountOnBusiness.findFirst({
				where: eq(AccountOnBusiness.id, input.accountId),
				with: {
					dictionaryAccount: true,
				},
			});

			if (!account) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Cuenta no encontrada",
				});
			}

			let transactions = [];

			// Si es una cuenta agregada (tiene subcuentas)
			if (account.dictionaryAccount.hasSubAccounts) {
				// Buscar todas las subcuentas
				const subAccounts = await ctx.db.query.AccountOnBusiness.findMany({
					where: and(
						eq(
							AccountOnBusiness.dictionaryAccountId,
							account.dictionaryAccountId,
						),
						eq(AccountOnBusiness.businessId, account.businessId),
						eq(AccountOnBusiness.subAccount, true),
						eq(AccountOnBusiness.discharged, true),
					),
				});

				// Obtener los IDs de las subcuentas
				const subAccountIds = subAccounts.map((sa) => sa.id);

				// Buscar transacciones de todas las subcuentas
				transactions = await ctx.db.query.Transaction.findMany({
					where: inArray(Transaction.toAccountId, subAccountIds),
					with: {
						category: true,
						documents: true,
						member: {
							with: {
								user: true,
							},
						},
						person: true,
						fromAccount: {
							with: {
								dictionaryAccount: true,
								business: true,
							},
						},
						toAccount: {
							with: {
								dictionaryAccount: true,
								business: true,
							},
						},
						// transactionGroup: {
						//     with: {
						//         business: true,
						//         transactions: {
						//             with: {
						//                 toAccount: {
						//                     with: {
						//                         business: true,
						//                         dictionaryAccount: true
						//                     }
						//                 },
						//                 fromAccount: {
						//                     with: {
						//                         business: true,
						//                         dictionaryAccount: true
						//                     }
						//                 },
						//                 category: true,
						//                 person: true,
						//                 member: true
						//             }
						//         },
						//         guild: true
						//     }
						// },
						transactionGroup: true,
					},
					orderBy: [desc(Transaction.date)],
				});
			} else {
				// Para cuenta colectiva, buscar sus transacciones directamente
				transactions = await ctx.db.query.Transaction.findMany({
					where: eq(Transaction.toAccountId, input.accountId),
					with: {
						category: true,
						documents: true,
						member: {
							with: {
								user: true,
							},
						},
						person: true,
						fromAccount: {
							with: {
								dictionaryAccount: true,
								business: true,
							},
						},
						toAccount: {
							with: {
								dictionaryAccount: true,
								business: true,
							},
						},
						// transactionGroup: {
						//     with: {
						//         business: true,
						//         transactions: {
						//             with: {
						//                 toAccount: {
						//                     with: {
						//                         business: true,
						//                         dictionaryAccount: true
						//                     }
						//                 },
						//                 fromAccount: {
						//                     with: {
						//                         business: true,
						//                         dictionaryAccount: true
						//                     }
						//                 },
						//                 category: true,
						//                 person: true,
						//                 member: true
						//             }
						//         },
						//         guild: true
						//     }
						// }
						transactionGroup: true,
					},
					orderBy: [desc(Transaction.date)],
				});
			}

			return transactions;
		}),
	byAccountIdWithCursor: protectedProcedure
		.input(TransactionByAccountCursorInputSchema)
		.query(async ({ ctx, input }) => {
			const { accountId, guildSlug, businessSlug, limit, cursor } = input;
			const userId = ctx.user.id; // Asumo que es ctx.user.id

			console.log(
				`[TRPC Transaction.byAccountIdWithCursor] Input: accountId=${accountId}, guildSlug=${guildSlug}, businessSlug=${businessSlug}, limit=${limit}, userId=${userId}, cursor:`,
				cursor,
			);

			let canReadAccount = false;

			const memberCtx = await ctx.db.query.Member.findFirst({
				where: and(
					eq(Member.userId, userId),
					eq(Member.guildSlug, guildSlug),
					eq(Member.discharged, true), // true = activo
					// eq(Member.status, "SUCCESS"),
				),
				columns: { id: true, role: true },
			});

			if (!memberCtx) {
				console.warn(
					`[TRPC Transaction.byAccountIdWithCursor] Member not found or invalid for userId: ${userId}, guildSlug: ${guildSlug}.`,
				);
				// Si no hay miembro válido, no puede leer, se lanzará el error al final si canReadAccount sigue false.
			} else {
				const businessCtx = await ctx.db.query.Business.findFirst({
					where: and(
						eq(Business.guildSlug, guildSlug),
						eq(Business.businessSlug, businessSlug),
						eq(Business.discharged, true), // true = activo
					),
					columns: { id: true },
				});

				if (!businessCtx) {
					console.warn(
						`[TRPC Transaction.byAccountIdWithCursor] Business not found or not active for guildSlug: ${guildSlug}, businessSlug: ${businessSlug}.`,
					);
				} else {
					const accountTarget = await ctx.db.query.AccountOnBusiness.findFirst({
						where: and(
							eq(AccountOnBusiness.id, accountId),
							eq(AccountOnBusiness.businessId, businessCtx.id), // Asegura que la cuenta pertenece al business
							eq(AccountOnBusiness.discharged, true), // true = activo
						),
						columns: { id: true },
					});

					if (!accountTarget) {
						console.warn(
							`[TRPC Transaction.byAccountIdWithCursor] Account ${accountId} not found, not active, or not in business ${businessCtx.id}.`,
						);
					} else {
						// Si llegamos aquí, el Member, Business y Account existen y son activos/válidos.
						// Ahora verificamos el rol.
						if (memberCtx.role === "OWNER" || memberCtx.role === "MANAGER") {
							console.log(
								`[TRPC Transaction.byAccountIdWithCursor] User ${userId} is ${memberCtx.role}. Granting read access to account ${accountId}.`,
							);
							canReadAccount = true;
						} else {
							// memberCtx.role === "MEMBER"
							const memberOnBusiness =
								await ctx.db.query.MemberOnBusiness.findFirst({
									where: and(
										eq(MemberOnBusiness.memberId, memberCtx.id),
										eq(MemberOnBusiness.businessId, businessCtx.id),
									),
									columns: { id: true, hasFullAccess: true },
								});

							if (memberOnBusiness) {
								if (memberOnBusiness.hasFullAccess) {
									console.log(
										`[TRPC Transaction.byAccountIdWithCursor] User ${userId} (MEMBER) has fullAccess on business ${businessCtx.id}. Granting read access to account ${accountId}.`,
									);
									canReadAccount = true;
								} else {
									const memberOnAccount =
										await ctx.db.query.MemberOnAccountOnBusiness.findFirst({
											where: and(
												eq(
													MemberOnAccountOnBusiness.memberOnBusinessId,
													memberOnBusiness.id,
												),
												eq(
													MemberOnAccountOnBusiness.accountOnBusinessId,
													accountId,
												), // Permiso para ESTA cuenta
												// eq(MemberOnAccountOnBusiness.canRead, true) // El .canRead se verifica en la asignación
											),
											columns: { canRead: true },
										});
									if (memberOnAccount && memberOnAccount.canRead) {
										console.log(
											`[TRPC Transaction.byAccountIdWithCursor] User ${userId} (MEMBER) has specific canRead=true permission for account ${accountId}.`,
										);
										canReadAccount = true;
									} else {
										console.log(
											`[TRPC Transaction.byAccountIdWithCursor] User ${userId} (MEMBER) lacks specific read permission for account ${accountId}. canReadAccount remains false.`,
										);
									}
								}
							} else {
								console.log(
									`[TRPC Transaction.byAccountIdWithCursor] User ${userId} (MEMBER) has no MemberOnBusiness record for business ${businessCtx.id}. canReadAccount remains false.`,
								);
							}
						}
					}
				}
			}

			if (!canReadAccount) {
				console.error(
					`[TRPC Transaction.byAccountIdWithCursor] FINAL CHECK: User ${userId} lacks read permission for account ${accountId}. Throwing FORBIDDEN.`,
				);
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "No tienes permiso para leer esta cuenta.",
				});
			}
			// Fin verificación de permisos

			const mainAccount = await ctx.db.query.AccountOnBusiness.findFirst({
				where: and(
					eq(AccountOnBusiness.id, accountId),
					eq(AccountOnBusiness.discharged, true),
				),
				with: { dictionaryAccount: { columns: { hasSubAccounts: true } } },
			});

			if (!mainAccount) {
				// Este caso debería ser extremadamente raro si la verificación de permisos ya pasó.
				console.error(
					`[TRPC Transaction.byAccountIdWithCursor] CRITICAL: Main account ${accountId} not found AFTER permission check.`,
				);
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Error al obtener detalles de la cuenta.",
				});
			}

			let targetAccountIds: string[] = [];
			if (mainAccount.dictionaryAccount.hasSubAccounts) {
				const subAccounts = await ctx.db.query.AccountOnBusiness.findMany({
					where: and(
						eq(
							AccountOnBusiness.dictionaryAccountId,
							mainAccount.dictionaryAccountId,
						),
						eq(AccountOnBusiness.businessId, mainAccount.businessId),
						eq(AccountOnBusiness.subAccount, true),
						eq(AccountOnBusiness.discharged, true),
					),
					columns: { id: true },
				});
				targetAccountIds = subAccounts.map((sa) => sa.id);
			} else {
				targetAccountIds = [accountId];
			}

			if (
				targetAccountIds.length === 0 &&
				mainAccount.dictionaryAccount.hasSubAccounts
			) {
				// Es agregada pero no tiene subcuentas activas para mostrar transacciones
				return { items: [], nextCursor: undefined };
			} else if (targetAccountIds.length === 0) {
				// Esto sería si la propia cuenta principal no está en targetAccountIds (no debería pasar aquí)
				console.error(
					`[TRPC Transaction.byAccountIdWithCursor] CRITICAL: targetAccountIds is empty for non-aggregated or main account ${accountId}.`,
				);
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Error al determinar las cuentas para transacciones.",
				});
			}

			const cursorCondition = cursor
				? or(
					lt(Transaction.date, new Date(cursor.date)),
					and(
						eq(Transaction.date, new Date(cursor.date)),
						lt(Transaction.id, cursor.id),
					),
				)
				: undefined;

			const itemsFetchedFromDB = await ctx.db.query.Transaction.findMany({
				where: and(
					or(
						inArray(Transaction.fromAccountId, targetAccountIds),
						inArray(Transaction.toAccountId, targetAccountIds),
					),
					// eq(Transaction.discharged, true), // Considera añadir si las transacciones pueden ser "discharged"
					cursorCondition,
				),
				with: {
					category: true,
					documents: true,
					member: { with: { user: true } },
					person: true,
					fromAccount: { with: { dictionaryAccount: true, business: true } },
					toAccount: { with: { dictionaryAccount: true, business: true } },
					transactionGroup: true,
				},
				orderBy: [desc(Transaction.date), desc(Transaction.id)],
				limit: limit + 1,
			});

			let nextCursorResult:
				| z.TypeOf<typeof TransactionByAccountCursorInputSchema>["cursor"]
				| undefined = undefined;
			let itemsToReturnClient: typeof itemsFetchedFromDB;

			if (itemsFetchedFromDB.length > limit) {
				const lastItem = itemsFetchedFromDB[limit - 1];
				if (lastItem) {
					nextCursorResult = {
						date: lastItem.date.toISOString(),
						id: lastItem.id,
					};
				}
				itemsToReturnClient = itemsFetchedFromDB.slice(0, limit);
			} else {
				itemsToReturnClient = itemsFetchedFromDB;
			}

			return { items: itemsToReturnClient, nextCursor: nextCursorResult };
		}),

	countByAccountId: protectedProcedure
		.input(AccountIdSchema)
		.query(async ({ ctx, input }) => {
			const { accountId, guildSlug, businessSlug } = input;
			const userId = ctx.user.id;

			let canReadAccount = false;
			const memberCtx = await ctx.db.query.Member.findFirst({
				where: and(
					eq(Member.userId, userId),
					eq(Member.guildSlug, guildSlug),
					eq(Member.discharged, true),
					// eq(Member.status, "SUCCESS")
				),
				columns: { id: true, role: true },
			});

			if (memberCtx) {
				const businessCtx = await ctx.db.query.Business.findFirst({
					where: and(
						eq(Business.guildSlug, guildSlug),
						eq(Business.businessSlug, businessSlug),
						eq(Business.discharged, true),
					),
					columns: { id: true },
				});
				if (businessCtx) {
					const accountTarget = await ctx.db.query.AccountOnBusiness.findFirst({
						where: and(
							eq(AccountOnBusiness.id, accountId),
							eq(AccountOnBusiness.businessId, businessCtx.id),
							eq(AccountOnBusiness.discharged, true),
						),
						columns: { id: true },
					});
					if (accountTarget) {
						if (memberCtx.role === "OWNER" || memberCtx.role === "MANAGER") {
							canReadAccount = true;
						} else {
							const memberOnBusiness =
								await ctx.db.query.MemberOnBusiness.findFirst({
									where: and(
										eq(MemberOnBusiness.memberId, memberCtx.id),
										eq(MemberOnBusiness.businessId, businessCtx.id),
									),
									columns: { id: true, hasFullAccess: true },
								});
							if (memberOnBusiness) {
								if (memberOnBusiness.hasFullAccess) {
									canReadAccount = true;
								} else {
									const memberOnAccount =
										await ctx.db.query.MemberOnAccountOnBusiness.findFirst({
											where: and(
												eq(
													MemberOnAccountOnBusiness.memberOnBusinessId,
													memberOnBusiness.id,
												),
												eq(
													MemberOnAccountOnBusiness.accountOnBusinessId,
													accountId,
												),
											),
											columns: { canRead: true },
										});
									if (memberOnAccount && memberOnAccount.canRead)
										canReadAccount = true;
								}
							}
						}
					}
				}
			}

			if (!canReadAccount) return { total: 0 };

			const mainAccount = await ctx.db.query.AccountOnBusiness.findFirst({
				where: and(
					eq(AccountOnBusiness.id, accountId),
					eq(AccountOnBusiness.discharged, true),
				),
				with: { dictionaryAccount: { columns: { hasSubAccounts: true } } },
			});
			if (!mainAccount) return { total: 0 };

			let targetAccountIds: string[] = [];
			if (mainAccount.dictionaryAccount.hasSubAccounts) {
				const subAccounts = await ctx.db.query.AccountOnBusiness.findMany({
					where: and(
						eq(
							AccountOnBusiness.dictionaryAccountId,
							mainAccount.dictionaryAccountId,
						),
						eq(AccountOnBusiness.businessId, mainAccount.businessId),
						eq(AccountOnBusiness.subAccount, true),
						eq(AccountOnBusiness.discharged, true),
					),
					columns: { id: true },
				});
				targetAccountIds = subAccounts.map((sa) => sa.id);
			} else {
				targetAccountIds = [accountId];
			}

			if (
				targetAccountIds.length === 0 &&
				mainAccount.dictionaryAccount.hasSubAccounts
			) {
				return { total: 0 };
			} else if (targetAccountIds.length === 0) {
				return { total: 0 }; // Si la cuenta principal no está en targetAccountIds
			}

			const result = await ctx.db
				.select({ total: count() })
				.from(Transaction)
				.where(
					and(
						or(
							inArray(Transaction.fromAccountId, targetAccountIds),
							inArray(Transaction.toAccountId, targetAccountIds),
						),
						// eq(Transaction.discharged, true), // Considera añadir
					),
				);

			return { total: result[0]?.total ? Number(result[0].total) : 0 };
		}),

	// Repetir la misma corrección de lógica de permisos para bySubAccountIdWithCursor y countBySubAccountId
	// ... (código para bySubAccountIdWithCursor y countBySubAccountId con la lógica de permisos corregida)
	// ...

	bySubAccountIdWithCursor: protectedProcedure
		.input(TransactionBySubAccountCursorInputSchema) // Reutilizamos el schema, ya que la estructura es la misma
		.query(async ({ ctx, input }) => {
			const { subAccountId, guildSlug, businessSlug, limit, cursor } = input;
			const userId = ctx.user.id;

			console.log(
				`[TRPC Transaction.bySubAccountIdWithCursor] Input: subAccountId=${subAccountId}, guildSlug=${guildSlug}, businessSlug=${businessSlug}, limit=${limit}, userId=${userId}, cursor:`,
				cursor,
			);

			let hasReadAccessToSubAccount = false;

			const subAccountInfo = await ctx.db.query.AccountOnBusiness.findFirst({
				where: and(
					eq(AccountOnBusiness.id, subAccountId),
					eq(AccountOnBusiness.discharged, true),
					eq(AccountOnBusiness.subAccount, true),
				),
				columns: { id: true, businessId: true },
				with: {
					business: {
						columns: { guildSlug: true },
					},
				},
			});

			if (!subAccountInfo) {
				console.warn(
					`[TRPC Transaction.bySubAccountIdWithCursor] SubAccount ${subAccountId} not found, not active, or not a subAccount.`,
				);
				// Si la subcuenta no es válida, no se puede tener permiso. El error se lanzará al final.
			} else if (subAccountInfo.business.guildSlug !== guildSlug) {
				console.warn(
					`[TRPC Transaction.bySubAccountIdWithCursor] Mismatch: input guildSlug ${guildSlug} vs subAccount's guildSlug ${subAccountInfo.business.guildSlug}.`,
				);
				// Guild mismatch, tampoco hay permiso.
			} else {
				const memberCtx = await ctx.db.query.Member.findFirst({
					where: and(
						eq(Member.userId, userId),
						eq(Member.guildSlug, guildSlug),
						eq(Member.discharged, true),
						eq(Member.status, "SUCCESS"),
					),
					columns: { id: true, role: true },
				});

				if (!memberCtx) {
					console.warn(
						`[TRPC Transaction.bySubAccountIdWithCursor] Member not found for userId: ${userId} in guild: ${guildSlug}.`,
					);
				} else {
					// Si Member, Business y SubAccount son válidos y consistentes:
					if (memberCtx.role === "OWNER" || memberCtx.role === "MANAGER") {
						console.log(
							`[TRPC Transaction.bySubAccountIdWithCursor] User ${userId} is ${memberCtx.role}. Granting read access to subAccount ${subAccountId}.`,
						);
						hasReadAccessToSubAccount = true;
					} else {
						const memberOnBusiness =
							await ctx.db.query.MemberOnBusiness.findFirst({
								where: and(
									eq(MemberOnBusiness.memberId, memberCtx.id),
									eq(MemberOnBusiness.businessId, subAccountInfo.businessId),
								),
								columns: { id: true, hasFullAccess: true },
							});

						if (memberOnBusiness) {
							if (memberOnBusiness.hasFullAccess) {
								console.log(
									`[TRPC Transaction.bySubAccountIdWithCursor] User ${userId} (MEMBER) has fullAccess on business. Granting read access to subAccount ${subAccountId}.`,
								);
								hasReadAccessToSubAccount = true;
							} else {
								const memberOnSubAccountPermission =
									await ctx.db.query.MemberOnAccountOnBusiness.findFirst({
										where: and(
											eq(
												MemberOnAccountOnBusiness.memberOnBusinessId,
												memberOnBusiness.id,
											),
											eq(
												MemberOnAccountOnBusiness.accountOnBusinessId,
												subAccountId,
											),
											eq(MemberOnAccountOnBusiness.canRead, true),
										),
										columns: { id: true },
									});
								if (memberOnSubAccountPermission) {
									console.log(
										`[TRPC Transaction.bySubAccountIdWithCursor] User ${userId} (MEMBER) has specific canRead=true permission for subAccount ${subAccountId}.`,
									);
									hasReadAccessToSubAccount = true;
								} else {
									console.log(
										`[TRPC Transaction.bySubAccountIdWithCursor] User ${userId} (MEMBER) lacks specific read permission for subAccount ${subAccountId}. hasReadAccessToSubAccount remains false.`,
									);
								}
							}
						} else {
							console.log(
								`[TRPC Transaction.bySubAccountIdWithCursor] User ${userId} (MEMBER) has no MemberOnBusiness record. hasReadAccessToSubAccount remains false.`,
							);
						}
					}
				}
			}

			if (!hasReadAccessToSubAccount) {
				console.error(
					`[TRPC Transaction.bySubAccountIdWithCursor] FINAL CHECK: User ${userId} lacks read permission for subAccount ${subAccountId}. Throwing FORBIDDEN.`,
				);
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "No tienes permiso para ver esta subcuenta.",
				});
			}

			const cursorCondition = cursor
				? or(
					lt(Transaction.date, new Date(cursor.date)),
					and(
						eq(Transaction.date, new Date(cursor.date)),
						lt(Transaction.id, cursor.id),
					),
				)
				: undefined;

			const itemsFetchedFromDB = await ctx.db.query.Transaction.findMany({
				where: and(
					or(
						eq(Transaction.fromAccountId, subAccountId),
						eq(Transaction.toAccountId, subAccountId),
					),
					// eq(Transaction.discharged, true),
					cursorCondition,
				),
				with: {
					category: true,
					documents: true,
					member: { with: { user: true } },
					person: true,
					fromAccount: { with: { dictionaryAccount: true, business: true } },
					toAccount: { with: { dictionaryAccount: true, business: true } },
					transactionGroup: true,
				},
				orderBy: [desc(Transaction.date), desc(Transaction.id)],
				limit: limit + 1,
			});

			let nextCursorResult:
				| z.TypeOf<typeof TransactionBySubAccountCursorInputSchema>["cursor"]
				| undefined = undefined;
			let itemsToReturnClient: typeof itemsFetchedFromDB;

			if (itemsFetchedFromDB.length > limit) {
				const lastItem = itemsFetchedFromDB[limit - 1];
				if (lastItem)
					nextCursorResult = {
						date: lastItem.date.toISOString(),
						id: lastItem.id,
					};
				itemsToReturnClient = itemsFetchedFromDB.slice(0, limit);
			} else {
				itemsToReturnClient = itemsFetchedFromDB;
			}

			return { items: itemsToReturnClient, nextCursor: nextCursorResult };
		}),

	countBySubAccountId: protectedProcedure
		.input(SubAccountIdentityInputSchema) // Reutilizamos el schema
		.query(async ({ ctx, input }) => {
			const { subAccountId, guildSlug, businessSlug } = input;
			const userId = ctx.user.id;

			let hasReadAccessToSubAccount = false;
			const subAccountInfo = await ctx.db.query.AccountOnBusiness.findFirst({
				where: and(
					eq(AccountOnBusiness.id, subAccountId),
					eq(AccountOnBusiness.discharged, true),
					eq(AccountOnBusiness.subAccount, true),
				),
				columns: { id: true, businessId: true },
				with: { business: { columns: { guildSlug: true } } },
			});

			if (!subAccountInfo || subAccountInfo.business.guildSlug !== guildSlug) {
				return { total: 0 };
			} else {
				const memberCtx = await ctx.db.query.Member.findFirst({
					where: and(
						eq(Member.userId, userId),
						eq(Member.guildSlug, guildSlug),
						eq(Member.discharged, true),
						// eq(Member.status, "SUCCESS")
					),
					columns: { id: true, role: true },
				});
				if (!memberCtx) {
					// No member, no access
				} else {
					if (memberCtx.role === "OWNER" || memberCtx.role === "MANAGER") {
						hasReadAccessToSubAccount = true;
					} else {
						const memberOnBusiness =
							await ctx.db.query.MemberOnBusiness.findFirst({
								where: and(
									eq(MemberOnBusiness.memberId, memberCtx.id),
									eq(MemberOnBusiness.businessId, subAccountInfo.businessId),
								),
								columns: { id: true, hasFullAccess: true },
							});
						if (memberOnBusiness) {
							if (memberOnBusiness.hasFullAccess) {
								hasReadAccessToSubAccount = true;
							} else {
								const memberOnSubAccountPermission =
									await ctx.db.query.MemberOnAccountOnBusiness.findFirst({
										where: and(
											eq(
												MemberOnAccountOnBusiness.memberOnBusinessId,
												memberOnBusiness.id,
											),
											eq(
												MemberOnAccountOnBusiness.accountOnBusinessId,
												subAccountId,
											),
											eq(MemberOnAccountOnBusiness.canRead, true),
										),
										columns: { id: true },
									});
								if (memberOnSubAccountPermission)
									hasReadAccessToSubAccount = true;
							}
						}
					}
				}
			}
			if (!hasReadAccessToSubAccount) return { total: 0 };

			const result = await ctx.db
				.select({ total: count() })
				.from(Transaction)
				.where(
					and(
						or(
							eq(Transaction.fromAccountId, subAccountId),
							eq(Transaction.toAccountId, subAccountId),
						),
						// eq(Transaction.discharged, true),
					),
				);

			return { total: result[0]?.total ? Number(result[0].total) : 0 };
		}),
	byAccountForPeriod: protectedProcedure
		.input(TransactionsByAccountForPeriodInputSchema)
		.query(async ({ ctx, input }) => {
			const { accountId, startDate, endDate, guildSlug, businessSlug } = input;
			const userId = ctx.user.id;

			let canReadAccount = false;
			const memberCtx = await ctx.db.query.Member.findFirst({
				where: and(
					eq(Member.userId, userId),
					eq(Member.guildSlug, guildSlug),
					eq(Member.discharged, true),
				),
				columns: { id: true, role: true },
			});

			if (memberCtx) {
				const businessCtx = await ctx.db.query.Business.findFirst({
					where: and(
						eq(Business.guildSlug, guildSlug),
						eq(Business.businessSlug, businessSlug),
						eq(Business.discharged, true),
					),
					columns: { id: true },
				});
				if (businessCtx) {
					const accountTarget = await ctx.db.query.AccountOnBusiness.findFirst({
						where: and(
							eq(AccountOnBusiness.id, accountId),
							eq(AccountOnBusiness.businessId, businessCtx.id),
							eq(AccountOnBusiness.discharged, true),
						),
						columns: { id: true },
					});
					if (accountTarget) {
						if (memberCtx.role === "OWNER" || memberCtx.role === "MANAGER") {
							canReadAccount = true;
						} else {
							const memberOnBusiness =
								await ctx.db.query.MemberOnBusiness.findFirst({
									where: and(
										eq(MemberOnBusiness.memberId, memberCtx.id),
										eq(MemberOnBusiness.businessId, businessCtx.id),
									),
									columns: { id: true, hasFullAccess: true },
								});
							if (memberOnBusiness) {
								if (memberOnBusiness.hasFullAccess) {
									canReadAccount = true;
								} else {
									const memberOnAccount =
										await ctx.db.query.MemberOnAccountOnBusiness.findFirst({
											where: and(
												eq(
													MemberOnAccountOnBusiness.memberOnBusinessId,
													memberOnBusiness.id,
												),
												eq(
													MemberOnAccountOnBusiness.accountOnBusinessId,
													accountId,
												),
												eq(MemberOnAccountOnBusiness.canRead, true),
											),
											columns: { canRead: true }, // Solo para confirmar
										});
									if (memberOnAccount?.canRead) canReadAccount = true;
								}
							}
						}
					}
				}
			}

			if (!canReadAccount) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "No tienes permiso para ver esta cuenta.",
				});
			}

			const endOfDayEndDate = dayjs(endDate).endOf("day").toDate();

			// Obtener saldo inicial: la última transacción ANTES del inicio del período que afectó a ESTA cuenta.
			const lastTxBeforePeriod = await ctx.db.query.Transaction.findFirst({
				where: and(
					or(
						eq(Transaction.toAccountId, accountId),
						eq(Transaction.fromAccountId, accountId),
					),
					lt(Transaction.date, dayjs(startDate).startOf("day").toDate()), // Estrictamente antes del inicio del día
				),
				orderBy: [desc(Transaction.date), desc(Transaction.id)], // La más reciente de las anteriores
				columns: {
					balance: true,
					amount: true,
					toAccountId: true,
					fromAccountId: true,
					transactionType: true,
				},
			});

			let periodStartingBalance = 0;
			const accountDetails = await ctx.db.query.AccountOnBusiness.findFirst({
				where: eq(AccountOnBusiness.id, accountId),
				columns: { currentBalance: true, createdAt: true }, // Asumimos un saldo inicial si no hay txs previas
			});

			if (lastTxBeforePeriod) {
				if (lastTxBeforePeriod.toAccountId === accountId) {
					periodStartingBalance = parseNumericValue(
						lastTxBeforePeriod.balance ?? 0,
					);
				} else if (lastTxBeforePeriod.fromAccountId === accountId) {
					// Si la última transacción fue una salida de esta cuenta, el balance registrado es de la OTRA cuenta.
					// Necesitamos calcular el balance de ESTA cuenta antes de esa salida.
					// Saldo_anterior_nuestra_cuenta = Saldo_registrado_otra_cuenta (después de recibir) +/- Monto_tx (dependiendo del tipo en OTRA cuenta)
					// Esta lógica es compleja sin saber el balance de *nuestra* cuenta en ESE punto.
					// Simplificación: Tomamos el balance de la toAccount y ajustamos según la perspectiva de fromAccount.
					// Si fromAccount fue DEBIT (salió dinero), y toAccount tuvo un DEBIT (para cuentas de activo de toAccount, aumentó), entonces nuestro balance disminuyó.
					// Esta simplificación es propensa a errores si no se conoce el balance de la cuenta 'accountId' justo antes de esa transacción.
					// La forma más segura sería reconstruir el balance, pero es costoso.
					// Por ahora, usaremos el currentBalance de la cuenta si la última tx no fue un 'to' para esta cuenta.
					periodStartingBalance = parseNumericValue(
						accountDetails?.currentBalance ?? "0",
					);
					// TODO: Considerar una forma más precisa de obtener el saldo inicial histórico.
				}
			} else if (accountDetails) {
				// Si no hay transacciones antes, usar el currentBalance como punto de partida si la cuenta se creó antes.
				// Esto asume que currentBalance es el saldo "inicial" antes del período si no hay transacciones.
				if (dayjs(accountDetails.createdAt).isBefore(dayjs(startDate))) {
					periodStartingBalance = parseNumericValue(
						accountDetails.currentBalance ?? 0,
					);
				} else {
					periodStartingBalance = 0; // La cuenta se creó dentro o después del período, saldo inicial 0 para el período
				}
			}

			const transactionsInPeriod = await ctx.db.query.Transaction.findMany({
				where: and(
					or(
						eq(Transaction.toAccountId, accountId),
						eq(Transaction.fromAccountId, accountId),
					),
					gte(Transaction.date, dayjs(startDate).startOf("day").toDate()),
					lte(Transaction.date, endOfDayEndDate),
				),
				orderBy: [asc(Transaction.date), asc(Transaction.createdAt)],
				with: {
					fromAccount: {
						with: {
							dictionaryAccount: {
								columns: { name: true, currency: true, accountType: true },
							},
							business: { columns: { name: true } },
						},
					},
					toAccount: {
						with: {
							dictionaryAccount: {
								columns: { name: true, currency: true, accountType: true },
							},
							business: { columns: { name: true } },
						},
					},
					person: { columns: { name: true } },
					category: { columns: { name: true } },
					member: {
						with: { user: { columns: { firstname: true, lastname: true } } },
					},
					transactionGroup: { columns: { operationType: true, name: true } },
				},
			});

			let periodEndingBalance = periodStartingBalance;
			// Recalcular el saldo final iterando sobre las transacciones del período
			for (const tx of transactionsInPeriod) {
				const amountNum = parseNumericValue(tx.amount);
				if (tx.toAccountId === accountId) {
					// Ingreso a nuestra cuenta
					const accountType = tx.toAccount.dictionaryAccount.accountType;
					if (accountType === "ASSET" || accountType === "REVENUE") {
						// DEBIT incrementa
						periodEndingBalance +=
							tx.transactionType === "DEBIT" ? amountNum : -amountNum;
					} else {
						// LIABILITY, REVENUE - CREDIT incrementa
						periodEndingBalance +=
							tx.transactionType === "CREDIT" ? amountNum : -amountNum;
					}
				} else if (tx.fromAccountId === accountId) {
					// Egreso de nuestra cuenta
					const accountType = tx.fromAccount!.dictionaryAccount.accountType; // fromAccount no es null aquí
					if (accountType === "ASSET" || accountType === "REVENUE") {
						// DEBIT incrementa, por lo tanto, una salida (CREDIT en esta perspectiva) disminuye
						periodEndingBalance -= amountNum; // Asumimos que el monto es positivo y el tipo de tx lo define
					} else {
						// LIABILITY, REVENUE - CREDIT incrementa, por lo tanto, una salida (DEBIT en esta perspectiva) disminuye
						periodEndingBalance -= amountNum; // Asumimos que el monto es positivo
					}
				}
			}

			return {
				transactions: transactionsInPeriod,
				periodStartingBalance,
				periodEndingBalance,
			};
		}),
	createMultiple: protectedProcedure
		.input(MultipleTransactionInputSchema)
		.mutation(async ({ ctx, input }) => {
			console.log("[DEBUG] createMultiple: Input received", JSON.stringify(input, null, 2));
			const {
				guildSlug,
				operationDate,
				description,
				mainBusinessId,
				sourceItems,
				targetItems,
				exchangeRates,
			} = input;

			const member = await ctx.db.query.Member.findFirst({
				where: and(
					eq(Member.guildSlug, guildSlug),
					eq(Member.userId, ctx.user.id),
				),
			});
			if (!member) {
				console.error("[DEBUG] createMultiple: Member not authorized.", { guildSlug, userId: ctx.user.id });
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Miembro no autorizado.",
				});
			}
			console.log("[DEBUG] createMultiple: Member authorized", { memberId: member.id });

			const isOneToN = sourceItems.length === 1 && targetItems.length > 0;
			const isNToOne = sourceItems.length > 0 && targetItems.length === 1;
			const isOneToOne = sourceItems.length === 1 && targetItems.length === 1;
			console.log("[DEBUG] createMultiple: Transaction mode determined", { isOneToN, isNToOne, isOneToOne, numSourceItems: sourceItems.length, numTargetItems: targetItems.length });


			if (!isOneToN && !isNToOne && !isOneToOne) {
				console.error("[DEBUG] createMultiple: Unsupported source/target configuration.");
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Configuración de origen/destino no soportada.",
				});
			}

			const dictionaryAccountsData =
				await ctx.db.query.DictionaryAccount.findMany({
					where: eq(DictionaryAccount.guildSlug, guildSlug),
				});

			if (!dictionaryAccountsData || dictionaryAccountsData.length === 0) {
				console.error("[DEBUG] createMultiple: No dictionary accounts found for the guild.", { guildSlug });
				throw new TRPCError({
					code: "NOT_FOUND",
					message:
						"No se encontraron cuentas de diccionario para esta organización.",
				});
			}
			console.log("[DEBUG] createMultiple: Dictionary accounts loaded", { count: dictionaryAccountsData.length });

			const allInvolvedAccountOnBusinessIds = new Set<string>();

			return ctx.db.transaction(async (tx) => {
				let netCashFromSoldChecks = 0;
				let currencyOfSoldChecksNetCash: Currency | undefined = undefined;
				let netCostOfPurchasedChecks = 0;
				let currencyOfPurchasedChecksNetCost: Currency | undefined = undefined;
				console.log("[DEBUG] createMultiple: Starting DB transaction.");
				const transactionGroupId = (
					await tx
						.insert(TransactionGroup)
						.values({
							guildSlug,
							name:
								description ||
								`Transacción Múltiple - ${dayjs(operationDate).format("DD/MM/YY HH:mm")}`,
							businessId: mainBusinessId,
							description: `Op. Múltiple: ${sourceItems.length} origen(es) a ${targetItems.length} destino(s).`,
							operationType: "MULTIPLE",
						})
						.returning({ id: TransactionGroup.id })
				)[0]?.id;

				if (!transactionGroupId) {
					console.error("[DEBUG] createMultiple: Failed to create TransactionGroup.");
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Error al crear TransactionGroup.",
					});
				}
				console.log("[DEBUG] createMultiple: TransactionGroup created", { transactionGroupId });

				let transactionDateCounter = 0;
				const getSequentialDate = () =>
					dayjs(operationDate).add(++transactionDateCounter, "second").toDate();

				const findOrCreateAccountOnBusinessDirect = async (
					dictionaryAccountIdOrSlug: string,
					businessId: string,
					currencyForSystemAccount: (typeof CurrencyEnum.enumValues)[number],
				): Promise<
					typeof AccountOnBusiness.$inferSelect & {
						dictionaryAccount: typeof DictionaryAccount.$inferSelect;
					}
				> => {
					console.log(`[DEBUG] findOrCreateAccountOnBusinessDirect: Called with`, { dictionaryAccountIdOrSlug, businessId, currencyForSystemAccount });
					let dictionaryAccount:
						| (typeof DictionaryAccount.$inferSelect & {
							currency: (typeof CurrencyEnum.enumValues)[number];
						})
						| undefined;

					const isUUID =
						/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
							dictionaryAccountIdOrSlug,
						);

					if (isUUID) {
						console.log(`[DEBUG] findOrCreateAoB: dictionaryAccountIdOrSlug is UUID, searching by ID: ${dictionaryAccountIdOrSlug}`);
						dictionaryAccount = (await tx.query.DictionaryAccount.findFirst({
							where: eq(DictionaryAccount.id, dictionaryAccountIdOrSlug),
						})) as
							| (typeof DictionaryAccount.$inferSelect & {
								currency: (typeof CurrencyEnum.enumValues)[number];
							})
							| undefined;
					}

					if (!dictionaryAccount) {
						const potentialSlug = dictionaryAccountIdOrSlug;
						console.log(`[DEBUG] findOrCreateAoB: Not found by ID or not UUID, treating as slug: ${potentialSlug}`);
						if (
							[
								"carteradecheques",
								"interesescobrados",
								"pesificacion",
								"efectivo",
							].includes(potentialSlug)
						) {
							console.log(`[DEBUG] findOrCreateAoB: Is system slug. Searching with currency: ${currencyForSystemAccount}`);
							dictionaryAccount = (await tx.query.DictionaryAccount.findFirst({
								where: and(
									eq(DictionaryAccount.slug, potentialSlug),
									eq(DictionaryAccount.guildSlug, guildSlug),
									eq(DictionaryAccount.currency, currencyForSystemAccount),
								),
							})) as
								| (typeof DictionaryAccount.$inferSelect & {
									currency: (typeof CurrencyEnum.enumValues)[number];
								})
								| undefined;

							if (!dictionaryAccount) {
								console.log(`[DEBUG] findOrCreateAoB: System DictionaryAccount not found for ${potentialSlug} in ${currencyForSystemAccount}. Creating it.`);
								const insertedDict = (
									await tx
										.insert(DictionaryAccount)
										.values({
											name:
												potentialSlug.charAt(0).toUpperCase() +
												potentialSlug.slice(1),
											slug: potentialSlug,
											guildSlug: guildSlug,
											accountType:
												potentialSlug === "efectivo" ||
													potentialSlug === "carteradecheques"
													? "ASSET"
													: "REVENUE",
											currency: currencyForSystemAccount,
											checkAccount: potentialSlug === "carteradecheques",
											availability: false,
											hasSubAccounts: false,
										})
										.returning()
								)[0];
								if (!insertedDict) {
									console.error(`[DEBUG] findOrCreateAoB: FAILED to create DictionaryAccount for ${potentialSlug} in ${currencyForSystemAccount}`);
									throw new TRPCError({
										code: "INTERNAL_SERVER_ERROR",
										message: `No se pudo crear DictionaryAccount para ${potentialSlug} en ${currencyForSystemAccount}`,
									});
								}
								console.log(`[DEBUG] findOrCreateAoB: Successfully created system DictionaryAccount: ${insertedDict.id}`);
								dictionaryAccount =
									insertedDict as typeof DictionaryAccount.$inferSelect & {
										currency: (typeof CurrencyEnum.enumValues)[number];
									};
							} else {
								console.log(`[DEBUG] findOrCreateAoB: Found existing system DictionaryAccount: ${dictionaryAccount.id}`);
							}
						}
					}
					if (!dictionaryAccount) {
						console.error(`[DEBUG] findOrCreateAoB: DictionaryAccount '${dictionaryAccountIdOrSlug}' ultimately NOT FOUND.`);
						throw new TRPCError({
							code: "NOT_FOUND",
							message: `DictionaryAccount '${dictionaryAccountIdOrSlug}' no encontrado.`,
						});
					}
					console.log(`[DEBUG] findOrCreateAoB: Using DictionaryAccount: ${dictionaryAccount.id} (${dictionaryAccount.name})`);

					let accountOnBusiness = await tx.query.AccountOnBusiness.findFirst({
						where: and(
							eq(AccountOnBusiness.dictionaryAccountId, dictionaryAccount.id),
							eq(AccountOnBusiness.businessId, businessId),
							eq(AccountOnBusiness.subAccount, false),
						),
						with: { dictionaryAccount: true },
					});

					if (!accountOnBusiness) {
						console.log(`[DEBUG] findOrCreateAoB: AccountOnBusiness not found for DA ${dictionaryAccount.id} and Business ${businessId}. Creating it.`);
						const newAoBId = (
							await tx
								.insert(AccountOnBusiness)
								.values({
									dictionaryAccountId: dictionaryAccount.id,
									businessId: businessId,
									currentBalance: "0",
									subAccount: false,
								})
								.returning({ id: AccountOnBusiness.id })
						)[0]?.id;
						if (!newAoBId) {
							console.error(`[DEBUG] findOrCreateAoB: FAILED to create AccountOnBusiness.`);
							throw new TRPCError({
								code: "INTERNAL_SERVER_ERROR",
								message: "No se pudo crear AccountOnBusiness",
							});
						}
						console.log(`[DEBUG] findOrCreateAoB: Successfully created AccountOnBusiness: ${newAoBId}. Fetching it now.`);

						const newFetchedAoB = await tx.query.AccountOnBusiness.findFirst({
							where: eq(AccountOnBusiness.id, newAoBId),
							with: { dictionaryAccount: true },
						});
						if (!newFetchedAoB) {
							console.error(`[DEBUG] findOrCreateAoB: FAILED to re-fetch newly created AccountOnBusiness: ${newAoBId}`);
							throw new TRPCError({
								code: "INTERNAL_SERVER_ERROR",
								message: "No se pudo re-obtener AccountOnBusiness",
							});
						}
						accountOnBusiness = newFetchedAoB;
						console.log(`[DEBUG] findOrCreateAoB: Successfully fetched new AccountOnBusiness: ${accountOnBusiness.id}`);
					} else {
						console.log(`[DEBUG] findOrCreateAoB: Found existing AccountOnBusiness: ${accountOnBusiness.id}`);
					}

					if (!accountOnBusiness.dictionaryAccount) {
						console.warn(`[DEBUG] findOrCreateAoB: AccountOnBusiness ${accountOnBusiness.id} was missing dictionaryAccount relation. Populating.`);
						const daPopulate = await tx.query.DictionaryAccount.findFirst({
							where: eq(
								DictionaryAccount.id,
								accountOnBusiness.dictionaryAccountId,
							),
						});
						if (!daPopulate) {
							console.error(`[DEBUG] findOrCreateAoB: CRITICAL - DictionaryAccount ${accountOnBusiness.dictionaryAccountId} not found during population.`);
							throw new TRPCError({
								code: "INTERNAL_SERVER_ERROR",
								message: "Error crítico: DictionaryAccount no encontrado.",
							});
						}
						accountOnBusiness.dictionaryAccount = daPopulate;
					}
					console.log(`[DEBUG] findOrCreateAccountOnBusinessDirect: Returning AoB: ${accountOnBusiness.id} with DA: ${accountOnBusiness.dictionaryAccount.id} (${accountOnBusiness.dictionaryAccount.name})`);
					return accountOnBusiness as typeof AccountOnBusiness.$inferSelect & {
						dictionaryAccount: typeof DictionaryAccount.$inferSelect & {
							currency: (typeof CurrencyEnum.enumValues)[number];
						};
					};
				};

				const getExchangeRate = (from: Currency, to: Currency): number => {
					if (from === to) return 1;
					const rateInfo = exchangeRates.find(
						(r) =>
							(r.fromCurrency === from && r.toCurrency === to) ||
							(r.fromCurrency === to && r.toCurrency === from),
					);
					if (!rateInfo || !rateInfo.rate) {
						console.error(`[DEBUG] getExchangeRate: Missing exchange rate between ${from} and ${to}`);
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `Falta tasa de cambio entre ${from} y ${to}`,
						});
					}
					const rate = parseFloat(rateInfo.rate);
					if (isNaN(rate) || rate === 0) {
						console.error(`[DEBUG] getExchangeRate: Invalid exchange rate for ${from}-${to}: ${rateInfo.rate}`);
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `Tasa de cambio inválida para ${from}-${to}`,
						});
					}
					if (rateInfo.fromCurrency === from) return rate;
					return 1 / rate;
				};

				console.log("[DEBUG] createMultiple: Starting processing of TARGET items (Purchase Checks).");
				for (const item of targetItems) {
					if (item.type === "pendingPurchaseCheck") {
						console.log("[DEBUG] createMultiple: Processing a pendingPurchaseCheck in targetItems", JSON.stringify(item, null, 2));
						const checkInput = item.purchaseDetails;
						const purchaseDataValues = calculatePurchaseValues(
							checkInput.grossValue,
							checkInput.monthlyInterestRate,
							checkInput.serviceFeeRate,
							checkInput.collectionDate,
							checkInput.bankClearing,
							checkInput.purchaseDate,
						);
						console.log("[DEBUG] createMultiple: PurchaseDataValues calculated", JSON.stringify(purchaseDataValues, null, 2));

						const createdCheck = (
							await tx
								.insert(Check)
								.values({
									purchaseDate: checkInput.purchaseDate,
									collectionDate: checkInput.collectionDate,
									serviceFeeRate: formatForStorage(
										purchaseDataValues.serviceFeeRate,
									),
									monthlyInterestRate: formatForStorage(
										purchaseDataValues.monthlyInterestRate,
									),
									carriedInterestRate: formatForStorage(
										purchaseDataValues.carriedInterestRate,
									),
									bankClearing: purchaseDataValues.bankClearing,
									grossValue: formatForStorage(purchaseDataValues.grossValue),
									netValue: formatForStorage(purchaseDataValues.netValue),
									serviceFeeAmount: formatForStorage(
										purchaseDataValues.serviceFeeAmount,
									),
									interestRateAmount: formatForStorage(
										purchaseDataValues.interestAmount,
									),
									currency: checkInput.currency,
									checkWriter: checkInput.checkWriter,
									checkNumber: checkInput.checkNumber,
									businessId: checkInput.businessId,
									bankName: checkInput.bankName,
									about: checkInput.about,
									guildSlug: guildSlug,
									memberId: member.id,
									personId: checkInput.personId,
									status: "PURCHASED",
								})
								.returning()
						)[0];
						if (!createdCheck) {
							console.error("[DEBUG] createMultiple: Error creating purchase check", JSON.stringify(checkInput, null, 2));
							throw new TRPCError({
								code: "INTERNAL_SERVER_ERROR",
								message: `Error creando cheque de compra: ${checkInput.checkNumber}`,
							});
						}
						console.log("[DEBUG] createMultiple: Purchase check created", { checkId: createdCheck.id });
						await tx
							.insert(CheckOnTransactionGroup)
							.values({ checkId: createdCheck.id, transactionGroupId });
						console.log("[DEBUG] createMultiple: CheckOnTransactionGroup created for purchase check", { checkId: createdCheck.id, transactionGroupId });

						const cashAoB = await findOrCreateAccountOnBusinessDirect(
							"efectivo",
							checkInput.businessId,
							checkInput.currency,
						);
						const walletAoB = await findOrCreateAccountOnBusinessDirect(
							"carteradecheques",
							checkInput.businessId,
							checkInput.currency,
						);
						const interestAoB = await findOrCreateAccountOnBusinessDirect(
							"interesescobrados",
							checkInput.businessId,
							checkInput.currency,
						);
						const feeAoB = await findOrCreateAccountOnBusinessDirect(
							"pesificacion",
							checkInput.businessId,
							checkInput.currency,
						);
						console.log("[DEBUG] createMultiple: System accounts for purchase check ensured", { cashAoBId: cashAoB.id, walletAoBId: walletAoB.id, interestAoBId: interestAoB.id, feeAoBId: feeAoB.id });


						[cashAoB.id, walletAoB.id, interestAoB.id, feeAoB.id].forEach(
							(id) => allInvolvedAccountOnBusinessIds.add(id),
						);

						// The commented out cashAoB operation for purchase was:
						// {
						//   acc: cashAoB,
						//   bal:
						//     parseNumericValue(cashAoB.currentBalance ?? 0) -
						//     purchaseDataValues.netValue,
						//   type: "CREDIT",
						//   amt: purchaseDataValues.netValue,
						//   about: `Salida efectivo por compra cheque ${createdCheck.checkNumber ?? ""}`,
						// },
						const ops = [
							// {
							// 	acc: walletAoB,
							// 	bal:
							// 		parseNumericValue(walletAoB.currentBalance ?? 0) +
							// 		purchaseDataValues.grossValue,
							// 	type: "DEBIT",
							// 	amt: purchaseDataValues.grossValue,
							// 	about: `Ingreso a cartera por compra cheque ${createdCheck.checkNumber ?? ""}`,
							// },
							{
								acc: interestAoB,
								bal:
									parseNumericValue(interestAoB.currentBalance ?? 0) +
									purchaseDataValues.interestAmount,
								type: "DEBIT",
								amt: purchaseDataValues.interestAmount,
								about: `Intereses por compra cheque ${createdCheck.checkNumber ?? ""}`,
							},
							{
								acc: feeAoB,
								bal:
									parseNumericValue(feeAoB.currentBalance ?? 0) +
									purchaseDataValues.serviceFeeAmount,
								type: "DEBIT",
								amt: purchaseDataValues.serviceFeeAmount,
								about: `Comisión por compra cheque ${createdCheck.checkNumber ?? ""}`,
							},
						];

						for (const op of ops) {
							if (op.amt !== 0) {
								const txDate = getSequentialDate();
								console.log("[DEBUG] createMultiple: Creating transaction for purchase check op", JSON.stringify(op, null, 2));
								await tx.insert(Transaction).values({
									date: txDate,
									amount: formatForStorage(Math.abs(op.amt)),
									balance: formatForStorage(op.bal),
									transactionType: op.type as "DEBIT" | "CREDIT",
									toAccountId: op.acc.id,
									memberId: member.id,
									personId: checkInput.personId,
									transactionGroupId,
									about: op.about,
								});
								await tx
									.update(AccountOnBusiness)
									.set({
										currentBalance: formatForStorage(op.bal),
										lastTransactionDate: txDate,
									})
									.where(eq(AccountOnBusiness.id, op.acc.id));
							}
						}
					}
				}
				console.log("[DEBUG] createMultiple: Finished processing TARGET items (Purchase Checks).");

				console.log("[DEBUG] createMultiple: Starting processing of SOURCE items (Sale Checks).");
				for (const item of sourceItems) {
					if (item.type === "pendingSaleCheck") {
						console.log("[DEBUG] createMultiple: Processing a pendingSaleCheck in sourceItems", JSON.stringify(item, null, 2));
						const { checkToSell, saleDetails } = item;
						const originalCheck = await tx.query.Check.findFirst({
							where: eq(Check.id, checkToSell.id),
						});
						if (
							!originalCheck ||
							originalCheck.status === "SOLD" ||
							originalCheck.status === "DEPOSITED"
						) {
							console.error("[DEBUG] createMultiple: Check not available for sale", { checkId: checkToSell.id, currentStatus: originalCheck?.status });
							throw new TRPCError({
								code: "BAD_REQUEST",
								message: `Cheque ${checkToSell.id} no disponible para venta.`,
							});
						}
						console.log("[DEBUG] createMultiple: Original check for sale found", { checkId: originalCheck.id, status: originalCheck.status });


						const saleDataValues = calculateSaleValues(
							originalCheck.grossValue,
							saleDetails.monthlyInterestRate,
							saleDetails.serviceFeeRate,
							originalCheck.collectionDate,
							originalCheck.bankClearing?.toString() ?? "0",
							saleDetails.saleDate,
						);
						console.log("[DEBUG] createMultiple: SaleDataValues calculated", JSON.stringify(saleDataValues, null, 2));


						await tx
							.update(Check)
							.set({
								status: "SOLD",
								saleDate: saleDetails.saleDate,
								saleMonthlyInterestRate: saleDetails.monthlyInterestRate,
								saleServiceFeeRate: saleDetails.serviceFeeRate,
								saleCarriedInterestRate: formatForStorage(
									saleDataValues.carriedInterestRate,
								),
								saleInterestRateAmount: formatForStorage(
									saleDataValues.interestAmount,
								),
								saleServiceFeeAmount: formatForStorage(
									saleDataValues.serviceFeeAmount,
								),
								saleNetValue: formatForStorage(saleDataValues.netValue),
								saleGrossValue: formatForStorage(saleDataValues.grossValue),
							})
							.where(eq(Check.id, originalCheck.id));
						console.log("[DEBUG] createMultiple: Sale check updated", { checkId: originalCheck.id });
						await tx
							.insert(CheckOnTransactionGroup)
							.values({ checkId: originalCheck.id, transactionGroupId });
						console.log("[DEBUG] createMultiple: CheckOnTransactionGroup created for sale check", { checkId: originalCheck.id, transactionGroupId });

						const cashAoB = await findOrCreateAccountOnBusinessDirect(
							"efectivo",
							saleDetails.businessId,
							originalCheck.currency,
						);
						const walletAoB = await findOrCreateAccountOnBusinessDirect(
							"carteradecheques",
							saleDetails.businessId,
							originalCheck.currency,
						);
						const interestAoB = await findOrCreateAccountOnBusinessDirect(
							"interesescobrados",
							saleDetails.businessId,
							originalCheck.currency,
						);
						const feeAoB = await findOrCreateAccountOnBusinessDirect(
							"pesificacion",
							saleDetails.businessId,
							originalCheck.currency,
						);
						console.log("[DEBUG] createMultiple: System accounts for sale check ensured", { cashAoBId: cashAoB.id, walletAoBId: walletAoB.id, interestAoBId: interestAoB.id, feeAoBId: feeAoB.id });


						[walletAoB.id, interestAoB.id, feeAoB.id].forEach(
							(id) => allInvolvedAccountOnBusinessIds.add(id),
						);

						// The commented out cashAoB operation for sale was:
						// {
						//   acc: cashAoB,
						//   bal:
						//     parseNumericValue(cashAoB.currentBalance ?? 0) +
						//     saleDataValues.netValue,
						//   type: "DEBIT",
						//   amt: saleDataValues.netValue,
						//   about: `Ingreso efectivo por venta cheque ${originalCheck.checkNumber ?? ""}`,
						// },
						const ops = [
							// {
							// 	acc: walletAoB,
							// 	// bal: // bal is calculated dynamically below
							// 	//   parseNumericValue(walletAoB.currentBalance ?? 0) -
							// 	//   saleDataValues.grossValue, //This was direct subtraction, now it's current + op.amt
							// 	// type: "CREDIT", // type is calculated dynamically below
							// 	amt: -saleDataValues.grossValue, // Negative for asset decrease
							// 	about: `Salida de cartera por venta cheque ${originalCheck.checkNumber ?? ""}`,
							// },
							{
								acc: interestAoB,
								// bal: // bal is calculated dynamically below
								//   parseNumericValue(interestAoB.currentBalance ?? 0) -
								//   saleDataValues.interestAmount,
								// type: "CREDIT", // type is calculated dynamically below
								amt: saleDataValues.interestAmount, // Negative for revenue decrease (reversal)
								about: `Reversión intereses por venta cheque ${originalCheck.checkNumber ?? ""}`,
							},
							{
								acc: feeAoB,
								// bal: // bal is calculated dynamically below
								//   parseNumericValue(feeAoB.currentBalance ?? 0) -
								//   saleDataValues.serviceFeeAmount,
								// type: "CREDIT", // type is calculated dynamically below
								amt: saleDataValues.serviceFeeAmount, // Negative for revenue decrease (reversal)
								about: `Reversión comisión por venta cheque ${originalCheck.checkNumber ?? ""}`,
							},
						];

						for (const op of ops) {
							if (op.amt !== 0) {
								const currentBalance = parseNumericValue(
									op.acc.currentBalance ?? "0",
								);
								const newBalance = currentBalance + op.amt; // op.amt is negative here, effectively subtracting

								let finalTxType: "DEBIT" | "CREDIT";
								if (
									op.acc.dictionaryAccount.accountType === "ASSET" ||
									op.acc.dictionaryAccount.accountType === "REVENUE" // Expenses increase with debit, decrease with credit
								) {
									finalTxType = op.amt > 0 ? "DEBIT" : "CREDIT"; // For asset, op.amt < 0 means CREDIT
								} else {
									// LIABILITY or REVENUE. Revenues increase with credit, decrease with debit.
									finalTxType = op.amt > 0 ? "CREDIT" : "DEBIT"; // For revenue, op.amt < 0 means DEBIT
								}
								console.log("[DEBUG] createMultiple: Creating transaction for sale check op", { op_about: op.about, op_amt: op.amt, currentBalance, newBalance, finalTxType, accountType: op.acc.dictionaryAccount.accountType });


								const txDate = getSequentialDate();
								const aboutMessage =
									op.acc.id === cashAoB.id
										? `Ingreso efectivo por venta cheque ${originalCheck.checkNumber ?? ""}`
										: op.acc.id === walletAoB.id
											? `Salida de cartera por venta cheque ${originalCheck.checkNumber ?? ""}`
											: op.acc.id === interestAoB.id
												? `Intereses cedidos por venta cheque ${originalCheck.checkNumber ?? ""}`
												: op.acc.id === feeAoB.id
													? `Comisión/Pesificación cedida por venta cheque ${originalCheck.checkNumber ?? ""}`
													: "Operación de venta de cheque";

								await tx.insert(Transaction).values({
									date: txDate,
									amount: formatForStorage(Math.abs(op.amt)),
									balance: formatForStorage(newBalance),
									transactionType: finalTxType,
									toAccountId: op.acc.id,
									memberId: member.id,
									personId: saleDetails.personId,
									transactionGroupId,
									about: aboutMessage, // Using the specific about message
								});

								await tx
									.update(AccountOnBusiness)
									.set({
										currentBalance: formatForStorage(newBalance),
										lastTransactionDate: txDate,
									})
									.where(eq(AccountOnBusiness.id, op.acc.id));
							}

						}

						if (!currencyOfSoldChecksNetCash) {
							currencyOfSoldChecksNetCash = originalCheck!.currency;
						}

						if (originalCheck!.currency === currencyOfSoldChecksNetCash) {
							netCashFromSoldChecks += saleDataValues.netValue;
						} else {
							// Necesitas getRate para convertir saleValues.netValue a currencyOfSoldChecksNetCash
							const rateToRef = getExchangeRate(originalCheck!.currency, currencyOfSoldChecksNetCash!); // Asegúrate que getRate esté definida y accesible
							netCashFromSoldChecks += saleDataValues.netValue * rateToRef;
						}
						console.log(`[DEBUG] After processing Sale Check ${checkToSell.id}: netCashFromSoldChecks=${netCashFromSoldChecks} ${currencyOfSoldChecksNetCash}`);
					}


				}

				console.log("[DEBUG] createMultiple: Finished processing SOURCE items (Sale Checks).");
				console.log("------------------------------------------------------------------");
				console.log("[DEBUG] createMultiple: Starting processing of NORMAL account transfers.");
				console.log("[DEBUG] createMultiple: Current modes:", { isOneToOne, isOneToN, isNToOne });
				console.log("[DEBUG] createMultiple: Filtered sourceItems for normal tx:", JSON.stringify(sourceItems.filter(item => item.type === 'account'), null, 2));
				console.log("[DEBUG] createMultiple: Filtered targetItems for normal tx:", JSON.stringify(targetItems.filter(item => item.type === 'account'), null, 2));
				console.log("------------------------------------------------------------------");

				// --- PROCESAR TRANSFERENCIAS ENTRE CUENTAS "NORMALES" ---
				if (isOneToOne) {
					const sourceItem = sourceItems[0]!;
					const targetItem = targetItems[0]!;
					let fromAoB: AccountOnBusinessSchema & { dictionaryAccount: DictionaryAccountSchema & { currency: Currency; accountType: AccountType; }; };
					let toAoB: AccountOnBusinessSchema & { dictionaryAccount: DictionaryAccountSchema & { currency: Currency; accountType: AccountType; }; };
					let amountToTransferFromSource: number;
					let effectiveTargetAmount: number;
					let personIdFromSource: string | null | undefined = null;
					let personIdForTarget: string | null | undefined = null;
					let saleValues
					if (sourceItem.type === 'account') {
						const sourceDict = dictionaryAccountsData.find(d => d.id === sourceItem.dictionaryAccountId);
						if (!sourceDict) throw new TRPCError({ code: "NOT_FOUND", message: `Dict. origen ${sourceItem.dictionaryAccountId} no hallado.` });
						fromAoB = await findOrCreateAccountOnBusinessDirect(sourceItem.dictionaryAccountId, sourceItem.businessId, sourceDict.currency as Currency);
						amountToTransferFromSource = parseNumericValue(sourceItem.amount);
						// personIdFromSource = sourceItem.personId;
					} else { // pendingSaleCheck
						const { checkToSell, saleDetails } = sourceItem;
						const originalCheck = await tx.query.Check.findFirst({ where: eq(Check.id, checkToSell.id) });
						if (!originalCheck) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Cheque de venta no encontrado" });
						fromAoB = await findOrCreateAccountOnBusinessDirect("carteradecheques", saleDetails.businessId, originalCheck.currency); // Origen es Cartera
						amountToTransferFromSource = netCashFromSoldChecks; // Usar el neto calculado
						personIdFromSource = saleDetails.personId;
						const saleOpDate = saleDetails.saleDate || operationDate;
						saleValues = calculateSaleValues(
							originalCheck!.grossValue, // Usar ! si estás seguro que no es null después de la validación
							saleDetails.monthlyInterestRate,
							saleDetails.serviceFeeRate,
							originalCheck!.collectionDate,
							originalCheck!.bankClearing?.toString() ?? "0",
							saleOpDate,
						);
					}

					if (targetItem.type === 'account') {
						const targetDict = dictionaryAccountsData.find(d => d.id === targetItem.dictionaryAccountId);
						if (!targetDict) throw new TRPCError({ code: "NOT_FOUND", message: `Dict. destino ${targetItem.dictionaryAccountId} no hallado.` });
						toAoB = await findOrCreateAccountOnBusinessDirect(targetItem.dictionaryAccountId, targetItem.businessId, targetDict.currency as Currency);
						effectiveTargetAmount = parseNumericValue(targetItem.amount);
						// personIdForTarget = targetItem.personId;
					} else { // pendingPurchaseCheck
						const checkInput = targetItem.purchaseDetails;
						// El "destino" del dinero es la operación de compra, representada por su Cartera de Cheques.
						toAoB = await findOrCreateAccountOnBusinessDirect("carteradecheques", checkInput.businessId, checkInput.currency);
						effectiveTargetAmount = netCostOfPurchasedChecks; // El costo neto es lo que se "recibe" en este contexto
						personIdForTarget = checkInput.personId;
					}

					const rate = getExchangeRate(fromAoB.dictionaryAccount.currency, toAoB.dictionaryAccount.currency);
					const amountReceivedAtTargetConsideringRate = amountToTransferFromSource * rate;

					// Para 1:1, el monto que llega al destino debe ser el monto especificado para el destino si es una cuenta,
					// o el monto convertido del origen si el destino es una compra de cheque.
					const finalAmountForTargetTransaction = targetItem.type === 'account' ? effectiveTargetAmount : amountReceivedAtTargetConsideringRate;


					let fromTxType: TransactionType = (fromAoB.dictionaryAccount.accountType === "ASSET" || fromAoB.dictionaryAccount.accountType === "REVENUE") ? "CREDIT" : "DEBIT";
					let newFromBal = parseNumericValue(fromAoB.currentBalance ?? "0") - amountToTransferFromSource;

					let toTxType: TransactionType = (toAoB.dictionaryAccount.accountType === "ASSET" || toAoB.dictionaryAccount.accountType === "REVENUE") ? "DEBIT" : "CREDIT";
					let newToBal = parseNumericValue(toAoB.currentBalance ?? "0") + finalAmountForTargetTransaction;

					const date1 = getSequentialDate(); const date2 = getSequentialDate();
					await tx.insert(Transaction).values([
						{ date: date1, amount: formatForStorage(amountToTransferFromSource), balance: formatForStorage(newFromBal), transactionType: fromTxType, toAccountId: fromAoB.id, memberId: member.id, transactionGroupId: transactionGroupId, personId: personIdFromSource, about: `Salida Multiple (1:1) -> ${toAoB.dictionaryAccount.name}` },
						{ date: date2, amount: formatForStorage(finalAmountForTargetTransaction), balance: formatForStorage(newToBal), transactionType: toTxType, toAccountId: toAoB.id, fromAccountId: fromAoB.id, memberId: member.id, transactionGroupId: transactionGroupId, personId: personIdForTarget, about: `Entrada Multiple (1:1) <- ${fromAoB.dictionaryAccount.name}`, exchangeRate: rate !== 1 ? formatForStorage(rate) : undefined }
					]);
					await tx.update(AccountOnBusiness).set({ currentBalance: formatForStorage(newFromBal), lastTransactionDate: date1 }).where(eq(AccountOnBusiness.id, fromAoB.id));
					await tx.update(AccountOnBusiness).set({ currentBalance: formatForStorage(newToBal), lastTransactionDate: date2 }).where(eq(AccountOnBusiness.id, toAoB.id));
					allInvolvedAccountOnBusinessIds.add(fromAoB.id).add(toAoB.id);

				} else if (isOneToN) {
					console.log("[DEBUG] createMultiple: Processing 1:N transfer.");
					const sourceItemDefinition = sourceItems[0]!;
					let fromAoB_Main: AccountOnBusinessSchema & { dictionaryAccount: DictionaryAccountSchema & { currency: Currency; accountType: AccountType; }; };
					let totalAmountFromSource_Main: number; // Este es el monto total que sale del origen único en su propia moneda
					let personIdForSource_Main: string | null | undefined = null;
					let sourceCurrency_Main: Currency;

					if (sourceItemDefinition.type === 'account') {
						const sourceDict = dictionaryAccountsData.find(d => d.id === sourceItemDefinition.dictionaryAccountId);
						if (!sourceDict) throw new TRPCError({ code: "NOT_FOUND", message: `Dict. origen ${sourceItemDefinition.dictionaryAccountId} no hallado.` });
						fromAoB_Main = await findOrCreateAccountOnBusinessDirect(sourceItemDefinition.dictionaryAccountId, sourceItemDefinition.businessId, sourceDict.currency as Currency);
						totalAmountFromSource_Main = parseNumericValue(sourceItemDefinition.amount);
						// personIdForSource_Main = sourceItemDefinition.personId;
						sourceCurrency_Main = fromAoB_Main.dictionaryAccount.currency;
					} else { // pendingSaleCheck
						const { checkToSell, saleDetails } = sourceItemDefinition;
						// El "origen" del valor neto es la cuenta Cartera de Cheques de la empresa que vendió.
						fromAoB_Main = await findOrCreateAccountOnBusinessDirect("carteradecheques", saleDetails.businessId, checkToSell.currency);
						totalAmountFromSource_Main = netCashFromSoldChecks; // Usar el neto calculado previamente
						personIdForSource_Main = saleDetails.personId;
						sourceCurrency_Main = checkToSell.currency; // La moneda del neto de la venta
					}

					const fromTxType_Main: TransactionType = (fromAoB_Main.dictionaryAccount.accountType === "ASSET" || fromAoB_Main.dictionaryAccount.accountType === "REVENUE") ? "CREDIT" : "DEBIT";
					const newFromBalance_Main = parseNumericValue(fromAoB_Main.currentBalance ?? "0") - totalAmountFromSource_Main;
					const sourceTxDate_Main = getSequentialDate();

					await tx.insert(Transaction).values({
						date: sourceTxDate_Main, amount: formatForStorage(totalAmountFromSource_Main), balance: formatForStorage(newFromBalance_Main),
						transactionType: fromTxType_Main, toAccountId: fromAoB_Main.id, memberId: member.id, transactionGroupId: transactionGroupId,
						personId: personIdForSource_Main ?? undefined,
						about: `Salida Principal (1:N) para ${targetItems.length} destino(s)`
					});
					await tx.update(AccountOnBusiness).set({ currentBalance: formatForStorage(newFromBalance_Main), lastTransactionDate: sourceTxDate_Main }).where(eq(AccountOnBusiness.id, fromAoB_Main.id));
					allInvolvedAccountOnBusinessIds.add(fromAoB_Main.id);

					for (const targetItem of targetItems) {
						let toAoB_Target: AccountOnBusinessSchema & { dictionaryAccount: DictionaryAccountSchema & { currency: Currency; accountType: AccountType; }; };
						let amountToCreditTargetInItsCurrency: number;
						let personIdForTarget_Item: string | null | undefined = null;

						if (targetItem.type === 'account') {
							const targetDict = dictionaryAccountsData.find(d => d.id === targetItem.dictionaryAccountId);
							if (!targetDict) throw new TRPCError({ code: "NOT_FOUND", message: `Dict. destino ${targetItem.dictionaryAccountId} no hallado.` });
							toAoB_Target = await findOrCreateAccountOnBusinessDirect(targetItem.dictionaryAccountId, targetItem.businessId, targetDict.currency as Currency);
							amountToCreditTargetInItsCurrency = parseNumericValue(targetItem.amount);
							// personIdForTarget_Item = targetItem.personId;
						} else { // pendingPurchaseCheck
							const checkInput = targetItem.purchaseDetails;
							// La "cuenta destino" de este flujo es la Cartera de Cheques donde ingresa el cheque comprado.
							toAoB_Target = await findOrCreateAccountOnBusinessDirect("carteradecheques", checkInput.businessId, checkInput.currency);
							// El monto que "llega" a esta cartera es el GROSS value del cheque.
							// El NETO (costo) de la compra es lo que el origen principal (fromAoB_Main) debe cubrir.
							amountToCreditTargetInItsCurrency = parseNumericValue(checkInput.grossValue); // Lo que entra a Cartera
							personIdForTarget_Item = checkInput.personId;
						}

						const rate = getExchangeRate(sourceCurrency_Main, toAoB_Target.dictionaryAccount.currency);
						const toTxType_Target: TransactionType = (toAoB_Target.dictionaryAccount.accountType === "ASSET" || toAoB_Target.dictionaryAccount.accountType === "REVENUE") ? "DEBIT" : "CREDIT";
						const newToBalance_Target = parseNumericValue(toAoB_Target.currentBalance ?? "0") + amountToCreditTargetInItsCurrency;

						const targetTxDate_Item = getSequentialDate();
						await tx.insert(Transaction).values({
							date: targetTxDate_Item, amount: formatForStorage(amountToCreditTargetInItsCurrency), balance: formatForStorage(newToBalance_Target),
							transactionType: toTxType_Target, toAccountId: toAoB_Target.id, fromAccountId: fromAoB_Main.id,
							memberId: member.id, personId: personIdForTarget_Item ?? undefined,
							transactionGroupId: transactionGroupId, about: `Entrada (1:N) desde ${fromAoB_Main.dictionaryAccount.name}`,
							exchangeRate: (sourceCurrency_Main !== toAoB_Target.dictionaryAccount.currency) ? formatForStorage(rate) : undefined
						});
						await tx.update(AccountOnBusiness).set({ currentBalance: formatForStorage(newToBalance_Target), lastTransactionDate: targetTxDate_Item }).where(eq(AccountOnBusiness.id, toAoB_Target.id));
						allInvolvedAccountOnBusinessIds.add(toAoB_Target.id);
					}

				} else if (isNToOne) { // Múltiples Orígenes a Un Destino Único
					console.log("[DEBUG] createMultiple: Processing N:1 scenario.");
					const singleTargetItemDefinition = targetItems[0]!;
					let toAoB_Main: AccountOnBusinessSchema & { dictionaryAccount: DictionaryAccountSchema & { currency: Currency; accountType: AccountType; }; };
					let totalAmountToCreditTargetInItsCurrency: number; // Este es el monto que el destino DEBE recibir en su propia moneda.
					let personIdForTarget_Main: string | null | undefined = null;

					if (singleTargetItemDefinition.type === 'account') {
						const targetDict = dictionaryAccountsData.find(d => d.id === singleTargetItemDefinition.dictionaryAccountId);
						if (!targetDict) throw new TRPCError({ code: "NOT_FOUND", message: `Dict. destino ${singleTargetItemDefinition.dictionaryAccountId} no hallado.` });
						toAoB_Main = await findOrCreateAccountOnBusinessDirect(singleTargetItemDefinition.dictionaryAccountId, singleTargetItemDefinition.businessId, targetDict.currency as Currency);
						totalAmountToCreditTargetInItsCurrency = parseNumericValue(singleTargetItemDefinition.amount);
						// personIdForTarget_Main = singleTargetItemDefinition.personId;
					} else { // singleTargetItemDefinition.type === 'pendingPurchaseCheck' (TU CASO)
						const checkInput = singleTargetItemDefinition.purchaseDetails;
						// El destino del dinero de los N orígenes es la "Operación Compra de Cheque",
						// representada por la cuenta Cartera de Cheques que recibe el cheque.
						toAoB_Main = await findOrCreateAccountOnBusinessDirect("carteradecheques", checkInput.businessId, checkInput.currency);
						// Lo que se "acredita" a la cartera de cheques como destino de los fondos es el VALOR BRUTO del cheque.
						// El costo neto (netValue) es lo que los N orígenes deben sumar para cubrir.
						totalAmountToCreditTargetInItsCurrency = parseNumericValue(checkInput.grossValue);
						personIdForTarget_Main = checkInput.personId;
						console.log(`[DEBUG] N:1 Target is Purchase Check. Target AoB (Wallet): ${toAoB_Main.id}, Amount to credit to wallet (Gross): ${totalAmountToCreditTargetInItsCurrency} ${toAoB_Main.dictionaryAccount.currency}`);
					}

					// Transacción de ENTRADA al toAoB_Main (sea cuenta directa o Cartera de Cheques por la compra)
					const toTxType_Main: TransactionType = (toAoB_Main.dictionaryAccount.accountType === "ASSET" || toAoB_Main.dictionaryAccount.accountType === "REVENUE") ? "DEBIT" : "CREDIT";
					const newToBalance_Main = parseNumericValue(toAoB_Main.currentBalance ?? "0") + totalAmountToCreditTargetInItsCurrency;
					const targetTxDate_Main = getSequentialDate();

					await tx.insert(Transaction).values({
						date: targetTxDate_Main, amount: formatForStorage(totalAmountToCreditTargetInItsCurrency), balance: formatForStorage(newToBalance_Main),
						transactionType: toTxType_Main, toAccountId: toAoB_Main.id, memberId: member.id, transactionGroupId: transactionGroupId,
						personId: personIdForTarget_Main ?? undefined,
						about: `Entrada Principal (N:1) desde ${sourceItems.length} origen(es)`
					});
					await tx.update(AccountOnBusiness).set({ currentBalance: formatForStorage(newToBalance_Main), lastTransactionDate: targetTxDate_Main }).where(eq(AccountOnBusiness.id, toAoB_Main.id));
					allInvolvedAccountOnBusinessIds.add(toAoB_Main.id);

					// Transacciones de SALIDA para cada origen
					for (const sourceItem of sourceItems) {
						let fromAoB: AccountOnBusinessSchema & { dictionaryAccount: DictionaryAccountSchema & { currency: Currency; accountType: AccountType; }; };
						let amountToDebitFromSourceInItsCurrency: number;
						let personIdForSourceSide: string | null | undefined = null;

						if (sourceItem.type === "account") {
							const sourceDict = dictionaryAccountsData.find(d => d.id === sourceItem.dictionaryAccountId);
							if (!sourceDict) throw new TRPCError({ code: "NOT_FOUND", message: `Dict. origen ${sourceItem.dictionaryAccountId} no hallado.` });
							fromAoB = await findOrCreateAccountOnBusinessDirect(sourceItem.dictionaryAccountId, sourceItem.businessId, sourceDict.currency as Currency);
							amountToDebitFromSourceInItsCurrency = parseNumericValue(sourceItem.amount);
							// personIdForSourceSide = sourceItem.personId;
						} else { // sourceItem.type === "pendingSaleCheck"
							const { checkToSell, saleDetails } = sourceItem;
							const originalCheck = await tx.query.Check.findFirst({ where: eq(Check.id, checkToSell.id) });
							if (!originalCheck) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Cheque de venta (origen N:1) no encontrado" });
							const saleValues = calculateSaleValues(originalCheck.grossValue, saleDetails.monthlyInterestRate, saleDetails.serviceFeeRate, originalCheck.collectionDate, originalCheck.bankClearing?.toString() ?? "0", saleDetails.saleDate || operationDate);
							// Para la venta de cheque, la cuenta que "aporta" el neto es la Cartera de Cheques (de donde salió el cheque).
							fromAoB = await findOrCreateAccountOnBusinessDirect("carteradecheques", saleDetails.businessId, originalCheck.currency);
							amountToDebitFromSourceInItsCurrency = saleValues.netValue; // El neto de la venta es lo que este origen aporta
							personIdForSourceSide = saleDetails.personId;
						}

						const rate = getExchangeRate(fromAoB.dictionaryAccount.currency, toAoB_Main.dictionaryAccount.currency);
						let fromTxType: TransactionType = (fromAoB.dictionaryAccount.accountType === "ASSET" || fromAoB.dictionaryAccount.accountType === "REVENUE") ? "CREDIT" : "DEBIT";
						let newFromBalance = parseNumericValue(fromAoB.currentBalance ?? "0") - amountToDebitFromSourceInItsCurrency;
						const sourceTxDate = getSequentialDate();

						await tx.insert(Transaction).values({
							date: sourceTxDate, amount: formatForStorage(amountToDebitFromSourceInItsCurrency), balance: formatForStorage(newFromBalance),
							transactionType: fromTxType, toAccountId: fromAoB.id,
							fromAccountId: toAoB_Main.id, // La contrapartida de esta salida es el destino único
							memberId: member.id, transactionGroupId: transactionGroupId,
							personId: personIdForSourceSide ?? undefined,
							about: `Salida (N:1) hacia ${toAoB_Main.dictionaryAccount.name}`,
							exchangeRate: (fromAoB.dictionaryAccount.currency !== toAoB_Main.dictionaryAccount.currency) ? formatForStorage(rate) : undefined
						});
						await tx.update(AccountOnBusiness).set({ currentBalance: formatForStorage(newFromBalance), lastTransactionDate: sourceTxDate }).where(eq(AccountOnBusiness.id, fromAoB.id));
						allInvolvedAccountOnBusinessIds.add(fromAoB.id);
					}
				}


				console.log("[DEBUG] createMultiple: Finished processing NORMAL account transfers.");

				console.log("[DEBUG] createMultiple: Starting final balance fixes and parent updates for involved accounts:", Array.from(allInvolvedAccountOnBusinessIds));
				for (const accountId of allInvolvedAccountOnBusinessIds) {
					console.log(`[DEBUG] createMultiple: Processing account ${accountId} for balance fix/parent update.`);
					const acc = await tx.query.AccountOnBusiness.findFirst({
						where: eq(AccountOnBusiness.id, accountId),
						with: { dictionaryAccount: { columns: { id: true } } },
					});
					if (acc?.subAccount && acc.dictionaryAccountId && acc.businessId) {
						console.log(`[DEBUG] createMultiple: Account ${accountId} is subAccount. Intended to call updateParentAccount (currently commented out).`);
						// await updateParentAccount(acc.dictionaryAccountId, acc.businessId, tx); 
					}
					console.log(`[DEBUG] createMultiple: Executing fix_single_account_balance for ${accountId}.`);
					await tx.execute(
						sql`SELECT fix_single_account_balance(${accountId}::uuid);`,
					);
				}
				console.log("[DEBUG] createMultiple: Finished final balance fixes and parent updates.");
				console.log("[DEBUG] createMultiple: Committing DB transaction.");
				return {
					transactionGroupId,
					message: "Transacción múltiple procesada exitosamente.",
				};
			}); // End of db.transaction
		}) // End of mutation
});
