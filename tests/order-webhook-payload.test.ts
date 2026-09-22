import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InvalidOrderPayloadError,
  parseOrderWebhook,
} from "../app/lib/order-webhook";

const payload = {
  id: 123456789,
  name: "#1001",
  total_price: "0012.3400",
  currency: "USD",
  payment_gateway_names: [" Cash on Delivery (COD) "],
  created_at: "2026-09-22T09:30:45+03:00",
  financial_status: "pending",
};

function rejectsField(field: string, value: unknown): void {
  assert.throws(
    () => parseOrderWebhook({ ...payload, [field]: value }),
    (error: unknown) =>
      error instanceof InvalidOrderPayloadError &&
      error.message.startsWith(`${field} `),
  );
}

test("maps only required order fields and converts the timezone to a Date", () => {
  assert.deepEqual(
    parseOrderWebhook({
      ...payload,
      customer: { email: "customer@example.invalid" },
      shipping_address: { name: "Unused customer name" },
    }),
    {
      orderId: "123456789",
      name: "#1001",
      total: "12.34",
      currency: "USD",
      gatewayNames: [" Cash on Delivery (COD) "],
      createdAt: new Date("2026-09-22T06:30:45.000Z"),
      financialStatus: "pending",
    },
  );
});

test("keeps string IDs and decimal totals exact beyond JavaScript precision", () => {
  const parsed = parseOrderWebhook({
    ...payload,
    id: "9007199254740993123456789",
    total_price: "9007199254740993.123456789",
  });
  assert.equal(parsed.orderId, "9007199254740993123456789");
  assert.equal(parsed.total, "9007199254740993.123456789");
  assert.equal(
    parseOrderWebhook({ ...payload, id: Number.MAX_SAFE_INTEGER }).orderId,
    "9007199254740991",
  );
});

test("rejects absent, unsafe, nonpositive, and malformed order IDs", () => {
  for (const id of [
    undefined,
    null,
    true,
    {},
    [],
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "",
    "0",
    "-1",
    "01",
    "+1",
    "1.0",
    "1e3",
    " 123",
    "123 ",
    "123\n",
    "123\r\n",
  ])
    rejectsField("id", id);
});

test("rejects non-object payloads", () => {
  for (const invalid of [null, undefined, [], "order", 123, true]) {
    assert.throws(() => parseOrderWebhook(invalid), InvalidOrderPayloadError);
  }
});

test("requires a nonempty order name without outer whitespace", () => {
  for (const name of [undefined, null, 123, "", " ", " #1001", "#1001\n"]) {
    rejectsField("name", name);
  }
});

test("requires an exact nonnegative decimal string total and uppercase currency", () => {
  for (const total of [
    undefined,
    null,
    1.23,
    "",
    "NaN",
    "Infinity",
    "-1",
    "+1",
    "1e2",
    ".5",
    "1.",
    "1\n",
  ]) {
    rejectsField("total_price", total);
  }
  for (const currency of [
    undefined,
    null,
    123,
    "",
    "US",
    "usd",
    "USDD",
    "USD\n",
  ]) {
    rejectsField("currency", currency);
  }
  assert.equal(
    parseOrderWebhook({ ...payload, total_price: "0.00" }).total,
    "0",
  );
});

test("accepts valid leap dates, negative offsets, and fractional seconds", () => {
  assert.equal(
    parseOrderWebhook({
      ...payload,
      created_at: "2024-02-29T23:59:59.123-05:00",
    }).createdAt.toISOString(),
    "2024-03-01T04:59:59.123Z",
  );
  assert.equal(
    parseOrderWebhook({
      ...payload,
      created_at: "2000-02-29T00:00:00Z",
    }).createdAt.toISOString(),
    "2000-02-29T00:00:00.000Z",
  );
});

test("rejects missing timezones, impossible dates, and malformed timestamps", () => {
  for (const createdAt of [
    undefined,
    null,
    1727000000,
    "",
    "not-a-date",
    "2026-09-22",
    "2026-09-22T09:30:45",
    "2026-02-29T00:00:00Z",
    "1900-02-29T00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-00-01T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-09-00T00:00:00Z",
    "2026-09-22T24:00:00Z",
    "2026-09-22T00:60:00Z",
    "2026-09-22T00:00:60Z",
    "2026-09-22T00:00:00+24:00",
    "2026-09-22T00:00:00+03:60",
    "2026-09-22T00:00:00Z\n",
  ])
    rejectsField("created_at", createdAt);
});

test("defaults missing or null gateways to an empty array and validates supplied gateways", () => {
  const withoutGateways: Record<string, unknown> = { ...payload };
  delete withoutGateways.payment_gateway_names;
  assert.deepEqual(parseOrderWebhook(withoutGateways).gatewayNames, []);
  assert.deepEqual(
    parseOrderWebhook({ ...payload, payment_gateway_names: null }).gatewayNames,
    [],
  );
  for (const gateways of ["manual", {}, [123], ["cash", null]]) {
    rejectsField("payment_gateway_names", gateways);
  }
});

test("allows missing or null financial status but requires a string when supplied", () => {
  const withoutStatus: Record<string, unknown> = { ...payload };
  delete withoutStatus.financial_status;
  assert.equal(parseOrderWebhook(withoutStatus).financialStatus, undefined);
  assert.equal(
    parseOrderWebhook({ ...payload, financial_status: null }).financialStatus,
    null,
  );
  for (const status of [123, false, [], {}])
    rejectsField("financial_status", status);
});

test("payload errors disclose field requirements without echoing customer values", () => {
  const sensitiveValue = "customer-private-value@example.invalid";
  assert.throws(
    () => parseOrderWebhook({ ...payload, total_price: sensitiveValue }),
    (error: unknown) =>
      error instanceof InvalidOrderPayloadError &&
      error.message.startsWith("total_price ") &&
      !error.message.includes(sensitiveValue),
  );
});
