import dayjs from "dayjs";

const MONEY_DECIMALS = 2;
const RATE_DECIMALS = 6;

function round(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	return Math.round((value + Number.EPSILON) * factor) / factor;
}

export interface PurchaseValues {
	grossValue: number;
	serviceFeeRate: number;
	monthlyInterestRate: number;
	carriedInterestRate: number;
	bankClearing: number;
	totalDays: number;
	serviceFeeAmount: number;
	interestAmount: number;
	netValue: number;
}

export type SaleValues = PurchaseValues;

/**
 * Calcula el descuento de compra de un cheque.
 *
 * - La pesificación es plana sobre el valor nominal.
 * - El interés mensual se prorratea por día (mes financiero de 30 días).
 * - El clearing bancario suma días al período que devenga interés.
 */
export function calculatePurchaseValues(input: {
	grossValue: number;
	serviceFeeRate: number;
	monthlyInterestRate: number;
	purchaseDate: Date;
	collectionDate: Date;
	bankClearing: number;
}): PurchaseValues {
	const {
		grossValue,
		serviceFeeRate,
		monthlyInterestRate,
		purchaseDate,
		collectionDate,
		bankClearing,
	} = input;

	if (!Number.isFinite(grossValue) || grossValue <= 0) {
		throw new RangeError("El valor nominal debe ser mayor a 0");
	}
	if (!Number.isFinite(serviceFeeRate) || serviceFeeRate < 0) {
		throw new RangeError("La pesificación no puede ser negativa");
	}
	if (!Number.isFinite(monthlyInterestRate) || monthlyInterestRate < 0) {
		throw new RangeError("El interés mensual no puede ser negativo");
	}
	if (!Number.isInteger(bankClearing) || bankClearing < 0) {
		throw new RangeError("El clearing debe ser un entero no negativo");
	}

	const daysBetween = dayjs(collectionDate)
		.startOf("day")
		.diff(dayjs(purchaseDate).startOf("day"), "day");
	if (daysBetween < 0) {
		throw new RangeError("La fecha de cobro no puede ser anterior a la compra");
	}

	const totalDays = daysBetween + bankClearing;
	const serviceFeeAmount = round(
		grossValue * (serviceFeeRate / 100),
		MONEY_DECIMALS,
	);
	const interestAmount = round(
		grossValue * (monthlyInterestRate / 100 / 30) * totalDays,
		MONEY_DECIMALS,
	);
	const netValue = round(
		grossValue - serviceFeeAmount - interestAmount,
		MONEY_DECIMALS,
	);

	return {
		grossValue: round(grossValue, MONEY_DECIMALS),
		serviceFeeRate,
		monthlyInterestRate,
		carriedInterestRate: round(
			(monthlyInterestRate / 30) * totalDays,
			RATE_DECIMALS,
		),
		bankClearing,
		totalDays,
		serviceFeeAmount,
		interestAmount,
		netValue,
	};
}

/** Calcula el valor neto de venta usando los días desde la venta al cobro. */
export function calculateSaleValues(input: {
	grossValue: number;
	serviceFeeRate: number;
	monthlyInterestRate: number;
	saleDate: Date;
	collectionDate: Date;
	bankClearing: number;
}): SaleValues {
	return calculatePurchaseValues({
		grossValue: input.grossValue,
		serviceFeeRate: input.serviceFeeRate,
		monthlyInterestRate: input.monthlyInterestRate,
		purchaseDate: input.saleDate,
		collectionDate: input.collectionDate,
		bankClearing: input.bankClearing,
	});
}
