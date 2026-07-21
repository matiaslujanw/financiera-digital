import type {
	AccountType,
	Currency,
	OperationType,
} from "~/server/db/schema";

/** Formatea un número/decimal como "$ 1.234.567,89" (es-AR). */
export function formatPrice(value: number | string | null | undefined): string {
	const n = typeof value === "string" ? parseFloat(value) : (value ?? 0);
	if (!isFinite(n)) return "$ 0,00";
	return (
		"$ " +
		new Intl.NumberFormat("es-AR", {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(n)
	);
}

/** Formatea el monto sin asumir que todas las cuentas son pesos. */
export function formatCurrency(
	value: number | string | null | undefined,
	currency: Currency | string,
): string {
	const n = typeof value === "string" ? Number.parseFloat(value) : (value ?? 0);
	const safe = Number.isFinite(n) ? n : 0;
	return `${new Intl.NumberFormat("es-AR", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 8,
	}).format(safe)} ${currency}`;
}

export const CURRENCY_LABELS: Record<Currency, string> = {
	ARS: "Peso argentino",
	USD: "Dólar estadounidense",
	EUR: "Euro",
	CNY: "Yuan chino",
	AUD: "Dólar australiano",
	GBP: "Libra esterlina",
	BRL: "Real brasileño",
	CAD: "Dólar canadiense",
	JPY: "Yen japonés",
	CHF: "Franco suizo",
	USDT: "Tether",
	MXN: "Peso mexicano",
};

export const CURRENCIES = Object.keys(CURRENCY_LABELS) as Currency[];

const OPERATION_LABELS: Record<OperationType, string> = {
	CHECK_PURCHASE: "C. de cheques",
	CHECK_SALE: "V. de cheques",
	CHECK_DEPOSIT: "Dep. de cheque",
	CHECK_REJECTION: "Cheque rechazado",
	LOAN: "Préstamo",
	CREDIT: "Crédito",
	CABLE: "Cable",
	CURRENCY_EXCHANGE: "Cambio divisas",
	MULTIPLE: "Múltiple",
	REGULAR: "Regular",
};

export function getTypeLabel(op: OperationType | string): string {
	return OPERATION_LABELS[op as OperationType] ?? op;
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
	ASSET: "Activo",
	REVENUE: "Ingreso",
	EXPENSE: "Egreso",
	LIABILITY: "Pasivo",
};

export const ACCOUNT_TYPE_ORDER: AccountType[] = [
	"ASSET",
	"REVENUE",
	"EXPENSE",
	"LIABILITY",
];
