import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { sumAmountsByCurrency } from "../app/lib/money";
import {
  getOrdersForShop,
  saveReceivedOrder,
  type ReceivedOrder,
} from "../app/services/orders.server";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const shopA = "alpha-test.myshopify.com";
const shopB = "beta-test.myshopify.com";
let temporaryDirectory: string;
let client: PrismaClient;

const order: ReceivedOrder = {
  orderId: "9007199254740993",
  name: "#1001",
  total: "9007199254740993.01",
  currency: "USD",
  gatewayNames: [" Cash on Delivery (COD) "],
  financialStatus: "pending",
  createdAt: new Date("2026-09-22T06:00:00Z"),
};

before(async () => {
  temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), "cod-order-watch-tests-"),
  );
  // Run the real migration history against a fresh, disposable SQLite database.
  // The copied schema's relative database path cannot reach the local dev DB.
  cpSync(
    path.join(projectRoot, "prisma/schema.prisma"),
    path.join(temporaryDirectory, "schema.prisma"),
  );
  cpSync(
    path.join(projectRoot, "prisma/migrations"),
    path.join(temporaryDirectory, "migrations"),
    { recursive: true },
  );
  execFileSync(
    process.execPath,
    [
      path.join(projectRoot, "node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
      "--schema",
      path.join(temporaryDirectory, "schema.prisma"),
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, RUST_LOG: "info" },
      stdio: "pipe",
    },
  );
  client = new PrismaClient({
    datasourceUrl: pathToFileURL(path.join(temporaryDirectory, "dev.sqlite"))
      .href,
  });
  await client.$connect();
});

beforeEach(async () => {
  await client.webhookReceipt.deleteMany();
  await client.order.deleteMany();
  await client.session.deleteMany();
  await client.session.createMany({
    data: [shopA, shopB].map((shop) => ({
      id: `offline_${shop}`,
      shop,
      state: "test-state",
      isOnline: false,
      accessToken: "test-token-not-a-real-credential",
      scope: "read_orders",
      expires: new Date("2020-01-01T00:00:00Z"),
    })),
  });
});

after(async () => {
  if (client) await client.$disconnect();
  if (temporaryDirectory)
    rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("persists exact values and derives COD without altering the template session", async () => {
  assert.equal(
    await saveReceivedOrder(shopA, "delivery-1", order, client),
    "created",
  );
  const [saved] = await getOrdersForShop(shopA, client);
  assert.equal(saved.shop, shopA);
  assert.equal(saved.orderId, order.orderId);
  assert.equal(saved.name, order.name);
  assert.equal(saved.total, "9007199254740993.01");
  assert.equal(saved.currency, "USD");
  assert.deepEqual(saved.gatewayNames, order.gatewayNames);
  assert.deepEqual(saved.createdAt, order.createdAt);
  assert.equal(saved.isCod, true);
  assert.equal(
    await client.webhookReceipt.count({ where: { shop: shopA } }),
    1,
  );
  const session = await client.session.findUniqueOrThrow({
    where: { id: `offline_${shopA}` },
  });
  assert.equal(session.accessToken, "test-token-not-a-real-credential");
  assert.equal(session.scope, "read_orders");
});

test("same delivery and new deliveries of the same order never double count or overwrite", async () => {
  await saveReceivedOrder(shopA, "delivery-1", order, client);
  assert.equal(
    await saveReceivedOrder(shopA, "delivery-1", order, client),
    "duplicate_delivery",
  );
  assert.equal(
    await client.webhookReceipt.count({ where: { shop: shopA } }),
    1,
  );
  assert.equal(
    await saveReceivedOrder(
      shopA,
      "delivery-2",
      {
        ...order,
        total: "999",
        gatewayNames: ["shopify_payments"],
        financialStatus: "paid",
      },
      client,
    ),
    "duplicate_order",
  );
  assert.equal(
    await client.webhookReceipt.count({ where: { shop: shopA } }),
    2,
  );
  const saved = await getOrdersForShop(shopA, client);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].total, order.total);
  assert.equal(saved[0].isCod, true);
});

test("identical delivery/order IDs in different shops remain independent", async () => {
  await saveReceivedOrder(shopA, "shared-delivery", order, client);
  await saveReceivedOrder(
    shopB,
    "shared-delivery",
    {
      ...order,
      name: "#2001",
      total: "0.20",
      gatewayNames: ["manual"],
      financialStatus: "paid",
    },
    client,
  );
  const ordersA = await getOrdersForShop(shopA, client);
  const ordersB = await getOrdersForShop(shopB, client);
  assert.equal(ordersA.length, 1);
  assert.equal(ordersB.length, 1);
  assert.equal(ordersA[0].name, "#1001");
  assert.equal(ordersB[0].name, "#2001");
  assert.equal(ordersB[0].isCod, false);
  assert.deepEqual(sumAmountsByCurrency(ordersA), [
    { currency: "USD", total: order.total },
  ]);
  assert.deepEqual(sumAmountsByCurrency(ordersB), [
    { currency: "USD", total: "0.2" },
  ]);
});

test("database constraints enforce both composite keys", async () => {
  await saveReceivedOrder(shopA, "delivery-1", order, client);
  const saved = (await getOrdersForShop(shopA, client))[0];
  const uniqueViolation = (error: unknown) =>
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002";
  await assert.rejects(
    client.order.create({ data: { ...saved, gatewayNames: [] } }),
    uniqueViolation,
  );
  await assert.rejects(
    client.webhookReceipt.create({
      data: { shop: shopA, webhookId: "delivery-1" },
    }),
    uniqueViolation,
  );
});

test("unknown shops and shops with only an online session create neither orders nor receipts", async () => {
  const unknown = "unknown-test.myshopify.com";
  assert.equal(
    await saveReceivedOrder(unknown, "delivery-1", order, client),
    "uninstalled",
  );
  await client.session.update({
    where: { id: `offline_${shopA}` },
    data: { isOnline: true },
  });
  assert.equal(
    await saveReceivedOrder(shopA, "delivery-2", order, client),
    "uninstalled",
  );
  assert.equal(await client.order.count(), 0);
  assert.equal(await client.webhookReceipt.count(), 0);
  assert.equal(await client.session.count({ where: { shop: unknown } }), 0);
});

test("an order write failure rolls back the receipt so the same delivery remains retryable", async () => {
  await client.$executeRawUnsafe(`CREATE TRIGGER fail_order_write BEFORE INSERT ON "Order"
    BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END`);
  try {
    await assert.rejects(
      saveReceivedOrder(shopA, "retry-delivery", order, client),
    );
    assert.equal(await client.order.count(), 0);
    assert.equal(await client.webhookReceipt.count(), 0);
  } finally {
    await client.$executeRawUnsafe("DROP TRIGGER fail_order_write");
  }
  assert.equal(
    await saveReceivedOrder(shopA, "retry-delivery", order, client),
    "created",
  );
  assert.equal(await client.order.count(), 1);
  assert.equal(await client.webhookReceipt.count(), 1);
});

test("missing shop, invalid IDs, dates, money, currencies, and gateways fail without writes", async () => {
  await assert.rejects(
    saveReceivedOrder("", "delivery", order, client),
    TypeError,
  );
  await assert.rejects(getOrdersForShop(" ", client), TypeError);
  await assert.rejects(saveReceivedOrder(shopA, "", order, client), TypeError);
  const invalidOrders: ReceivedOrder[] = [
    { ...order, orderId: "123\n" },
    { ...order, orderId: 9007199254740992 as unknown as string },
    { ...order, name: "" },
    { ...order, createdAt: new Date("invalid") },
    { ...order, total: "NaN" },
    { ...order, currency: "usd" },
    { ...order, gatewayNames: [123] as unknown as string[] },
  ];
  for (const invalid of invalidOrders) {
    await assert.rejects(
      saveReceivedOrder(shopA, "invalid-delivery", invalid, client),
    );
  }
  assert.equal(await client.order.count(), 0);
  assert.equal(await client.webhookReceipt.count(), 0);
});

test("missing gateways persist as an empty array and are not COD", async () => {
  await saveReceivedOrder(
    shopA,
    "delivery-empty",
    { ...order, gatewayNames: undefined },
    client,
  );
  const [saved] = await getOrdersForShop(shopA, client);
  assert.deepEqual(saved.gatewayNames, []);
  assert.equal(saved.isCod, false);
});
