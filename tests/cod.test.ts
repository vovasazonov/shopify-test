import assert from "node:assert/strict";
import { test } from "node:test";

import { isCodOrder } from "../app/lib/cod";

test("cash gateways are COD regardless of financial status", () => {
  assert.equal(isCodOrder(["Cash on Delivery (COD)"], "pending"), true);
  assert.equal(isCodOrder(["Cash on Delivery (COD)"], "paid"), true);
  assert.equal(isCodOrder(["  CASH on Delivery  "], null), true);
  assert.equal(
    isCodOrder(["shopify_payments", "cashier payment"], "paid"),
    true,
  );
});

test("manual is COD only with the exact pending financial status", () => {
  assert.equal(isCodOrder(["manual"], "pending"), true);
  assert.equal(isCodOrder(["  MaNuAl  "], "pending"), true);
  assert.equal(isCodOrder(["manual"], "paid"), false);
  assert.equal(isCodOrder(["manual"], "Pending"), false);
  assert.equal(isCodOrder(["manual"], " pending "), false);
  assert.equal(isCodOrder(["manual"], undefined), false);
  assert.equal(isCodOrder(["manual payment"], "pending"), false);
});

test("unrelated or missing gateways are not COD", () => {
  assert.equal(isCodOrder(["shopify_payments"], "pending"), false);
  assert.equal(isCodOrder(["COD"], "pending"), false);
  assert.equal(isCodOrder(["  "], "pending"), false);
  assert.equal(isCodOrder([], "pending"), false);
  assert.equal(isCodOrder(null, "pending"), false);
  assert.equal(isCodOrder(undefined, "pending"), false);
});
