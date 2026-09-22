import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeAmount,
  sumAmountsByCurrency,
  validateCurrency,
} from "../app/lib/money";

test("amounts normalize without rounding or exponential notation", () => {
  assert.equal(normalizeAmount("0001.2300"), "1.23");
  assert.equal(normalizeAmount("0.00"), "0");
  assert.equal(normalizeAmount("0.000000001"), "0.000000001");
  assert.equal(
    normalizeAmount("123456789012345678901234.12345678901234567890"),
    "123456789012345678901234.1234567890123456789",
  );
});

test("amounts reject invalid and non-decimal input", () => {
  for (const invalid of [
    "",
    " ",
    " 1",
    "1 ",
    "1\n",
    "-1",
    "-0",
    "+1",
    "1e2",
    "Infinity",
    "NaN",
    ".5",
    "1.",
    "1,000",
    "1.2.3",
  ]) {
    assert.throws(() => normalizeAmount(invalid), /plain decimal string/);
  }

  assert.throws(
    () => normalizeAmount(1 as unknown as string),
    /plain decimal string/,
  );
});

test("decimal addition stays exact beyond JavaScript number precision", () => {
  assert.deepEqual(
    sumAmountsByCurrency([
      { total: "0.1", currency: "USD" },
      { total: "0.2", currency: "USD" },
    ]),
    [{ currency: "USD", total: "0.3" }],
  );

  assert.deepEqual(
    sumAmountsByCurrency([
      { total: "9007199254740993.01", currency: "USD" },
      { total: "0.02", currency: "USD" },
    ]),
    [{ currency: "USD", total: "9007199254740993.03" }],
  );
});

test("totals keep currencies separate and sorted, including empty input", () => {
  assert.deepEqual(sumAmountsByCurrency([]), []);
  assert.deepEqual(
    sumAmountsByCurrency([
      { total: "2.50", currency: "USD" },
      { total: "0.001", currency: "KWD" },
      { total: "3.00", currency: "EUR" },
      { total: "1.25", currency: "USD" },
    ]),
    [
      { currency: "EUR", total: "3" },
      { currency: "KWD", total: "0.001" },
      { currency: "USD", total: "3.75" },
    ],
  );
});

test("currency validation and aggregation reject invalid data", () => {
  assert.equal(validateCurrency("USD"), "USD");

  for (const invalid of ["", "US", "USDD", "usd", "USD ", "USD\n", "123"]) {
    assert.throws(() => validateCurrency(invalid), /uppercase code/);
  }

  assert.throws(
    () => sumAmountsByCurrency([{ total: "1", currency: "usd" }]),
    /uppercase code/,
  );
  assert.throws(
    () => sumAmountsByCurrency([{ total: "NaN", currency: "USD" }]),
    /plain decimal string/,
  );
});
