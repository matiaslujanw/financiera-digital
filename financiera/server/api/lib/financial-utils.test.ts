import assert from "node:assert/strict";
import test from "node:test";

import { calculatePurchaseValues } from "./financial-utils";

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
