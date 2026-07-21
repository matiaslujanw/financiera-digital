import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, ilike, inArray, lt, ne, or, SQL, sql } from 'drizzle-orm';
import { z } from "zod";
import { AccountOnBusiness, Credit, CreditOnTransactionGroup, Currency, DictionaryAccount, Installment, Member, Person, Transaction, TransactionGroup } from "@acme/db/schema";
import { createCreditSchema, addCapitalToCreditSchema, markCreditInstallmentPaidSchema, settleCreditEarlySchema, GuildSlugCursorSchema, GuildSlugSchema, IdSchema, modifyCreditSchema } from "@acme/validators";
import { dayjs } from "../lib/dayjs";
import { formatForSubmit, updateParentAccount } from "../lib/utils";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { ManipulateType } from "dayjs";

export const creditRouter = createTRPCRouter({
	create: protectedProcedure
		.input(createCreditSchema)
		.mutation(async ({ ctx, input }) => {
			const member = await ctx.db.query.Member.findFirst({ where: and(eq(Member.userId, ctx.user.id), eq(Member.guildSlug, input.guildSlug)) });
			if (!member) throw new TRPCError({ code: 'NOT_FOUND', message: 'Miembro inexistente.' });

			const receivingDictionaryAccount = await ctx.db.query.DictionaryAccount.findFirst({ where: eq(DictionaryAccount.id, input.accountId) });
			if (!receivingDictionaryAccount) throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta de destino no encontrada." });
			if (receivingDictionaryAccount.accountType !== 'ASSET') throw new TRPCError({ code: 'BAD_REQUEST', message: 'La cuenta de destino debe ser de tipo Activo.' });

			const creditCurrency = receivingDictionaryAccount.currency;
			const grossValue = Number.parseFloat(formatForSubmit(input.grossValue));
			const totalInterestToPay = Number.parseFloat(formatForSubmit(input.totalInterestToPay));
			const totalCreditValue = grossValue + totalInterestToPay;
			const numberOfInstallments = input.numberOfInstallments;

			if (grossValue <= 0 || totalInterestToPay < 0 || numberOfInstallments <= 0) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "Valores de monto, interés o cuotas inválidos." });
			}

			const interestPerInstallment = parseFloat((totalInterestToPay / numberOfInstallments).toFixed(4));

			let periodicityUnit: ManipulateType = "month";
			let periodicityMultiplier = 1;
			switch (input.paymentPeriodicity) {
				case "DAILY": periodicityUnit = "day"; break;
				case "WEEKLY": periodicityUnit = "week"; break;
				case "BIWEEKLY": periodicityUnit = "week"; periodicityMultiplier = 2; break;
				case "BIMONTHLY": periodicityUnit = "month"; periodicityMultiplier = 2; break;
				case "QUARTERLY": periodicityUnit = "month"; periodicityMultiplier = 3; break;
				case "SEMIANNUALLY": periodicityUnit = "month"; periodicityMultiplier = 6; break;
				case "ANNUALLY": periodicityUnit = "year"; break;
			}

			const firstPaymentDueDate = dayjs(input.purchaseDate).add(periodicityMultiplier, periodicityUnit).toDate();
			const finalExpectedCollectionDate = dayjs(firstPaymentDueDate).add((numberOfInstallments - 1) * periodicityMultiplier, periodicityUnit).toDate();

			return await ctx.db.transaction(async (tx) => {
				const findOrCreateSystemAoB = async (slug: string, name: string, type: "LIABILITY" | "EXPENSE") => {
					let dictAcc = await tx.query.DictionaryAccount.findFirst({ where: and(eq(DictionaryAccount.guildSlug, input.guildSlug), eq(DictionaryAccount.slug, slug), eq(DictionaryAccount.currency, creditCurrency)) });
					if (!dictAcc) dictAcc = (await tx.insert(DictionaryAccount).values({ accountType: type, guildSlug: input.guildSlug, name: `${name} ${creditCurrency}`, slug, currency: creditCurrency }).returning())[0];
					if (!dictAcc) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `No se pudo crear DictionaryAccount para ${slug}.` });

					let aob = await tx.query.AccountOnBusiness.findFirst({ where: and(eq(AccountOnBusiness.dictionaryAccountId, dictAcc.id), eq(AccountOnBusiness.businessId, input.toBusinessId)) });
					if (!aob) aob = (await tx.insert(AccountOnBusiness).values({ businessId: input.toBusinessId, dictionaryAccountId: dictAcc.id }).returning())[0];
					if (!aob) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `No se pudo crear AoB para ${slug}.` });
					return aob;
				};

				const creditLiabilityAoB = await findOrCreateSystemAoB("creditosrecibidos", "Créditos Recibidos", "LIABILITY");
				const interestExpenseAoB = await findOrCreateSystemAoB("interesespagadoscreditos", "Intereses Pagados (Créditos)", "EXPENSE");

				let toAccountAoB = await tx.query.AccountOnBusiness.findFirst({ where: and(eq(AccountOnBusiness.dictionaryAccountId, receivingDictionaryAccount.id), eq(AccountOnBusiness.businessId, input.toBusinessId)) });
				if (!toAccountAoB) toAccountAoB = (await tx.insert(AccountOnBusiness).values({ businessId: input.toBusinessId, dictionaryAccountId: receivingDictionaryAccount.id }).returning())[0];
				if (!toAccountAoB) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Cuenta de destino no encontrada." });

				const personName = (await tx.query.Person.findFirst({ where: eq(Person.id, input.personId), columns: { name: true } }))?.name ?? 'Acreedor';
				const transactionGroupName = `Crédito de ${personName} - ${dayjs(input.purchaseDate).format("DD/MM/YY")}`;

				const transactionGroup = (await tx.insert(TransactionGroup).values({ guildSlug: input.guildSlug, name: transactionGroupName, businessId: input.toBusinessId, operationType: "CREDIT" }).returning())[0];
				if (!transactionGroup) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al crear TransactionGroup." });

				const creditRecord = (await tx.insert(Credit).values({
					guildSlug: input.guildSlug, businessId: input.toBusinessId, memberId: member.id, personId: input.personId, purchaseDate: input.purchaseDate,
					currency: creditCurrency, finalExpectedCollectionDate, grossValue: grossValue.toString(), totalInterestAmount: totalInterestToPay.toString(),
					totalCreditValue: totalCreditValue.toString(), numberOfInstallments, paymentPeriodicity: input.paymentPeriodicity, status: "ACTIVE", about: input.about,
				}).returning())[0];
				if (!creditRecord) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al crear el crédito." });

				await tx.insert(CreditOnTransactionGroup).values({ creditId: creditRecord.id, transactionGroupId: transactionGroup.id });

				const installmentsToCreate: (typeof Installment.$inferInsert)[] = [];
				for (let i = 1; i <= numberOfInstallments; i++) {
					installmentsToCreate.push({
						parentType: 'CREDIT', creditId: creditRecord.id, installmentNumber: i,
						dueDate: dayjs(firstPaymentDueDate).add((i - 1) * periodicityMultiplier, periodicityUnit).toDate(),
						principalAmount: "0", interestAmount: interestPerInstallment.toString(), totalAmount: interestPerInstallment.toString(),
					});
				}
				if (installmentsToCreate.length > 0) await tx.insert(Installment).values(installmentsToCreate);

				const getTxDate = ((counter = 0) => () => dayjs(input.purchaseDate).add(++counter, "second").toDate())();
				const newToAccountBalance = parseFloat(toAccountAoB.currentBalance ?? "0") + grossValue;
				const newCreditLiabilityBalance = parseFloat(creditLiabilityAoB.currentBalance ?? "0") + grossValue;
				const newInterestExpenseBalance = parseFloat(interestExpenseAoB.currentBalance ?? "0") + totalInterestToPay;

				await tx.insert(Transaction).values([
					{ date: getTxDate(), amount: grossValue.toString(), balance: newToAccountBalance.toString(), transactionType: "DEBIT", toAccountId: toAccountAoB.id, personId: input.personId, memberId: member.id, transactionGroupId: transactionGroup.id, about: `Recepción capital crédito de ${personName}` },
					{ date: getTxDate(), amount: grossValue.toString(), balance: newCreditLiabilityBalance.toString(), transactionType: "CREDIT", toAccountId: creditLiabilityAoB.id, fromAccountId: toAccountAoB.id, personId: input.personId, memberId: member.id, transactionGroupId: transactionGroup.id, about: `Registro pasivo crédito de ${personName}` },
					{ date: getTxDate(), amount: totalInterestToPay.toString(), balance: newInterestExpenseBalance.toString(), transactionType: "CREDIT", toAccountId: interestExpenseAoB.id, personId: input.personId, memberId: member.id, transactionGroupId: transactionGroup.id, about: `Registro gasto esperado por interés crédito ${personName}` }
				]);

				const txDate = new Date();
				await tx.update(AccountOnBusiness).set({ currentBalance: newToAccountBalance.toString(), lastTransactionDate: txDate }).where(eq(AccountOnBusiness.id, toAccountAoB.id));
				await tx.update(AccountOnBusiness).set({ currentBalance: newCreditLiabilityBalance.toString(), lastTransactionDate: txDate }).where(eq(AccountOnBusiness.id, creditLiabilityAoB.id));
				await tx.update(AccountOnBusiness).set({ currentBalance: newInterestExpenseBalance.toString(), lastTransactionDate: txDate }).where(eq(AccountOnBusiness.id, interestExpenseAoB.id));

				const accountIdsToFix = [toAccountAoB.id, creditLiabilityAoB.id, interestExpenseAoB.id];
				for (const accountId of accountIdsToFix) {
					if (accountId) await tx.execute(sql`SELECT fix_single_account_balance(${accountId}::uuid);`);
				}

				return { credit: creditRecord };
			});
		}),

	byIdWithInstallments: protectedProcedure
		.input(z.object({ creditId: z.string().uuid(), guildSlug: z.string() }))
		.query(async ({ ctx, input }) => {
			const memberAccess = await ctx.db.query.Member.findFirst({ where: and(eq(Member.userId, ctx.user.id), eq(Member.guildSlug, input.guildSlug)), columns: { id: true } });
			if (!memberAccess) throw new TRPCError({ code: "FORBIDDEN" });

			const credit = await ctx.db.query.Credit.findFirst({
				where: and(eq(Credit.id, input.creditId), eq(Credit.guildSlug, input.guildSlug)),
				with: {
					person: true,
					business: true,
					installments: { orderBy: (f, { asc }) => [asc(f.installmentNumber)] },
				},
			});
			if (!credit) throw new TRPCError({ code: "NOT_FOUND", message: "Crédito no encontrado." });
			return credit;
		}),

	byGuildSlugWithCursor: protectedProcedure
		.input(GuildSlugCursorSchema.extend({ searchTerm: z.string().optional() }))
		.query(async ({ ctx, input }) => {
			const { guildSlug, limit, cursor, searchTerm } = input;
			const conditions: SQL[] = [eq(Credit.guildSlug, guildSlug)];
			if (searchTerm) {
				conditions.push(or(ilike(Credit.about, `%${searchTerm}%`), sql`EXISTS (SELECT 1 FROM ${Person} p WHERE p.id = ${Credit.personId} AND ${ilike(Person.name, `%${searchTerm}%`)})`)!);
			}
			if (cursor) {
				conditions.push(or(lt(Credit.createdAt, new Date(cursor.createdAt)), and(eq(Credit.createdAt, new Date(cursor.createdAt)), lt(Credit.id, cursor.id)))!);
			}

			const items = await ctx.db.query.Credit.findMany({
				where: and(...conditions),
				with: { business: true, person: true },
				orderBy: [desc(Credit.purchaseDate), desc(Credit.id)],
				limit: limit + 1,
			});

			let nextCursor: typeof cursor = undefined;
			if (items.length > limit) {
				const lastItem = items.pop()!;
				nextCursor = { createdAt: lastItem.createdAt.toISOString(), id: lastItem.id };
			}
			return { items, nextCursor };
		}),

	countByGuildSlug: protectedProcedure
		.input(GuildSlugSchema.extend({ searchTerm: z.string().optional() }))
		.query(async ({ ctx, input }) => {
			const { guildSlug, searchTerm } = input;
			const conditions: SQL[] = [eq(Credit.guildSlug, guildSlug)];
			if (searchTerm) {
				conditions.push(or(ilike(Credit.about, `%${searchTerm}%`), sql`EXISTS (SELECT 1 FROM ${Person} p WHERE p.id = ${Credit.personId} AND ${ilike(Person.name, `%${searchTerm}%`)})`)!);
			}
			const result = await ctx.db.select({ total: count() }).from(Credit).where(and(...conditions));
			return { total: result[0]?.total ?? 0 };
		}),
		markInstallmentPaid: protectedProcedure
    .input(markCreditInstallmentPaidSchema)
    .mutation(async ({ ctx, input }) => {
        const {
            guildSlug,
            creditId,
            installmentId,
            paymentDate,
            fromDictionaryAccountId,
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
                where: and(eq(Installment.id, installmentId), eq(Installment.creditId, creditId)),
                with: { credit: true }
            });

            if (!installment || !installment.credit) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Cuota o crédito no encontrado.",
                });
            }
            if (installment.status !== 'PENDING' && installment.status !== 'OVERDUE') {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Esta cuota no está pendiente de pago.",
                });
            }
            if (installment.credit.guildSlug !== guildSlug) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Acceso denegado al crédito.",
                });
            }

            const payingBusinessId = installment.credit.businessId;
            const creditCurrency = installment.credit.currency;

            const fromDictionaryAccount = await tx.query.DictionaryAccount.findFirst({
                where: eq(DictionaryAccount.id, fromDictionaryAccountId),
            });
            if (!fromDictionaryAccount || fromDictionaryAccount.accountType !== 'ASSET') {
                throw new TRPCError({ code: 'BAD_REQUEST', message: 'La cuenta de origen del pago debe ser de tipo Activo.' });
            }

            let fromAoB = await tx.query.AccountOnBusiness.findFirst({
                where: and(
                    eq(AccountOnBusiness.dictionaryAccountId, fromDictionaryAccountId),
                    eq(AccountOnBusiness.businessId, payingBusinessId)
                ),
                with: { dictionaryAccount: true }
            });

            if (!fromAoB) {
                const inserted = (await tx.insert(AccountOnBusiness).values({
                    businessId: payingBusinessId,
                    dictionaryAccountId: fromDictionaryAccountId,
                }).returning({ id: AccountOnBusiness.id }))[0];
                if (!inserted) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo crear la cuenta de origen en la empresa." });
                fromAoB = await tx.query.AccountOnBusiness.findFirst({ where: eq(AccountOnBusiness.id, inserted.id), with: { dictionaryAccount: true } });
            }
            if (!fromAoB) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Cuenta de origen no encontrada." });

            const payingCurrency = fromAoB.dictionaryAccount.currency;
            const requiresConversion = creditCurrency !== payingCurrency;
            let amountToDebitInPayingCurrency = parseFloat(installment.interestAmount);
            let finalExchangeRateForTx: string | undefined = undefined;

            if (requiresConversion) {
                if (!exchangeRate || !rateFromCurrency) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: "Se requiere tipo de cambio para el pago en otra divisa." });
                }
                const rate = parseFloat(exchangeRate.replace(",", "."));
                if (rate <= 0) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: 'La cotización debe ser un número positivo.' });
                }
                if (rateFromCurrency === creditCurrency) {
                    amountToDebitInPayingCurrency = parseFloat(installment.interestAmount) / rate;
                    finalExchangeRateForTx = (1 / rate).toString();
                } else {
                    amountToDebitInPayingCurrency = parseFloat(installment.interestAmount) * rate;
                    finalExchangeRateForTx = rate.toString();
                }
            }
            
            const interestExpenseDict = await tx.query.DictionaryAccount.findFirst({ where: and(eq(DictionaryAccount.slug, "interesespagadoscreditos"), eq(DictionaryAccount.guildSlug, guildSlug), eq(DictionaryAccount.currency, creditCurrency)) });
            if (!interestExpenseDict) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Cuenta de sistema 'interesespagadoscreditos' (${creditCurrency}) no encontrada.` });
            
            let interestExpenseAoB = await tx.query.AccountOnBusiness.findFirst({ where: and(eq(AccountOnBusiness.dictionaryAccountId, interestExpenseDict.id), eq(AccountOnBusiness.businessId, payingBusinessId)) });
            if (!interestExpenseAoB) {
                const inserted = (await tx.insert(AccountOnBusiness).values({ businessId: payingBusinessId, dictionaryAccountId: interestExpenseDict.id }).returning({id: AccountOnBusiness.id}))[0];
                if (!inserted) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo crear la cuenta de sistema de gastos." });
                interestExpenseAoB = await tx.query.AccountOnBusiness.findFirst({ where: eq(AccountOnBusiness.id, inserted.id) });
            }
            if (!interestExpenseAoB) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo encontrar la cuenta de sistema de gastos." });

            const transactionGroupName = `Pago Interés Cuota ${installment.installmentNumber} Crédito #${installment.credit.id.substring(0, 8)}`;
            const transactionGroup = (await tx.insert(TransactionGroup).values({ guildSlug, name: transactionGroupName, businessId: payingBusinessId, description: `Pago de la cuota de interés ${installment.installmentNumber}.`, operationType: "CREDIT" }).returning())[0]!;

            const getTxDate = ((counter = 0) => () => dayjs(paymentDate).add(counter++, 'second').toDate())();
            const interestPaidInCreditCurrency = parseFloat(installment.interestAmount);

            const newFromBalance = parseFloat(fromAoB.currentBalance ?? "0") - amountToDebitInPayingCurrency;
            const newInterestExpenseBalance = parseFloat(interestExpenseAoB.currentBalance ?? "0") - interestPaidInCreditCurrency;

            const txDate = getTxDate();
            const createdTransactions = await tx.insert(Transaction).values([
                { date: txDate, amount: amountToDebitInPayingCurrency.toString(), balance: newFromBalance.toString(), transactionType: 'CREDIT', toAccountId: fromAoB.id, personId: installment.credit.personId, memberId: member.id, transactionGroupId: transactionGroup.id, about: `Pago interés cuota ${installment.installmentNumber} en ${payingCurrency}`, exchangeRate: finalExchangeRateForTx },
                { date: getTxDate(), amount: interestPaidInCreditCurrency.toString(), balance: newInterestExpenseBalance.toString(), transactionType: 'DEBIT', toAccountId: interestExpenseAoB.id, fromAccountId: fromAoB.id, personId: installment.credit.personId, memberId: member.id, transactionGroupId: transactionGroup.id, about: `Gasto interés cuota ${installment.installmentNumber}` },
            ]).returning();
            const fromTransactionRecord = createdTransactions.find(t => t.toAccountId === fromAoB.id);

            await tx.update(AccountOnBusiness).set({ currentBalance: newFromBalance.toString(), lastTransactionDate: txDate }).where(eq(AccountOnBusiness.id, fromAoB.id));
            await tx.update(AccountOnBusiness).set({ currentBalance: newInterestExpenseBalance.toString(), lastTransactionDate: txDate }).where(eq(AccountOnBusiness.id, interestExpenseAoB.id));
            
            await tx.update(Installment).set({
                status: 'PAID', paidDate: paymentDate, paidAmount: installment.interestAmount,
                notes: notes, paymentTransactionId: fromTransactionRecord?.id ?? null,
            }).where(eq(Installment.id, installmentId));

            const newPaidInterest = parseFloat(installment.credit.paidInterest ?? "0") + interestPaidInCreditCurrency;
            await tx.update(Credit).set({
                paidInterest: newPaidInterest.toString(),
                updatedAt: dayjs().toDate(),
            }).where(eq(Credit.id, creditId));

            if (fromAoB.subAccount) await updateParentAccount(fromAoB.dictionaryAccountId, fromAoB.businessId);
            if (interestExpenseAoB.subAccount) await updateParentAccount(interestExpenseAoB.dictionaryAccountId, interestExpenseAoB.businessId);

            const accountIdsToFix = [fromAoB.id, interestExpenseAoB.id];
            for (const accountId of accountIdsToFix) {
                if (accountId) await tx.execute(sql`SELECT fix_single_account_balance(${accountId}::uuid);`);
            }

            return { success: true, installmentId, creditId, transactionGroupId: transactionGroup.id };
        });
    }),
	addCapital: protectedProcedure
		.input(addCapitalToCreditSchema)
		.mutation(async ({ ctx, input }) => {
			const { creditId, guildSlug, receivingAccountId, amount, interestToAdd, purchaseDate } = input;
			const member = await ctx.db.query.Member.findFirst({ where: and(eq(Member.userId, ctx.user.id), eq(Member.guildSlug, guildSlug)) });
			if (!member) throw new TRPCError({ code: "FORBIDDEN" });

			return await ctx.db.transaction(async (tx) => {
				const credit = await tx.query.Credit.findFirst({ where: and(eq(Credit.id, creditId), eq(Credit.status, 'ACTIVE')), with: { installments: true } });
				if (!credit) throw new TRPCError({ code: "NOT_FOUND", message: "Crédito no encontrado o no está activo." });

				const receivingDictionaryAccount = await tx.query.DictionaryAccount.findFirst({ where: eq(DictionaryAccount.id, receivingAccountId) });
				if (!receivingDictionaryAccount || receivingDictionaryAccount.accountType !== 'ASSET') throw new TRPCError({ code: "BAD_REQUEST", message: "La cuenta receptora debe ser de tipo Activo." });
				if (receivingDictionaryAccount.currency !== credit.currency) throw new TRPCError({ code: "BAD_REQUEST", message: "La moneda de la cuenta receptora debe coincidir con la del crédito." });

				const capitalToAdd = parseFloat(formatForSubmit(amount));
				const interestAmountToAdd = parseFloat(formatForSubmit(interestToAdd));
				if (capitalToAdd <= 0 || interestAmountToAdd < 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Los montos de capital e interés deben ser válidos." });

				const newGrossValue = parseFloat(credit.grossValue) + capitalToAdd;
				const newTotalInterest = parseFloat(credit.totalInterestAmount) + interestAmountToAdd;
				const newTotalCreditValue = newGrossValue + newTotalInterest;

				const findSystemAoB = async (slug: string, currency: Currency) => {
					const dict = await tx.query.DictionaryAccount.findFirst({ where: and(eq(DictionaryAccount.slug, slug), eq(DictionaryAccount.guildSlug, guildSlug), eq(DictionaryAccount.currency, currency)) });
					if (!dict) return null;
					return await tx.query.AccountOnBusiness.findFirst({ where: and(eq(AccountOnBusiness.dictionaryAccountId, dict.id), eq(AccountOnBusiness.businessId, credit.businessId)) });
				};

				const creditLiabilityAoB = await findSystemAoB("creditosrecibidos", credit.currency);
				if (!creditLiabilityAoB) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Cuenta de sistema 'creditosrecibidos' no encontrada.` });

				const interestExpenseAoB = await findSystemAoB("interesespagadoscreditos", credit.currency);
				if (!interestExpenseAoB) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Cuenta de sistema 'interesespagadoscreditos' no encontrada.` });

				let receivingAoB = await tx.query.AccountOnBusiness.findFirst({ where: and(eq(AccountOnBusiness.dictionaryAccountId, receivingDictionaryAccount.id), eq(AccountOnBusiness.businessId, credit.businessId)) });
				if (!receivingAoB) receivingAoB = (await tx.insert(AccountOnBusiness).values({ businessId: credit.businessId, dictionaryAccountId: receivingDictionaryAccount.id }).returning())[0];
				if (!receivingAoB) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Cuenta receptora no encontrada." });

				const transactionGroupName = `Ampliación Capital Crédito #${credit.id.substring(0, 8)} - ${dayjs(purchaseDate).format("DD/MM/YY")}`;
				const transactionGroup = (await tx.insert(TransactionGroup).values({ guildSlug, name: transactionGroupName, businessId: credit.businessId, operationType: "CREDIT" }).returning())[0]!;

				const getTxDate = ((counter = 0) => () => dayjs(purchaseDate).add(++counter, "second").toDate())();
				const newReceivingBalance = parseFloat(receivingAoB.currentBalance ?? "0") + capitalToAdd;
				const newCreditLiabilityBalance = parseFloat(creditLiabilityAoB.currentBalance ?? "0") + capitalToAdd;
				const newInterestExpenseBalance = parseFloat(interestExpenseAoB.currentBalance ?? "0") + interestAmountToAdd;

				const transactionsToInsert: (typeof Transaction.$inferInsert)[] = [
					{ date: getTxDate(), amount: capitalToAdd.toString(), balance: newReceivingBalance.toString(), transactionType: "DEBIT", toAccountId: receivingAoB.id, personId: credit.personId, memberId: member.id, transactionGroupId: transactionGroup.id },
					{ date: getTxDate(), amount: capitalToAdd.toString(), balance: newCreditLiabilityBalance.toString(), transactionType: "CREDIT", toAccountId: creditLiabilityAoB.id, fromAccountId: receivingAoB.id, personId: credit.personId, memberId: member.id, transactionGroupId: transactionGroup.id },
				];

				if (interestAmountToAdd > 0) {
					transactionsToInsert.push({ date: getTxDate(), amount: interestAmountToAdd.toString(), balance: newInterestExpenseBalance.toString(), transactionType: "CREDIT", toAccountId: interestExpenseAoB.id, personId: credit.personId, memberId: member.id, transactionGroupId: transactionGroup.id });
				}
				await tx.insert(Transaction).values(transactionsToInsert);

				await tx.update(AccountOnBusiness).set({ currentBalance: newReceivingBalance.toString(), lastTransactionDate: new Date() }).where(eq(AccountOnBusiness.id, receivingAoB.id));
				await tx.update(AccountOnBusiness).set({ currentBalance: newCreditLiabilityBalance.toString(), lastTransactionDate: new Date() }).where(eq(AccountOnBusiness.id, creditLiabilityAoB.id));
				if (interestAmountToAdd > 0) {
					await tx.update(AccountOnBusiness).set({ currentBalance: newInterestExpenseBalance.toString(), lastTransactionDate: new Date() }).where(eq(AccountOnBusiness.id, interestExpenseAoB.id));
				}

				const pendingInstallments = credit.installments.filter(i => i.status === 'PENDING' || i.status === 'OVERDUE');
				if (pendingInstallments.length > 0) {
					await tx.delete(Installment).where(inArray(Installment.id, pendingInstallments.map(i => i.id)));
				}

				const lastPaidInstallmentNumber = credit.installments.reduce((max, i) => i.status === 'PAID' && i.installmentNumber > max ? i.installmentNumber : max, 0);
				const remainingInstallmentsCount = credit.numberOfInstallments - lastPaidInstallmentNumber;
				const interestAlreadyPaid = parseFloat(credit.paidInterest ?? "0");
				const newInterestPerInstallment = (newTotalInterest - interestAlreadyPaid) / remainingInstallmentsCount;
				const lastDueDate = credit.installments.find(i => i.installmentNumber === lastPaidInstallmentNumber)?.dueDate ?? credit.purchaseDate;

				let periodicityUnit: ManipulateType = "month";
				let periodicityMultiplier = 1;
				switch (credit.paymentPeriodicity) {
					case "DAILY": periodicityUnit = "day"; break; case "WEEKLY": periodicityUnit = "week"; break;
					case "BIWEEKLY": periodicityUnit = "week"; periodicityMultiplier = 2; break; case "BIMONTHLY": periodicityUnit = "month"; periodicityMultiplier = 2; break;
					case "QUARTERLY": periodicityUnit = "month"; periodicityMultiplier = 3; break; case "SEMIANNUALLY": periodicityUnit = "month"; periodicityMultiplier = 6; break;
					case "ANNUALLY": periodicityUnit = "year"; break;
				}

				const newInstallments: (typeof Installment.$inferInsert)[] = [];
				for (let i = 1; i <= remainingInstallmentsCount; i++) {
					const nextDueDate = dayjs(lastDueDate).add(i * periodicityMultiplier, periodicityUnit).toDate();
					newInstallments.push({
						parentType: 'CREDIT', creditId: credit.id, installmentNumber: lastPaidInstallmentNumber + i,
						dueDate: nextDueDate, principalAmount: "0", interestAmount: newInterestPerInstallment.toString(), totalAmount: newInterestPerInstallment.toString(),
					});
				}
				if (newInstallments.length > 0) await tx.insert(Installment).values(newInstallments);

				await tx.update(Credit).set({
					grossValue: newGrossValue.toString(),
					totalInterestAmount: newTotalInterest.toString(),
					totalCreditValue: newTotalCreditValue.toString(),
					updatedAt: new Date()
				}).where(eq(Credit.id, credit.id));

				const accountIdsToFix = [receivingAoB.id, creditLiabilityAoB.id, interestExpenseAoB.id];
				for (const accountId of accountIdsToFix) { if (accountId) await tx.execute(sql`SELECT fix_single_account_balance(${accountId}::uuid);`); }

				return { success: true, newGrossValue: newGrossValue.toString() };
			});
		}),
	settleEarly: protectedProcedure
		.input(settleCreditEarlySchema)
		.mutation(async ({ ctx, input }) => {
			const {
				creditId, guildSlug, settlementDate,
				fromDictionaryAccountId, notes,
				exchangeRate, rateFromCurrency
			} = input;

			const member = await ctx.db.query.Member.findFirst({
				where: and(eq(Member.userId, ctx.user.id), eq(Member.guildSlug, guildSlug))
			});
			if (!member) {
				throw new TRPCError({ code: "FORBIDDEN", message: "No tienes permiso para realizar esta acción." });
			}

			return await ctx.db.transaction(async (tx) => {
				const credit = await tx.query.Credit.findFirst({
					where: and(eq(Credit.id, creditId), eq(Credit.guildSlug, guildSlug)),
					with: { installments: true }
				});

				if (!credit || credit.status !== 'ACTIVE') {
					throw new TRPCError({ code: "BAD_REQUEST", message: "Solo se pueden liquidar créditos activos." });
				}

				const fromDictionaryAccount = await tx.query.DictionaryAccount.findFirst({
					where: eq(DictionaryAccount.id, fromDictionaryAccountId),
				});
				if (!fromDictionaryAccount || fromDictionaryAccount.accountType !== 'ASSET') {
					throw new TRPCError({ code: 'BAD_REQUEST', message: 'La cuenta de origen del pago debe ser de tipo Activo.' });
				}

				const creditBusinessId = credit.businessId;
				const creditCurrency = credit.currency;
				const payingCurrency = fromDictionaryAccount.currency;
				const requiresConversion = creditCurrency !== payingCurrency;

				if (requiresConversion && (!exchangeRate || !rateFromCurrency)) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "Se requiere tipo de cambio para liquidar en otra divisa." });
				}

				let fromAoB = await tx.query.AccountOnBusiness.findFirst({
					where: and(
						eq(AccountOnBusiness.dictionaryAccountId, fromDictionaryAccountId),
						eq(AccountOnBusiness.businessId, creditBusinessId)
					),
				});
				if (!fromAoB) {
					const inserted = (await tx.insert(AccountOnBusiness).values({
						businessId: creditBusinessId,
						dictionaryAccountId: fromDictionaryAccountId,
					}).returning({ id: AccountOnBusiness.id }))[0];
					if (!inserted) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo crear la cuenta de origen en la empresa." });
					fromAoB = await tx.query.AccountOnBusiness.findFirst({ where: eq(AccountOnBusiness.id, inserted.id) });
				}
				if (!fromAoB) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Cuenta de origen no encontrada." });

				const settlementDay = dayjs(settlementDate).startOf('day');
				const pendingInstallments = credit.installments.filter(i => i.status === 'PENDING' || i.status === 'OVERDUE');

				let interestToSettle = 0;
				const futureInstallmentsToCancel: string[] = [];
				pendingInstallments.forEach(inst => {
					if (dayjs(inst.dueDate).isSameOrBefore(settlementDay)) {
						interestToSettle += parseFloat(inst.interestAmount);
					} else {
						futureInstallmentsToCancel.push(inst.id);
					}
				});

				const capitalToSettle = parseFloat(credit.grossValue);
				const totalSettlementAmountInCreditCurrency = capitalToSettle + interestToSettle;

				let amountToDebitInPayingCurrency = totalSettlementAmountInCreditCurrency;
				let finalExchangeRateForTx: string | undefined = undefined;

				if (requiresConversion) {
					const rate = parseFloat(exchangeRate!.replace(",", "."));
					if (rate <= 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'La cotización debe ser un número positivo.' });

					if (rateFromCurrency === creditCurrency) {
						amountToDebitInPayingCurrency = totalSettlementAmountInCreditCurrency / rate;
						finalExchangeRateForTx = (1 / rate).toString();
					} else {
						amountToDebitInPayingCurrency = totalSettlementAmountInCreditCurrency * rate;
						finalExchangeRateForTx = rate.toString();
					}
				}

				const findSystemAoB = async (slug: string, currency: Currency) => {
					const dict = await tx.query.DictionaryAccount.findFirst({ where: and(eq(DictionaryAccount.slug, slug), eq(DictionaryAccount.guildSlug, guildSlug), eq(DictionaryAccount.currency, currency)) });
					if (!dict) return null;
					return await tx.query.AccountOnBusiness.findFirst({ where: and(eq(AccountOnBusiness.dictionaryAccountId, dict.id), eq(AccountOnBusiness.businessId, credit.businessId)) });
				}

				const creditLiabilityAoB = await findSystemAoB("creditosrecibidos", creditCurrency);
				if (!creditLiabilityAoB) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Cuenta 'creditosrecibidos' (${creditCurrency}) no encontrada.` });

				const interestExpenseAoB = await findSystemAoB("interesespagadoscreditos", creditCurrency);
				if (!interestExpenseAoB) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Cuenta 'interesespagadoscreditos' (${creditCurrency}) no encontrada.` });

				const personName = (await tx.query.Person.findFirst({ where: eq(Person.id, credit.personId!), columns: { name: true } }))?.name ?? 'Acreedor';
				const transactionGroupName = `Liquidación Crédito de ${personName} - ${dayjs(settlementDate).format("DD/MM/YY")}`;
				const transactionGroup = (await tx.insert(TransactionGroup).values({ guildSlug, name: transactionGroupName, businessId: credit.businessId, description: `Liquidación total del crédito.`, operationType: "CREDIT" }).returning())[0]!;

				const transactionsToInsert: (Omit<typeof Transaction.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>)[] = [];
				let dateCounter = 0;
				const getTxDate = () => dayjs(settlementDate).add(dateCounter++, 'second').toDate();

				const newFromBalance = parseFloat(fromAoB.currentBalance ?? "0") - amountToDebitInPayingCurrency;
				transactionsToInsert.push({
					date: getTxDate(), amount: amountToDebitInPayingCurrency.toString(), balance: newFromBalance.toString(),
					transactionType: 'CREDIT', toAccountId: fromAoB.id,
					personId: credit.personId, memberId: member.id, transactionGroupId: transactionGroup.id,
					about: `Pago liquidación crédito #${credit.id.substring(0, 8)}`,
					exchangeRate: finalExchangeRateForTx,
				});

				const newCreditLiabilityBalance = parseFloat(creditLiabilityAoB.currentBalance ?? "0") - capitalToSettle;
				transactionsToInsert.push({
					date: getTxDate(), amount: capitalToSettle.toString(), balance: newCreditLiabilityBalance.toString(),
					transactionType: 'DEBIT', toAccountId: creditLiabilityAoB.id, fromAccountId: fromAoB.id,
					personId: credit.personId, memberId: member.id, transactionGroupId: transactionGroup.id,
					about: `Cancelación capital por liquidación de crédito`,
				});

				const interestForgiven = parseFloat(credit.totalInterestAmount) - parseFloat(credit.paidInterest ?? "0") - interestToSettle;
				if (interestToSettle > 0.01) {
					const newInterestExpenseBalance = parseFloat(interestExpenseAoB.currentBalance ?? "0") - interestToSettle;
					transactionsToInsert.push({
						date: getTxDate(), amount: interestToSettle.toString(),
						balance: newInterestExpenseBalance.toString(),
						transactionType: 'DEBIT', toAccountId: interestExpenseAoB.id, fromAccountId: fromAoB.id,
						personId: credit.personId, memberId: member.id, transactionGroupId: transactionGroup.id,
						about: `Pago de intereses devengados por liquidación`,
					});
				}
				if (Math.abs(interestForgiven) > 0.01) {
					const newInterestExpenseBalanceAfterForgive = parseFloat(interestExpenseAoB.currentBalance ?? "0") - interestToSettle - interestForgiven;
					transactionsToInsert.push({
						date: getTxDate(), amount: interestForgiven.toString(),
						balance: newInterestExpenseBalanceAfterForgive.toString(),
						transactionType: 'DEBIT', toAccountId: interestExpenseAoB.id, fromAccountId: fromAoB.id,
						personId: credit.personId, memberId: member.id, transactionGroupId: transactionGroup.id,
						about: `Anulación de intereses futuros por liquidación`,
					});
				}

				await tx.insert(Transaction).values(transactionsToInsert);

				await tx.update(AccountOnBusiness).set({ currentBalance: newFromBalance.toString(), lastTransactionDate: settlementDate }).where(eq(AccountOnBusiness.id, fromAoB.id));
				await tx.update(AccountOnBusiness).set({ currentBalance: newCreditLiabilityBalance.toString(), lastTransactionDate: settlementDate }).where(eq(AccountOnBusiness.id, creditLiabilityAoB.id));
				const newInterestExpenseFinalBalance = parseFloat(interestExpenseAoB.currentBalance ?? "0") - interestToSettle - interestForgiven;
				await tx.update(AccountOnBusiness).set({ currentBalance: newInterestExpenseFinalBalance.toString(), lastTransactionDate: settlementDate }).where(eq(AccountOnBusiness.id, interestExpenseAoB.id));

				if (futureInstallmentsToCancel.length > 0) {
					await tx.update(Installment).set({ status: 'SETTLED_EARLY' }).where(inArray(Installment.id, futureInstallmentsToCancel));
				}
				const settledInstallments = pendingInstallments.filter(i => !futureInstallmentsToCancel.includes(i.id));
				if (settledInstallments.length > 0) {
					await tx.update(Installment).set({ status: 'PAID', paidDate: settlementDate }).where(inArray(Installment.id, settledInstallments.map(i => i.id)));
				}

				await tx.update(Credit).set({
					status: 'PAID_OFF',
					paidInterest: (parseFloat(credit.paidInterest ?? "0") + interestToSettle).toString(),
					updatedAt: new Date()
				}).where(eq(Credit.id, creditId));

				const accountIdsToFix = [fromAoB.id, creditLiabilityAoB.id, interestExpenseAoB.id];
				for (const accountId of accountIdsToFix) {
					if (accountId) await tx.execute(sql`SELECT fix_single_account_balance(${accountId}::uuid);`);
				}

				return { success: true, settlementAmount: totalSettlementAmountInCreditCurrency, currency: credit.currency };
			});
		}),
	delete: protectedProcedure
		.input(IdSchema)
		.mutation(async ({ ctx, input }) => {
			return await ctx.db.transaction(async (tx) => {
				const credit = await tx.query.Credit.findFirst({ where: eq(Credit.id, input.id) });
				if (!credit) throw new TRPCError({ code: "NOT_FOUND", message: "Crédito no encontrado" });

				const cotg = await tx.query.CreditOnTransactionGroup.findMany({ where: eq(CreditOnTransactionGroup.creditId, input.id) });
				const groupIds = cotg.map(c => c.transactionGroupId);

				await tx.delete(Installment).where(eq(Installment.creditId, input.id));

				if (groupIds.length > 0) {
					const transactions = await tx.query.Transaction.findMany({ where: inArray(Transaction.transactionGroupId, groupIds) });
					const accountIds = [...new Set(transactions.flatMap(t => [t.fromAccountId, t.toAccountId]).filter(Boolean))];

					await tx.delete(Transaction).where(inArray(Transaction.transactionGroupId, groupIds));
					await tx.delete(CreditOnTransactionGroup).where(eq(CreditOnTransactionGroup.creditId, input.id));
					await tx.delete(TransactionGroup).where(inArray(TransactionGroup.id, groupIds));

					for (const accountId of accountIds) {
						await tx.execute(sql`SELECT fix_single_account_balance(${accountId}::uuid);`);
					}
				}

				await tx.delete(Credit).where(eq(Credit.id, input.id));

				return { success: true };
			});
		}),
		modify: protectedProcedure
    .input(modifyCreditSchema)
    .mutation(async ({ ctx, input }) => {
        const { creditId, discharged, status, about } = input;

        const credit = await ctx.db.query.Credit.findFirst({
            where: eq(Credit.id, creditId),
        });

        if (!credit) {
            throw new TRPCError({
                code: "NOT_FOUND",
                message: "Crédito no encontrado",
            });
        }

        const updatePayload: Partial<typeof Credit.$inferInsert> = {
            updatedAt: dayjs().toDate(),
        };

        if (discharged !== undefined) {
            updatePayload.discharged = discharged;
        }
        if (status !== undefined) {
            updatePayload.status = status;
        }
        if (about !== undefined) {
            updatePayload.about = about;
        }

        if (Object.keys(updatePayload).length === 1) {
            return credit;
        }

        const [updatedCredit] = await ctx.db
            .update(Credit)
            .set(updatePayload)
            .where(eq(Credit.id, creditId))
            .returning();

        if (!updatedCredit) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Error al modificar el crédito",
            });
        }

        return updatedCredit;
    }),
});