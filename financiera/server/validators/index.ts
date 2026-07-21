import { z } from "zod";

// Los IDs de cuenta en el input son de DictionaryAccount; el server resuelve
// la AccountOnBusiness real (o crea la subcuenta por entidad).

export const EntityTypeSchema = z.enum([
	"PERSON",
	"MACHINERY",
	"VEHICLE",
	"PROPERTY",
]);

export const MovementSchema = z.object({
	increment: z.string().optional().nullable(),
	decrement: z.string().optional().nullable(),
});

export const TransactionDocumentSchema = z.object({
	date: z.coerce.date(),
	name: z.string(),
	about: z.string().optional(),
	amount: z.string().optional(),
});

export const TransactionCreateSchema = z.object({
	guildSlug: z.string().min(1),

	// Destino (obligatorio)
	toBusinessId: z.string(),
	toAccountId: z.string(), // dictionaryAccount id

	// Origen (opcional: si está, es transacción entre dos cuentas)
	fromBusinessId: z.string().optional(),
	fromAccountId: z.string().optional(), // dictionaryAccount id

	// Entidad para subcuentas (Personas, Vehículos, etc.)
	entityId: z.string().optional(),
	entityType: EntityTypeSchema.optional(),

	date: z.coerce.date(),
	isMidnight: z.boolean().optional(),

	movement: MovementSchema,

	exchangeRate: z.union([z.string(), z.number()]).optional(),
	fromCurrency: z
		.enum([
			"ARS",
			"USD",
			"EUR",
			"CNY",
			"AUD",
			"GBP",
			"BRL",
			"CAD",
			"JPY",
			"CHF",
			"USDT",
			"MXN",
		])
		.optional(),

	about: z.string().optional(),
	categoryId: z.string().optional(),
	requiresSignature: z.boolean().optional(),

	documents: z.array(TransactionDocumentSchema).optional(),
});

export type TransactionCreateInput = z.infer<typeof TransactionCreateSchema>;

export const CheckPurchaseSchema = z
	.object({
		guildSlug: z.string().min(1),
		businessId: z.string().uuid(),
		purchaseDate: z.coerce.date(),
		serviceFeeRate: z.number().min(0).max(100),
		monthlyInterestRate: z.number().min(0).max(1_000),
		customerName: z.string().trim().min(2).max(255),
		about: z.string().trim().max(1_000).optional(),
		checks: z
			.array(
				z.object({
					collectionDate: z.coerce.date(),
					bankClearing: z.number().int().min(0).max(365),
					grossValue: z.number().positive(),
					checkWriter: z.string().trim().min(2).max(255),
					checkNumber: z.string().trim().min(1).max(100),
					bankName: z.string().trim().min(1).max(255),
					about: z.string().trim().max(255).optional(),
				}),
			)
			.min(1)
			.max(50),
	})
	.superRefine((value, ctx) => {
		const purchaseDay = Date.UTC(
			value.purchaseDate.getFullYear(),
			value.purchaseDate.getMonth(),
			value.purchaseDate.getDate(),
		);
		value.checks.forEach((check, index) => {
			const collectionDay = Date.UTC(
				check.collectionDate.getFullYear(),
				check.collectionDate.getMonth(),
				check.collectionDate.getDate(),
			);
			if (collectionDay < purchaseDay) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "La fecha de cobro no puede ser anterior a la compra",
					path: ["checks", index, "collectionDate"],
				});
			}
		});
	});

export type CheckPurchaseInput = z.infer<typeof CheckPurchaseSchema>;

export const CheckSaleSchema = z.object({
	guildSlug: z.string().min(1),
	businessId: z.string().uuid(),
	saleDate: z.coerce.date(),
	serviceFeeRate: z.number().min(0).max(100),
	monthlyInterestRate: z.number().min(0).max(1_000),
	buyerName: z.string().trim().min(2).max(255),
	about: z.string().trim().max(1_000).optional(),
	checkIds: z.array(z.string().uuid()).min(1).max(50),
});

export type CheckSaleInput = z.infer<typeof CheckSaleSchema>;
