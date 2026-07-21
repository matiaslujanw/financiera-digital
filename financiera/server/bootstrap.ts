import "server-only";

import { eq } from "drizzle-orm";

import { db } from "./db";
import type { AccountType, Currency, EntityType } from "./db/schema";
import {
	AccountOnBusiness,
	Business,
	DictionaryAccount,
	Guild,
	Member,
} from "./db/schema";

export function slugify(input: string): string {
	return (
		input
			.toLowerCase()
			.normalize("NFD")
			.replace(/[̀-ͯ]/g, "")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 60) || "negocio"
	);
}

interface DefaultAccount {
	name: string;
	accountType: AccountType;
	checkAccount?: boolean;
	availability?: boolean;
	hasSubAccounts?: boolean;
	entityType?: EntityType;
}

// Plan de cuentas por defecto de una financiera (todo en ARS).
const DEFAULT_ACCOUNTS: DefaultAccount[] = [
	{ name: "Efectivo", accountType: "ASSET", availability: true },
	{ name: "Banco", accountType: "ASSET", availability: true },
	{ name: "Cartera de cheques", accountType: "ASSET", checkAccount: true },
	{ name: "Personas", accountType: "ASSET", hasSubAccounts: true, entityType: "PERSON" },
	{ name: "Pesificación", accountType: "REVENUE" },
	{ name: "Intereses cobrados", accountType: "REVENUE" },
	{ name: "Comisión cable", accountType: "REVENUE" },
	{ name: "Préstamos cobrados", accountType: "REVENUE" },
	{ name: "Gastos generales", accountType: "EXPENSE" },
	{ name: "Cheques a pagar", accountType: "LIABILITY" },
];

const DEFAULT_CURRENCY: Currency = "ARS";

async function uniqueGuildSlug(base: string): Promise<string> {
	const root = slugify(base);
	let candidate = root;
	let n = 1;
	// PK: guildSlug. Reintenta con sufijo hasta encontrar libre.
	while (
		await db.query.Guild.findFirst({ where: eq(Guild.guildSlug, candidate) })
	) {
		n += 1;
		candidate = `${root}-${n}`;
	}
	return candidate;
}

/**
 * Crea un negocio (guild) completo para el usuario dueño:
 * Guild + Member OWNER + Business inicial + plan de cuentas + cuentas del negocio.
 */
export async function bootstrapGuild(opts: {
	userId: string;
	guildName: string;
	businessName?: string;
}): Promise<{ guildSlug: string }> {
	const guildSlug = await uniqueGuildSlug(opts.guildName);
	const businessName = opts.businessName?.trim() || "Finanzas personales";

	await db.transaction(async (tx) => {
		await tx.insert(Guild).values({ guildSlug, name: opts.guildName });

		await tx.insert(Member).values({
			userId: opts.userId,
			guildSlug,
			role: "OWNER",
			status: "SUCCESS",
		});

		const [business] = await tx
			.insert(Business)
			.values({ name: businessName, businessSlug: slugify(businessName), guildSlug })
			.returning();

		for (const acc of DEFAULT_ACCOUNTS) {
			const [dict] = await tx
				.insert(DictionaryAccount)
				.values({
					name: acc.name,
					accountType: acc.accountType,
					currency: DEFAULT_CURRENCY,
					checkAccount: acc.checkAccount ?? false,
					availability: acc.availability ?? false,
					hasSubAccounts: acc.hasSubAccounts ?? false,
					entityType: acc.entityType ?? null,
					guildSlug,
					slug: slugify(acc.name),
				})
				.returning();

			await tx.insert(AccountOnBusiness).values({
				businessId: business!.id,
				dictionaryAccountId: dict!.id,
				currentBalance: "0",
			});
		}
	});

	return { guildSlug };
}
