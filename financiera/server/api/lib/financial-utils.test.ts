import assert from "node:assert/strict";
import test from "node:test";

import {
	calculateCurrencyExchange,
	calculatePurchaseValues,
	calculateSaleValues,
} from "./financial-utils";

test("calcula pesificación plana e interés simple incluyendo clearing", () => {
	const result = calculatePurchaseValues({
		grossValue: 100_000,
		serviceFeeRate: 3,
		monthlyInterestRate: 6,
		purchaseDate: new Date("2026-07-01T12:00:00-03:00"),
		collectionDate: new Date("2026-07-31T12:00:00-03:00"),
		bankClearing: 2,
	});

	assert.deepEqual(result, {
		grossValue: 100_000,
		serviceFeeRate: 3,
		monthlyInterestRate: 6,
		carriedInterestRate: 6.4,
		bankClearing: 2,
		totalDays: 32,
		serviceFeeAmount: 3_000,
		interestAmount: 6_400,
		netValue: 90_600,
	});
});

test("acepta cobro en el día y tasas cero", () => {
	const result = calculatePurchaseValues({
		grossValue: 50_000,
		serviceFeeRate: 0,
		monthlyInterestRate: 0,
		purchaseDate: new Date("2026-07-21T09:00:00-03:00"),
		collectionDate: new Date("2026-07-21T18:00:00-03:00"),
		bankClearing: 0,
	});

	assert.equal(result.totalDays, 0);
	assert.equal(result.netValue, 50_000);
});

test("rechaza una fecha de cobro anterior a la compra", () => {
	assert.throws(
		() =>
			calculatePurchaseValues({
				grossValue: 10_000,
				serviceFeeRate: 3,
				monthlyInterestRate: 5,
				purchaseDate: new Date("2026-07-21T12:00:00-03:00"),
				collectionDate: new Date("2026-07-20T12:00:00-03:00"),
				bankClearing: 0,
			}),
		/fecha de cobro/i,
	);
});

test("calcula el valor de venta y permite obtener la ganancia sobre el neto de compra", () => {
	const sale = calculateSaleValues({
		grossValue: 100_000,
		serviceFeeRate: 2,
		monthlyInterestRate: 3,
		saleDate: new Date("2026-07-26T12:00:00-03:00"),
		collectionDate: new Date("2026-08-20T12:00:00-03:00"),
		bankClearing: 2,
	});

	assert.equal(sale.totalDays, 27);
	assert.equal(sale.serviceFeeAmount, 2_000);
	assert.equal(sale.interestAmount, 2_700);
	assert.equal(sale.netValue, 95_300);
	assert.equal(sale.netValue - 90_600, 4_700);
});

test("compra moneda extranjera con una cotización expresada en pesos", () => {
	assert.equal(
		calculateCurrencyExchange({
			sourceAmount: 1_450_000,
			exchangeRate: 1_450,
			rateDirection: "TO_FROM",
		}),
		1_000,
	);
});

test("vende moneda extranjera y acredita el equivalente cotizado", () => {
	assert.equal(
		calculateCurrencyExchange({
			sourceAmount: 1_000,
			exchangeRate: 1_470,
			rateDirection: "FROM_TO",
		}),
		1_470_000,
	);
});

test("convierte entre dos monedas extranjeras y rechaza valores inválidos", () => {
	assert.equal(
		calculateCurrencyExchange({
			sourceAmount: 500,
			exchangeRate: 0.92,
			rateDirection: "FROM_TO",
		}),
		460,
	);
	assert.throws(
		() =>
			calculateCurrencyExchange({
				sourceAmount: 500,
				exchangeRate: 0,
				rateDirection: "FROM_TO",
			}),
		/cotización/i,
	);
});
