// NUEVO SCHEMA

import { relations } from "drizzle-orm";
import { boolean, integer, json, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { AuthUsers } from "./auth";

export const StatusEnum = pgEnum("status", [
	'SUCCESS',
	'PENDING',
	'CANCELLED',
	'ERROR'
])

export const InstallmentParentTypeEnum = pgEnum("installmentParentType", ['LOAN', 'CREDIT']);

export const NotificationTypeEnum = pgEnum("notificationType", [
	'LOAN_DUE_SOON',
	'CREDIT_DUE_SOON',
	'SYSTEM_ANNOUNCEMENT'
]);

export const ActionEnum = pgEnum("action", [
	'CREATE',
	'READ',
	'UPDATE',
	'DELETE'
])

export const ResourceTypeEnum = pgEnum("resourceType", [
	'GUILD',
	'BUSINESS',
	'DICTIONARY_ACCOUNT',
	'ACCOUNT',
	'TRANSACTION',
	'CATEGORY',
	'CHECK',
	'CABLE',
	'LOAN',
	'CREDIT',
	'PERSON',
	'VEHICLE',
	'MACHINERY',
	'PROPERTY',
	'MEMBER'
])

export const CheckStatusEnum = pgEnum("checkStatus", [
	'REJECTED',
	'DEPOSITED',
	'SOLD',
	'PURCHASED'
])

export const RoleEnum = pgEnum("role", [
	'OWNER',
	'MANAGER',
	'MEMBER',
])

export const CurrencyEnum = pgEnum("currency", [
	'ARS',
	'USD',
	'EUR',
	'CNY',
	'AUD',
	'GBP',
	'BRL',
	'CAD',
	'JPY',
	'CHF',
	'USDT',
	"MXN"
])

export const AccountTypeEnum = pgEnum("accountType", [
	'ASSET',
	'EXPENSE',
	'LIABILITY',
	'REVENUE'
])

export const TransactionTypeEnum = pgEnum("transactionType", [
	'DEBIT',
	'CREDIT',
])

export const EntityTypeEnum = pgEnum("entityType", [
	'PERSON',
	'MACHINERY',
	'VEHICLE',
	'PROPERTY'
])

export const OperationTypeEnum = pgEnum("operationType", [
	'CHECK_SALE',
	'CHECK_PURCHASE',
	'LOAN',
	'CREDIT',
	'CABLE',
	'CURRENCY_EXCHANGE',
	'REGULAR',
	'MULTIPLE'
])

export const LoanStatusEnum = pgEnum("loanStatus", ['ACTIVE', 'PAID_OFF', 'DEFAULTED', 'CANCELLED']);

export const PaymentPeriodicityEnum = pgEnum("paymentPeriodicity", ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'ANNUALLY']);

export const InstallmentStatusEnum = pgEnum("installmentStatus", ['PENDING', 'PAID', 'PARTIALLY_PAID', 'CANCELLED', 'OVERDUE', 'SETTLED_EARLY']);


export const User = pgTable('user', {
	id: uuid("id").notNull().primaryKey().references(() => AuthUsers.id, { onDelete: "cascade" }),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	email: text("email").notNull().unique(),
	firstname: text('firstname'),
	lastname: text('lastname'),
	image: text('image'),
});

export const UserRelations = relations(User, ({ many }) => ({
	invites: many(Invite),
	petitions: many(Petition),
	member: many(Member),
	logs: many(Log)
}));

export const Petition = pgTable('petition', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	discharged: boolean('discharged').default(true).notNull(),
	guildSlug: varchar('guildSlug').notNull(),
	userId: uuid('userId').notNull().references(() => User.id, { onDelete: "cascade" }),
});

export const PetitionRelations = relations(Petition, ({ one }) => ({
	guild: one(Guild, {
		fields: [Petition.guildSlug],
		references: [Guild.guildSlug]
	}),
	user: one(User, {
		fields: [Petition.userId],
		references: [User.id]
	})
}));

export const Invite = pgTable('invite', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	token: uuid("token").notNull().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	expiresAt: timestamp('expiresAt'),
	guildSlug: varchar('guildSlug').notNull(),
	email: varchar('email').notNull(),
	userId: uuid('userId').references(() => User.id, { onDelete: "cascade" }),
	role: RoleEnum("role").default("MEMBER").notNull(),
	discharged: boolean('discharged').default(true).notNull(),
	status: StatusEnum("status").default("PENDING").notNull()
});

export const InviteRelations = relations(Invite, ({ one }) => ({
	guild: one(Guild, {
		fields: [Invite.guildSlug],
		references: [Guild.guildSlug]
	}),
	user: one(User, {
		fields: [Invite.userId],
		references: [User.id]
	})
}));

export const AccountOnBusiness = pgTable('accountOnBusiness', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	discharged: boolean('discharged').default(true).notNull(),
	businessId: uuid('businessId').notNull().references(() => Business.id, { onDelete: "cascade" }),
	dictionaryAccountId: uuid('dictionaryAccountId').notNull().references(() => DictionaryAccount.id, { onDelete: "cascade" }),
	name: varchar('name', { length: 255 }), // Nombre personalizado para subcuentas
	subAccount: boolean('subAccount').default(false).notNull(), // Indica si es una subcuenta
	personId: uuid('personId').references(() => Person.id, { onDelete: "set null" }),
	machineryId: uuid('machineryId').references(() => Machinery.id, { onDelete: "set null" }),
	vehicleId: uuid('vehicleId').references(() => Vehicle.id, { onDelete: "set null" }),
	propertyId: uuid('propertyId').references(() => Property.id, { onDelete: "set null" }),
	currentBalance: numeric('currentBalance').default("0"), // Balance actual de la cuenta
	lastTransactionDate: timestamp('lastTransactionDate', { withTimezone: true }) // Fecha de la última transacción
});

export const AccountOnBusinessRelations = relations(AccountOnBusiness, ({ one, many }) => ({
	business: one(Business, {
		fields: [AccountOnBusiness.businessId],
		references: [Business.id]
	}),
	dictionaryAccount: one(DictionaryAccount, {
		fields: [AccountOnBusiness.dictionaryAccountId],
		references: [DictionaryAccount.id]
	}),
	person: one(Person, {
		fields: [AccountOnBusiness.personId],
		references: [Person.id]
	}),
	machinery: one(Machinery, {
		fields: [AccountOnBusiness.machineryId],
		references: [Machinery.id]
	}),
	vehicle: one(Vehicle, {
		fields: [AccountOnBusiness.vehicleId],
		references: [Vehicle.id]
	}),
	property: one(Property, {
		fields: [AccountOnBusiness.propertyId],
		references: [Property.id]
	}),
	fromAccount: many(Transaction, {
		relationName: "fromAccount",
	}),
	toAccount: many(Transaction, {
		relationName: "toAccount",
	}),
}));

export const Log = pgTable('log', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	entityName: varchar('entityName').notNull(),
	entityId: varchar('entityId').notNull(),
	action: varchar('action').notNull(),
	quantity: integer('quantity'),
	details: jsonb('details'),
	userId: uuid('userId').notNull().references(() => User.id, { onDelete: "cascade" }),
	guildSlug: varchar('guildSlug').notNull(),
	businessId: uuid('businessId').references(() => Business.id, { onDelete: "cascade" }),
});

export const LogRelations = relations(Log, ({ one }) => ({
	user: one(User, {
		fields: [Log.userId],
		references: [User.id]
	}),
	guild: one(Guild, {
		fields: [Log.guildSlug],
		references: [Guild.guildSlug]
	}),
	business: one(Business, {
		fields: [Log.businessId],
		references: [Business.id]
	})
}));

export const CategoriesOnDictionaryAccount = pgTable('categoriesOnDictionaryAccount', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	categoryId: uuid('categoryId').notNull().references(() => Category.id, { onDelete: "cascade" }),
	dictionaryAccountId: uuid('dictionaryAccountId').notNull().references(() => DictionaryAccount.id, { onDelete: "cascade" }),
});

export const CategoriesOnDictionaryAccountRelations = relations(CategoriesOnDictionaryAccount, ({ one }) => ({
	category: one(Category, {
		fields: [CategoriesOnDictionaryAccount.categoryId],
		references: [Category.id]
	}),
	dictionaryAccount: one(DictionaryAccount, {
		fields: [CategoriesOnDictionaryAccount.dictionaryAccountId],
		references: [DictionaryAccount.id]
	})
}));

export const DictionaryAccount = pgTable('dictionaryAccount', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	name: varchar('name', { length: 255 }).notNull(),
	checkAccount: boolean('checkAccount').default(false).notNull(),
	availability: boolean('availability').default(false).notNull(),
	hasSubAccounts: boolean('hasSubAccounts').default(false).notNull(),
	accountType: AccountTypeEnum("accountType").notNull(),
	currency: CurrencyEnum("currency").notNull(),
	guildSlug: varchar('guildSlug').notNull(),
	discharged: boolean('discharged').default(true).notNull(),
	slug: varchar('slug', { length: 255 }).notNull(),
	entityType: EntityTypeEnum("entityType")
});

export const DictionaryAccountRelations = relations(DictionaryAccount, ({ one, many }) => ({
	guild: one(Guild, {
		fields: [DictionaryAccount.guildSlug],
		references: [Guild.guildSlug]
	}),
	accountsOnBusinesses: many(AccountOnBusiness),
	categoriesOnDictionaryAccounts: many(CategoriesOnDictionaryAccount),
}));

export const Transaction = pgTable('transaction', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	date: timestamp('date').notNull(),
	amount: numeric('amount').notNull(),
	balance: numeric('balance'),
	exchangeRate: numeric('exchangeRate'),
	about: varchar('about', { length: 255 }),
	discharged: boolean('discharged').default(true).notNull(),
	transactionType: TransactionTypeEnum("transactionType").notNull(),
	transactionGroupId: uuid('transactionGroupId').references(() => TransactionGroup.id, { onDelete: "set null" }),
	fromAccountId: uuid('fromAccountId').references(() => AccountOnBusiness.id, { onDelete: "cascade" }),
	toAccountId: uuid('toAccountId').notNull().references(() => AccountOnBusiness.id, { onDelete: "cascade" }),
	memberId: uuid('memberId').notNull().references(() => Member.id, { onDelete: "cascade" }),
	categoryId: uuid('categoryId').references(() => Category.id, { onDelete: "cascade" }),
	personId: uuid('personId').references(() => Person.id, { onDelete: "cascade" }),
	history: json('history').$type<{ date: string, oldAmount: string, newAmount: string }[]>().default([]),
	requiresSignature: boolean('requiresSignature').default(false).notNull(),
	signed: boolean('signed').default(false).notNull(),
	signature: text('signature'),  // Para almacenar la firma en base64
	accessToken: uuid('accessToken').defaultRandom(),
});

export const TransactionRelations = relations(Transaction, ({ one, many }) => ({
	category: one(Category, {
		fields: [Transaction.categoryId],
		references: [Category.id]
	}),
	fromAccount: one(AccountOnBusiness, {
		relationName: "fromAccount",
		fields: [Transaction.fromAccountId],
		references: [AccountOnBusiness.id]
	}),
	toAccount: one(AccountOnBusiness, {
		relationName: "toAccount",
		fields: [Transaction.toAccountId],
		references: [AccountOnBusiness.id]
	}),
	member: one(Member, {
		fields: [Transaction.memberId],
		references: [Member.id]
	}),
	person: one(Person, {
		fields: [Transaction.personId],
		references: [Person.id]
	}),
	documents: many(Document),
	transactionGroup: one(TransactionGroup, {
		fields: [Transaction.transactionGroupId],
		references: [TransactionGroup.id]
	})
}));

export const Category = pgTable('category', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	name: varchar('name', { length: 255 }).notNull(),
	about: varchar('about', { length: 255 }),
	discharged: boolean('discharged').default(true).notNull(),
	guildSlug: varchar('guildSlug').notNull()
});

export const CategoryRelations = relations(Category, ({ one, many }) => ({
	guild: one(Guild, {
		fields: [Category.guildSlug],
		references: [Guild.guildSlug]
	}),
	categoriesOnDictionaryAccounts: many(CategoriesOnDictionaryAccount),
	documents: many(Document),
	transactions: many(Transaction),
}));

export const Person = pgTable('person', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	name: varchar('name', { length: 255 }).notNull(),
	image: varchar('image', { length: 255 }),
	identifier: varchar('identifier'),
	identifierType: varchar("identifierType", { length: 255 }).$type<"DNI" | "CUIT" | "CUIL">(),
	email: varchar('email', { length: 255 }),  // Nuevo campo
	phone: varchar('phone', { length: 50 }),   // Nuevo campo
	discharged: boolean('discharged').default(true).notNull(),
	guildSlug: varchar('guildSlug').notNull()
});

export const PersonRelations = relations(Person, ({ one, many }) => ({
	guild: one(Guild, {
		fields: [Person.guildSlug],
		references: [Guild.guildSlug]
	}),
	transactions: many(Transaction),
	checks: many(Check),
	loans: many(Loan),           // Nueva relación
	credits: many(Credit),       // Nueva relación
	cables: many(Cable)   // Nueva relación
}));

export const Document = pgTable('document', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	name: varchar('name', { length: 255 }).notNull(),
	about: varchar('about', { length: 255 }),
	discharged: boolean('discharged').default(true).notNull(),
	transactionId: uuid('transactionId').notNull().references(() => Transaction.id, { onDelete: "cascade" }),
	categoryId: uuid('categoryId').references(() => Category.id, { onDelete: "cascade" }),
	amount: numeric('amount').$type<number>(),
	date: timestamp('date').defaultNow().notNull()
});

export const DocumentRelations = relations(Document, ({ one }) => ({
	category: one(Category, {
		fields: [Document.categoryId],
		references: [Category.id]
	}),
	transaction: one(Transaction, {
		fields: [Document.transactionId],
		references: [Transaction.id]
	})
}));

export const Member = pgTable('member', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	role: RoleEnum("role").default("MEMBER").notNull(),
	discharged: boolean('discharged').default(true).notNull(),
	userId: uuid('userId').notNull().references(() => User.id, { onDelete: "cascade" }),
	guildSlug: varchar('guildSlug').notNull(),
	status: StatusEnum("status").default("PENDING").notNull()
});

// Actualizar las relaciones de Member
export const MemberRelations = relations(Member, ({ one, many }) => ({
	guild: one(Guild, {
		fields: [Member.guildSlug],
		references: [Guild.guildSlug]
	}),
	user: one(User, {
		fields: [Member.userId],
		references: [User.id]
	}),
	businesses: many(MemberOnBusiness),
	checks: many(Check),
	transactions: many(Transaction),
	loans: many(Loan),
	credits: many(Credit),
	cables: many(Cable)
}));

export const Guild = pgTable('guild', {
	guildSlug: varchar('guildSlug', { length: 255 }).notNull().primaryKey(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	name: varchar('name', { length: 255 }).notNull(),
	discharged: boolean('discharged').default(true).notNull(),
	image: varchar('image', { length: 255 }).default('https://www.svgrepo.com/show/476998/village.svg')
});

export const GuildRelations = relations(Guild, ({ many }) => ({
	businesses: many(Business),
	transactionGroups: many(TransactionGroup),
	checks: many(Check),
	categories: many(Category),
	dictionaryAccounts: many(DictionaryAccount),
	invites: many(Invite),
	members: many(Member),
	people: many(Person),
	petitions: many(Petition),
	logs: many(Log),
	loans: many(Loan),           // Nueva relación
	credits: many(Credit),       // Nueva relación
	cables: many(Cable)          // Nueva relación
}));

export const Business = pgTable('business', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	name: varchar('name', { length: 255 }).notNull(),
	businessSlug: varchar('businessSlug', { length: 255 }).notNull(),
	discharged: boolean('discharged').default(true).notNull(),
	guildSlug: varchar('guildSlug').notNull(),
	image: varchar('image', { length: 255 }).default('https://www.svgrepo.com/show/477000/ocean.svg')
});

export const BusinessRelations = relations(Business, ({ one, many }) => ({
	guild: one(Guild, {
		fields: [Business.guildSlug],
		references: [Guild.guildSlug]
	}),
	transactionGroups: many(TransactionGroup),
	accountsOnBusinesses: many(AccountOnBusiness),
	logs: many(Log),
	loans: many(Loan),           // Nueva relación
	credits: many(Credit),       // Nueva relación
	cables: many(Cable)          // Nueva relación
}));

export const Check = pgTable('check', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	purchaseDate: timestamp('purchaseDate'),
	saleDate: timestamp('saleDate'),
	buyerPersonId: uuid('buyerPersonId').references(() => Person.id, { onDelete: 'set null' }),
	collectionDate: timestamp('collectionDate').notNull(),
	serviceFeeRate: numeric('serviceFeeRate').notNull(),
	monthlyInterestRate: numeric('monthlyInterestRate').notNull(),
	carriedInterestRate: numeric('carriedInterestRate').notNull(),
	bankClearing: integer("bankClearing"),
	saleServiceFeeRate: numeric('saleServiceFeeRate'),
	saleMonthlyInterestRate: numeric('saleMonthlyInterestRate'),
	saleCarriedInterestRate: numeric('saleCarriedInterestRate'),
	saleGrossValue: numeric('saleGrossValue'),
	saleNetValue: numeric('saleNetValue'),
	saleServiceFeeAmount: numeric('saleServiceFeeAmount'),
	saleInterestRateAmount: numeric('saleInterestRateAmount'),
	grossValue: numeric('grossValue').notNull(),
	netValue: numeric('netValue').notNull(),
	serviceFeeAmount: numeric('serviceFeeAmount').notNull(),
	interestRateAmount: numeric('interestRateAmount').notNull(),
	currency: CurrencyEnum("currency").notNull(),
	checkWriter: text('checkWriter').notNull(),
	checkNumber: text('checkNumber'),
	bankName: text('bankName'),
	about: varchar('about', { length: 255 }),
	discharged: boolean('discharged').default(true).notNull(),
	guildSlug: varchar('guildSlug').notNull(),
	businessId: uuid('businessId').notNull().references(() => Business.id, { onDelete: "cascade" }),
	memberId: uuid('memberId').notNull().references(() => Member.id, { onDelete: "cascade" }),
	personId: uuid('personId').references(() => Person.id, { onDelete: "cascade" }),
	status: CheckStatusEnum("status").default("PURCHASED").notNull()
});

export const CheckRelations = relations(Check, ({ one }) => ({
	guild: one(Guild, {
		fields: [Check.guildSlug],
		references: [Guild.guildSlug]
	}),
	business: one(Business, {
		fields: [Check.businessId],
		references: [Business.id]
	}),
	member: one(Member, {
		fields: [Check.memberId],
		references: [Member.id]
	}),
	person: one(Person, { // Quien TE VENDIÓ el cheque
		relationName: 'seller', // Renombrar para claridad
		fields: [Check.personId],
		references: [Person.id]
	}),
	buyerPerson: one(Person, { // NUEVO: Quien TE COMPRÓ el cheque
		relationName: 'buyer',
		fields: [Check.buyerPersonId],
		references: [Person.id]
	})
}));

export const TransactionGroup = pgTable('transactionGroup', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	name: varchar('name', { length: 255 }).notNull(),
	description: varchar('description', { length: 1000 }),
	discharged: boolean('discharged').default(true).notNull(),
	guildSlug: varchar('guildSlug').notNull(),
	businessId: uuid('businessId').references(() => Business.id, { onDelete: "cascade" }),
	operationType: OperationTypeEnum("operationType").default("REGULAR").notNull(),
});

export const TransactionGroupRelations = relations(TransactionGroup, ({ many, one }) => ({
	transactions: many(Transaction),
	guild: one(Guild, {
		fields: [TransactionGroup.guildSlug],
		references: [Guild.guildSlug]
	}),
	business: one(Business, {
		fields: [TransactionGroup.businessId],
		references: [Business.id]
	}),
	checksOnTransactionGroup: many(CheckOnTransactionGroup),
	loansOnTransactionGroup: many(LoanOnTransactionGroup),
	creditsOnTransactionGroup: many(CreditOnTransactionGroup),
	cablesOnTransactionGroup: many(CableOnTransactionGroup)
}));

export const Loan = pgTable('loan', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	guildSlug: varchar('guildSlug').notNull().references(() => Guild.guildSlug, { onDelete: "cascade" }),
	businessId: uuid('businessId').notNull().references(() => Business.id, { onDelete: "cascade" }),
	memberId: uuid('memberId').notNull().references(() => Member.id, { onDelete: "cascade" }),
	personId: uuid('personId').references(() => Person.id, { onDelete: "cascade" }), // <-- VOLVEMOS A AÑADIR notNull()
	purchaseDate: timestamp('purchaseDate').notNull(),
	currency: CurrencyEnum("currency").notNull(), // Ya no necesita default
	finalExpectedCollectionDate: timestamp('collectionDate').notNull(),
	grossValue: numeric('grossValue').notNull(),
	totalInterestAmount: numeric('totalInterestAmount').notNull(),
	totalLoanValue: numeric('totalLoanValue').notNull(),
	numberOfInstallments: integer('numberOfInstallments').notNull(),
	paymentPeriodicity: PaymentPeriodicityEnum("paymentPeriodicity").notNull(),
	principalPerInstallment: numeric('principalPerInstallment'),
	interestPerInstallment: numeric('interestPerInstallment'),
	paidPrincipal: numeric('paidPrincipal').default("0"),
	paidInterest: numeric('paidInterest').default("0"),
	remainingPrincipal: numeric('remainingPrincipal'),
	status: LoanStatusEnum("status").default('ACTIVE').notNull(),
	guaranteeDetails: text('guaranteeDetails'),
	about: varchar('about', { length: 255 }),
	alertsConfig: jsonb('alertsConfig').$type<{ leadTimes: { days: number; type: 'BEFORE_DUE' | 'ON_DUE' | 'AFTER_DUE' }[] }>().default({ leadTimes: [] }),
	discharged: boolean('discharged').default(true).notNull(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt').$onUpdate(() => new Date()),
});

export const LoanRelations = relations(Loan, ({ one, many }) => ({
	business: one(Business, {
		fields: [Loan.businessId],
		references: [Business.id]
	}),
	member: one(Member, {
		fields: [Loan.memberId],
		references: [Member.id]
	}),
	person: one(Person, {
		fields: [Loan.personId],
		references: [Person.id]
	}),
	guild: one(Guild, {
		fields: [Loan.guildSlug],
		references: [Guild.guildSlug]
	}),
	installments: many(Installment),
	loansOnTransactionGroup: many(LoanOnTransactionGroup)
}));

export const Installment = pgTable('installment', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt').$onUpdate(() => new Date()),
	parentType: InstallmentParentTypeEnum("parentType").notNull().default('LOAN'),
	loanId: uuid('loanId').references(() => Loan.id, { onDelete: 'cascade' }),
	creditId: uuid('creditId').references(() => Credit.id, { onDelete: 'cascade' }),
	installmentNumber: integer('installmentNumber').notNull(),
	dueDate: timestamp('dueDate').notNull(),
	principalAmount: numeric('principalAmount').default("0").notNull(),
	interestAmount: numeric('interestAmount').notNull(),
	totalAmount: numeric('totalAmount').notNull(),
	paidAmount: numeric('paidAmount').default("0"),
	paidDate: timestamp('paidDate'),
	status: InstallmentStatusEnum("status").default('PENDING').notNull(),
	notes: text('notes'),
	paymentTransactionId: uuid('paymentTransactionId').references(() => Transaction.id, { onDelete: 'set null' }),
});
export const InstallmentRelations = relations(Installment, ({ one }) => ({
	loan: one(Loan, { fields: [Installment.loanId], references: [Loan.id] }),
	credit: one(Credit, { fields: [Installment.creditId], references: [Credit.id] }),
	paymentTransaction: one(Transaction, { fields: [Installment.paymentTransactionId], references: [Transaction.id] }),
}));

export const Credit = pgTable('credit', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	guildSlug: varchar('guildSlug').notNull().references(() => Guild.guildSlug, { onDelete: "cascade" }),
	businessId: uuid('businessId').notNull().references(() => Business.id, { onDelete: "cascade" }),
	memberId: uuid('memberId').notNull().references(() => Member.id, { onDelete: "cascade" }),
	personId: uuid('personId').references(() => Person.id, { onDelete: "cascade" }), // <-- VOLVEMOS A AÑADIR notNull()
	purchaseDate: timestamp('purchaseDate').notNull(),
	currency: CurrencyEnum("currency").notNull(),
	finalExpectedCollectionDate: timestamp('collectionDate').notNull(),
	grossValue: numeric('grossValue').notNull(),
	totalInterestAmount: numeric('totalInterestAmount').notNull(),
	totalCreditValue: numeric('totalCreditValue').notNull(),
	numberOfInstallments: integer('numberOfInstallments').notNull(),
	paymentPeriodicity: PaymentPeriodicityEnum("paymentPeriodicity").notNull(),
	paidInterest: numeric('paidInterest').default("0"),
	status: LoanStatusEnum("status").default('ACTIVE').notNull(),
	about: varchar('about', { length: 255 }),
	alertsConfig: jsonb('alertsConfig').$type<{ leadTimes: { days: number; type: 'BEFORE_DUE' | 'ON_DUE' | 'AFTER_DUE' }[] }>().default({ leadTimes: [] }),
	discharged: boolean('discharged').default(true).notNull(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt').$onUpdate(() => new Date()),
});

export const CreditRelations = relations(Credit, ({ one, many }) => ({
	business: one(Business, {
		fields: [Credit.businessId],
		references: [Business.id]
	}),
	member: one(Member, {
		fields: [Credit.memberId],
		references: [Member.id]
	}),
	person: one(Person, {
		fields: [Credit.personId],
		references: [Person.id]
	}),
	guild: one(Guild, {
		fields: [Credit.guildSlug],
		references: [Guild.guildSlug]
	}),
	installments: many(Installment), // Nueva relación
	creditsOnTransactionGroup: many(CreditOnTransactionGroup)
}));

export const Cable = pgTable('cable', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	amount: numeric('amount').notNull(),
	serviceFeeRate: numeric('serviceFeeRate').notNull(),
	serviceFeeAmount: numeric('serviceFeeAmount').notNull(),
	about: varchar('about', { length: 255 }),
	discharged: boolean('discharged').default(true).notNull(),
	guildSlug: varchar('guildSlug').notNull(),
	businessId: uuid('businessId').notNull().references(() => Business.id, { onDelete: "cascade" }),
	memberId: uuid('memberId').notNull().references(() => Member.id, { onDelete: "cascade" }),
	personId: uuid('personId').references(() => Person.id, { onDelete: "cascade" }),
});

export const CableRelations = relations(Cable, ({ one, many }) => ({
	business: one(Business, {
		fields: [Cable.businessId],
		references: [Business.id]
	}),
	member: one(Member, {
		fields: [Cable.memberId],
		references: [Member.id]
	}),
	person: one(Person, {
		fields: [Cable.personId],
		references: [Person.id]
	}),
	guild: one(Guild, {
		fields: [Cable.guildSlug],
		references: [Guild.guildSlug]
	}),
	cablesOnTransactionGroup: many(CableOnTransactionGroup)
}));

export const CheckOnTransactionGroup = pgTable('checkOnTransactionGroup', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	checkId: uuid('checkId').notNull().references(() => Check.id, { onDelete: "cascade" }),
	transactionGroupId: uuid('transactionGroupId').notNull().references(() => TransactionGroup.id, { onDelete: "cascade" }),
});

export const CheckOnTransactionGroupRelations = relations(CheckOnTransactionGroup, ({ one }) => ({
	check: one(Check, {
		fields: [CheckOnTransactionGroup.checkId],
		references: [Check.id]
	}),
	transactionGroup: one(TransactionGroup, {
		fields: [CheckOnTransactionGroup.transactionGroupId],
		references: [TransactionGroup.id]
	})
}));

export const LoanOnTransactionGroup = pgTable('loanOnTransactionGroup', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	loanId: uuid('loanId').notNull().references(() => Loan.id, { onDelete: "cascade" }),
	transactionGroupId: uuid('transactionGroupId').notNull().references(() => TransactionGroup.id, { onDelete: "cascade" }),
});

export const LoanOnTransactionGroupRelations = relations(LoanOnTransactionGroup, ({ one }) => ({
	loan: one(Loan, {
		fields: [LoanOnTransactionGroup.loanId],
		references: [Loan.id]
	}),
	transactionGroup: one(TransactionGroup, {
		fields: [LoanOnTransactionGroup.transactionGroupId],
		references: [TransactionGroup.id]
	})
}));

export const CreditOnTransactionGroup = pgTable('creditOnTransactionGroup', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	creditId: uuid('creditId').notNull().references(() => Credit.id, { onDelete: "cascade" }),
	transactionGroupId: uuid('transactionGroupId').notNull().references(() => TransactionGroup.id, { onDelete: "cascade" }),
});

export const CreditOnTransactionGroupRelations = relations(CreditOnTransactionGroup, ({ one }) => ({
	credit: one(Credit, {
		fields: [CreditOnTransactionGroup.creditId],
		references: [Credit.id]
	}),
	transactionGroup: one(TransactionGroup, {
		fields: [CreditOnTransactionGroup.transactionGroupId],
		references: [TransactionGroup.id]
	})
}));

export const CableOnTransactionGroup = pgTable('cableOnTransactionGroup', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	cableId: uuid('cableId').notNull().references(() => Cable.id, { onDelete: "cascade" }),
	transactionGroupId: uuid('transactionGroupId').notNull().references(() => TransactionGroup.id, { onDelete: "cascade" }),
});

export const CableOnTransactionGroupRelations = relations(CableOnTransactionGroup, ({ one }) => ({
	cable: one(Cable, {
		fields: [CableOnTransactionGroup.cableId],
		references: [Cable.id]
	}),
	transactionGroup: one(TransactionGroup, {
		fields: [CableOnTransactionGroup.transactionGroupId],
		references: [TransactionGroup.id]
	})
}));

export const Machinery = pgTable('machinery', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	name: varchar('name', { length: 255 }).notNull(),
	image: varchar('image', { length: 255 }),
	identifier: varchar('identifier'), // Número de serie, patente, etc
	brand: varchar('brand', { length: 255 }),
	model: varchar('model', { length: 255 }),
	year: varchar('year', { length: 4 }),
	discharged: boolean('discharged').default(true).notNull(),
	guildSlug: varchar('guildSlug').notNull()
});

export const MachineryRelations = relations(Machinery, ({ one, many }) => ({
	guild: one(Guild, {
		fields: [Machinery.guildSlug],
		references: [Guild.guildSlug]
	}),
	accountsOnBusiness: many(AccountOnBusiness)
}));

export const Vehicle = pgTable('vehicle', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	name: varchar('name', { length: 255 }).notNull(),
	image: varchar('image', { length: 255 }),
	identifier: varchar('identifier'), // Patente
	purchaseDate: timestamp('purchaseDate').defaultNow(),
	about: text("about"),
	mileage: numeric('mileage'),
	brand: varchar('brand', { length: 255 }),
	model: varchar('model', { length: 255 }),
	year: varchar('year', { length: 4 }),
	discharged: boolean('discharged').default(true).notNull(),
	guildSlug: varchar('guildSlug').notNull()
});

export const VehicleRelations = relations(Vehicle, ({ one, many }) => ({
	guild: one(Guild, {
		fields: [Vehicle.guildSlug],
		references: [Guild.guildSlug]
	}),
	accountsOnBusiness: many(AccountOnBusiness)
}));

export const Property = pgTable('property', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	name: varchar('name', { length: 255 }).notNull(),
	image: varchar('image', { length: 255 }),
	identifier: varchar('identifier'), // Matrícula, número catastral
	address: varchar('address', { length: 255 }),
	type: varchar('type', { length: 255 }), // Casa, Departamento, Terreno, etc
	size: numeric('size'), // metros cuadrados
	discharged: boolean('discharged').default(true).notNull(),
	guildSlug: varchar('guildSlug').notNull()
});

export const PropertyRelations = relations(Property, ({ one, many }) => ({
	guild: one(Guild, {
		fields: [Property.guildSlug],
		references: [Guild.guildSlug]
	}),
	accountsOnBusiness: many(AccountOnBusiness)
}));

export const MemberOnBusiness = pgTable('memberOnBusiness', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	memberId: uuid('memberId').notNull().references(() => Member.id, { onDelete: "cascade" }),
	businessId: uuid('businessId').notNull().references(() => Business.id, { onDelete: "cascade" }),
	hasFullAccess: boolean('hasFullAccess').default(false).notNull(),
	canWrite: boolean('canWrite').default(false).notNull(),
	canViewOperations: boolean('canViewOperations').default(false).notNull(),
});

export const MemberOnBusinessRelations = relations(MemberOnBusiness, ({ one, many }) => ({
	member: one(Member, {
		fields: [MemberOnBusiness.memberId],
		references: [Member.id]
	}),
	business: one(Business, {
		fields: [MemberOnBusiness.businessId],
		references: [Business.id]
	}),
	accountPermissions: many(MemberOnAccountOnBusiness),
}));

// Nueva tabla para permisos a nivel cuenta
export const MemberOnAccountOnBusiness = pgTable('memberOnAccountOnBusiness', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	updatedAt: timestamp('updatedAt'),
	memberOnBusinessId: uuid('memberOnBusinessId').notNull().references(() => MemberOnBusiness.id, { onDelete: "cascade" }),
	accountOnBusinessId: uuid('accountOnBusinessId').notNull().references(() => AccountOnBusiness.id, { onDelete: "cascade" }),
	canRead: boolean('canRead').default(true).notNull(), // Por defecto siempre puede leer
	canWrite: boolean('canWrite').default(false).notNull(), // Por defecto no puede escribir
});

// Definiendo relaciones para MemberOnAccountOnBusiness
export const MemberOnAccountOnBusinessRelations = relations(MemberOnAccountOnBusiness, ({ one }) => ({
	memberOnBusiness: one(MemberOnBusiness, {
		fields: [MemberOnAccountOnBusiness.memberOnBusinessId],
		references: [MemberOnBusiness.id]
	}),
	accountOnBusiness: one(AccountOnBusiness, {
		fields: [MemberOnAccountOnBusiness.accountOnBusinessId],
		references: [AccountOnBusiness.id]
	})
}));

export const ChatRoom = pgTable('chatRoom', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	guildSlug: varchar('guildSlug').notNull().references(() => Guild.guildSlug, { onDelete: "cascade" }),
});

export const ChatRoomRelations = relations(ChatRoom, ({ many }) => ({
	messages: many(ChatMessage),
	participants: many(ChatParticipant)
}));

// Tabla intermedia para saber qué miembros están en qué sala de chat.
export const ChatParticipant = pgTable('chatParticipant', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	chatRoomId: uuid('chatRoomId').notNull().references(() => ChatRoom.id, { onDelete: "cascade" }),
	memberId: uuid('memberId').notNull().references(() => Member.id, { onDelete: "cascade" }),
});

export const ChatParticipantRelations = relations(ChatParticipant, ({ one }) => ({
	chatRoom: one(ChatRoom, { fields: [ChatParticipant.chatRoomId], references: [ChatRoom.id] }),
	member: one(Member, { fields: [ChatParticipant.memberId], references: [Member.id] }),
}));

// Representa un mensaje individual dentro de una sala de chat.
export const ChatMessage = pgTable('chatMessage', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	chatRoomId: uuid('chatRoomId').notNull().references(() => ChatRoom.id, { onDelete: "cascade" }),
	senderId: uuid('senderId').notNull().references(() => Member.id, { onDelete: "cascade" }),
	content: text('content').notNull(),
	isRead: boolean('isRead').default(false).notNull(),
});

export const ChatMessageRelations = relations(ChatMessage, ({ one }) => ({
	chatRoom: one(ChatRoom, {
		fields: [ChatMessage.chatRoomId],
		references: [ChatRoom.id],
	}),
	sender: one(Member, {
		fields: [ChatMessage.senderId],
		references: [Member.id],
	}),
}));

export const Notification = pgTable('notification', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	memberId: uuid('memberId').notNull().references(() => Member.id, { onDelete: "cascade" }),
	guildSlug: varchar('guildSlug').notNull(),
	type: NotificationTypeEnum("type").notNull(),
	title: varchar('title', { length: 255 }).notNull(),
	body: text('body').notNull(),
	isRead: boolean('isRead').default(false).notNull(),
	relatedUrl: varchar('relatedUrl', { length: 255 }), // URL opcional para navegar
	scheduledFor: timestamp('scheduledFor').notNull(),
});

export const NotificationRelations = relations(Notification, ({ one }) => ({
	member: one(Member, { fields: [Notification.memberId], references: [Member.id] }),
}));

export type Status = (typeof StatusEnum.enumValues[number])
export type NotificationType = (typeof NotificationTypeEnum.enumValues[number])
export type CheckStatus = (typeof CheckStatusEnum.enumValues[number])
export type Role = (typeof RoleEnum.enumValues[number])
export type Currency = (typeof CurrencyEnum.enumValues[number])
export type AccountType = (typeof AccountTypeEnum.enumValues[number])
export type TransactionType = (typeof TransactionTypeEnum.enumValues[number])
export type OperationType = (typeof OperationTypeEnum.enumValues[number])
export type EntityType = (typeof EntityTypeEnum.enumValues[number])
export type LoanStatus = (typeof LoanStatusEnum.enumValues[number])
export type PaymentPeriodicity = (typeof PaymentPeriodicityEnum.enumValues[number])
export type InstallmentStatus = (typeof InstallmentStatusEnum.enumValues[number])

export type UserSchema = typeof User.$inferSelect
export type NotificationSchema = typeof Notification.$inferSelect
export type PetitionSchema = typeof Petition.$inferSelect
export type InviteSchema = typeof Invite.$inferSelect
export type AccountOnBusinessSchema = typeof AccountOnBusiness.$inferSelect
export type LogSchema = typeof Log.$inferSelect
export type CategoriesOnDictionaryAccountSchema = typeof CategoriesOnDictionaryAccount.$inferSelect
export type DictionaryAccountSchema = typeof DictionaryAccount.$inferSelect
export type TransactionSchema = typeof Transaction.$inferSelect
export type CategorySchema = typeof Category.$inferSelect
export type PersonSchema = typeof Person.$inferSelect
export type DocumentSchema = typeof Document.$inferSelect
export type MemberSchema = typeof Member.$inferSelect
export type GuildSchema = typeof Guild.$inferSelect
export type BusinessSchema = typeof Business.$inferSelect
export type CheckSchema = typeof Check.$inferSelect
export type TransactionGroupSchema = typeof TransactionGroup.$inferSelect
export type LoanSchema = typeof Loan.$inferSelect
export type CreditSchema = typeof Credit.$inferSelect
export type CableSchema = typeof Cable.$inferSelect
export type CheckOnTransactionGroupSchema = typeof CheckOnTransactionGroup.$inferSelect
export type LoanOnTransactionGroupSchema = typeof LoanOnTransactionGroup.$inferSelect
export type CreditOnTransactionGroupSchema = typeof CreditOnTransactionGroup.$inferSelect
export type CableOnTransactionGroupSchema = typeof CableOnTransactionGroup.$inferSelect
export type MachinerySchema = typeof Machinery.$inferSelect
export type VehicleSchema = typeof Vehicle.$inferSelect
export type PropertySchema = typeof Property.$inferSelect
export type Action = (typeof ActionEnum.enumValues[number])
export type ResourceType = (typeof ResourceTypeEnum.enumValues[number])
export type MemberOnBusinessSchema = typeof MemberOnBusiness.$inferSelect
export type Member = typeof Member.$inferSelect

// --- Auth por cookie (login simple) ---
export const Session = pgTable('session', {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	token: text('token').notNull().unique(),
	userId: uuid('userId').notNull().references(() => User.id, { onDelete: "cascade" }),
	createdAt: timestamp('createdAt').defaultNow().notNull(),
	expiresAt: timestamp('expiresAt').notNull(),
});

export const SessionRelations = relations(Session, ({ one }) => ({
	user: one(User, { fields: [Session.userId], references: [User.id] }),
}));

export type SessionSchema = typeof Session.$inferSelect
