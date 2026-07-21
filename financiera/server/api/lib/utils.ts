import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import type { Currency } from "~/server/db/schema";
import { AccountOnBusiness } from "~/server/db/schema";
import { dayjs } from "./dayjs";

/**
 * Normaliza un monto que viene formateado desde la UI (es-AR: "1.234.567,89")
 * a un string parseable por Number(): "1234567.89".
 * También acepta ya-números o strings "1234.56".
 */
export function formatForSubmit(
	value: string | number | null | undefined,
): string {
	if (value === null || value === undefined) return "0";
	if (typeof value === "number") return isFinite(value) ? value.toString() : "0";

	let s = value.trim();
	if (s === "") return "0";

	const hasComma = s.includes(",");
	const hasDot = s.includes(".");
	if (hasComma && hasDot) {
		// Formato es-AR: el punto es separador de miles, la coma es decimal.
		s = s.replace(/\./g, "").replace(",", ".");
	} else if (hasComma) {
		// Solo coma => decimal.
		s = s.replace(",", ".");
	}
	// Quitar cualquier cosa que no sea dígito, punto o signo.
	s = s.replace(/[^0-9.-]/g, "");
	if (s === "" || s === "-" || s === ".") return "0";
	return s;
}

/**
 * Combina el día/mes/año de la fecha del input con la hora actual.
 * Si `isMidnight`, usa las 00:00 de ese día.
 */
export function combineDateWithCurrentTime(
	date: Date | string,
	isMidnight?: boolean,
): Date {
	const d = dayjs(date);
	if (isMidnight) return d.startOf("day").toDate();
	const now = dayjs();
	return d
		.hour(now.hour())
		.minute(now.minute())
		.second(now.second())
		.millisecond(now.millisecond())
		.toDate();
}

/**
 * Convierte un monto entre monedas usando un tipo de cambio.
 * `inputFromCurrency` indica en qué moneda está expresado el tipo de cambio
 * (para saber si multiplicar o dividir). Se refinará en la fase de divisas.
 */
export function convertAmount(
	fromCurrency: Currency,
	toCurrency: Currency,
	amount: number,
	exchangeRate: number,
	inputFromCurrency?: Currency,
): number {
	if (fromCurrency === toCurrency) return amount;
	if (!exchangeRate || exchangeRate <= 0) return amount;
	// Si el tipo de cambio está expresado en la moneda destino, dividimos.
	if (inputFromCurrency && inputFromCurrency === toCurrency) {
		return amount / exchangeRate;
	}
	return amount * exchangeRate;
}

/**
 * Recalcula el balance de la cuenta principal (no-subcuenta) sumando el
 * `currentBalance` de todas sus subcuentas, para un dictionaryAccount+business.
 */
export async function updateParentAccount(
	dictionaryAccountId: string,
	businessId: string,
): Promise<void> {
	const subAccounts = await db
		.select({ currentBalance: AccountOnBusiness.currentBalance })
		.from(AccountOnBusiness)
		.where(
			and(
				eq(AccountOnBusiness.dictionaryAccountId, dictionaryAccountId),
				eq(AccountOnBusiness.businessId, businessId),
				eq(AccountOnBusiness.subAccount, true),
			),
		);

	const total = subAccounts.reduce(
		(sum, a) => sum + (parseFloat(a.currentBalance ?? "0") || 0),
		0,
	);

	await db
		.update(AccountOnBusiness)
		.set({ currentBalance: total.toString(), updatedAt: new Date() })
		.where(
			and(
				eq(AccountOnBusiness.dictionaryAccountId, dictionaryAccountId),
				eq(AccountOnBusiness.businessId, businessId),
				eq(AccountOnBusiness.subAccount, false),
			),
		);
}
