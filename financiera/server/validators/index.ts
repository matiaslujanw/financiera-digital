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
