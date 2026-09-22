import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const shopA = "alpha-webhook-test.myshopify.com";
const shopB = "beta-webhook-test.myshopify.com";
const secret = "webhook-integration-secret-not-a-real-credential";
const accessToken = "webhook-test-access-token-not-a-real-credential";
const refreshToken = "webhook-test-refresh-token-not-a-real-credential";
const customerMarker = "customer-data-must-not-appear-in-logs@example.test";
const orderPayload = {
  id: 550000001,
  name: "#1001",
  total_price: "123.4500",
  currency: "USD",
  payment_gateway_names: [" Cash on Delivery (COD) "],
  financial_status: "pending",
  created_at: "2026-09-22T06:00:00Z",
  customer: { email: customerMarker },
};
const body = JSON.stringify(orderPayload);
const originalFetch = global.fetch;
const originalConsole = {
  info: console.info,
  warn: console.warn,
  error: console.error,
};
const environmentKeys = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SCOPES",
  "NODE_ENV",
] as const;
const originalEnvironment = new Map(
  environmentKeys.map((key) => [key, process.env[key]]),
);
let temporaryDirectory: string;
let client: PrismaClient;
let action: typeof import("../app/routes/webhooks.orders.create").action;
let uninstallAction: typeof import("../app/routes/webhooks.app.uninstalled").action;
let deleteShopData: typeof import("../app/services/uninstall.server").deleteShopData;
let saveReceivedOrder: typeof import("../app/services/orders.server").saveReceivedOrder;
let secondClient: PrismaClient;
let resetSdkFetch: (() => void) | undefined;
let networkCalls = 0;
let logs: unknown[][] = [];

before(async () => {
  temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), "cod-order-watch-webhook-tests-"),
  );
  // The real migration history runs only against a fresh disposable database.
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
  secondClient = new PrismaClient({
    datasourceUrl: pathToFileURL(path.join(temporaryDirectory, "dev.sqlite"))
      .href,
  });
  await secondClient.$connect();

  process.env.SHOPIFY_API_KEY = "webhook-test-api-key";
  process.env.SHOPIFY_API_SECRET = secret;
  process.env.SHOPIFY_APP_URL = "https://webhook-test.example.test";
  process.env.SCOPES = "read_orders";
  process.env.NODE_ENV = "test";
  // Node runs test files in separate processes. Set the route's singleton before
  // importing it so both the real session adapter and service use this database.
  global.prismaGlobal = client;
  const blockNetwork: typeof fetch = async () => {
    networkCalls += 1;
    throw new Error("External requests are forbidden in webhook tests");
  };
  global.fetch = blockNetwork;
  ({ action } = await import("../app/routes/webhooks.orders.create"));
  ({ action: uninstallAction } =
    await import("../app/routes/webhooks.app.uninstalled"));
  ({ deleteShopData } = await import("../app/services/uninstall.server"));
  ({ saveReceivedOrder } = await import("../app/services/orders.server"));
  const runtime = await import("@shopify/shopify-api/runtime");
  runtime.setAbstractFetchFunc(blockNetwork);
  resetSdkFetch = () => runtime.setAbstractFetchFunc(originalFetch);
  for (const level of ["info", "warn", "error"] as const) {
    console[level] = (...values: unknown[]) => logs.push(values);
  }
});

beforeEach(async () => {
  logs = [];
  networkCalls = 0;
  await client.webhookReceipt.deleteMany();
  await client.order.deleteMany();
  await client.session.deleteMany();
  await client.session.createMany({
    data: [shopA, shopB].map((shop) => ({
      id: `offline_${shop}`,
      shop,
      state: "test-state",
      isOnline: false,
      accessToken,
      refreshToken,
      scope: "read_orders",
      expires: new Date("2020-01-01T00:00:00Z"),
      refreshTokenExpires: new Date("2099-01-01T00:00:00Z"),
    })),
  });
});

after(async () => {
  Object.assign(console, originalConsole);
  global.fetch = originalFetch;
  resetSdkFetch?.();
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (client) await client.$disconnect();
  if (secondClient) await secondClient.$disconnect();
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

function signedRequest(
  rawBody = body,
  headers: Record<string, string | null> = {},
): Request {
  // Each test signature is generated from that exact request body. This is an
  // integration fixture, not the independently precomputed B1 bonus fixture.
  const requestHeaders = new Headers({
    "Content-Type": "application/json",
    "X-Shopify-Hmac-Sha256": createHmac("sha256", secret)
      .update(rawBody)
      .digest("base64"),
    "X-Shopify-Shop-Domain": shopA,
    "X-Shopify-Topic": "orders/create",
    "X-Shopify-API-Version": "2025-10",
    "X-Shopify-Webhook-Id": "delivery-1",
  });
  for (const [name, value] of Object.entries(headers)) {
    if (value === null) requestHeaders.delete(name);
    else requestHeaders.set(name, value);
  }
  return new Request(
    "https://webhook-test.example.test/webhooks/orders/create",
    {
      method: "POST",
      headers: requestHeaders,
      body: rawBody,
    },
  );
}

function actionArgs(request: Request): ActionFunctionArgs {
  return {
    request,
    url: new URL(request.url),
    pattern: new URL(request.url).pathname,
    params: {},
    context: {},
  };
}

async function deliver(request: Request, handler = action): Promise<Response> {
  try {
    return await handler(actionArgs(request));
  } catch (error) {
    // React Router converts thrown Responses to HTTP responses at its boundary.
    if (error instanceof Response) return error;
    throw error;
  }
}

async function assertNoOrderData(): Promise<void> {
  assert.equal(await client.order.count(), 0);
  assert.equal(await client.webhookReceipt.count(), 0);
  assert.equal(await client.session.count(), 2);
}

function routeEntries() {
  return logs
    .filter(([message]) => message === "Order webhook")
    .map(([, entry]) => entry as Record<string, unknown>);
}

test("signed route delivery persists only required fields and replay never double counts", async () => {
  assert.equal((await deliver(signedRequest())).status, 200);
  const firstOrder = await client.order.findUniqueOrThrow({
    where: { shop_orderId: { shop: shopA, orderId: String(orderPayload.id) } },
  });
  assert.equal(firstOrder.name, orderPayload.name);
  assert.equal(firstOrder.total, "123.45");
  assert.equal(firstOrder.currency, "USD");
  assert.deepEqual(firstOrder.gatewayNames, orderPayload.payment_gateway_names);
  assert.equal(firstOrder.isCod, true);
  assert.equal(
    firstOrder.createdAt.toISOString(),
    new Date(orderPayload.created_at).toISOString(),
  );
  assert.equal(JSON.stringify(firstOrder).includes(customerMarker), false);

  assert.equal((await deliver(signedRequest())).status, 200);
  assert.equal(await client.webhookReceipt.count(), 1);
  assert.equal(
    (
      await deliver(
        signedRequest(body, { "X-Shopify-Webhook-Id": "delivery-2" }),
      )
    ).status,
    200,
  );
  assert.equal(await client.order.count(), 1);
  assert.equal(await client.webhookReceipt.count(), 2);
  assert.deepEqual(await client.order.findFirst(), firstOrder);
  assert.equal(await client.order.count({ where: { shop: shopB } }), 0);
  assert.deepEqual(
    routeEntries().map((entry) => entry.outcome),
    ["created", "duplicate_delivery", "duplicate_order"],
  );
  assert.equal(networkCalls, 0);
});

test("signature failures and missing delivery headers stay rejected without writes", async () => {
  const cases: Array<{
    headers: Record<string, string | null>;
    status: number;
  }> = [
    { headers: { "X-Shopify-Hmac-Sha256": "invalid-signature" }, status: 401 },
    { headers: { "X-Shopify-Hmac-Sha256": null }, status: 400 },
    { headers: { "X-Shopify-Webhook-Id": null }, status: 400 },
    { headers: { "X-Shopify-Topic": "orders/updated" }, status: 400 },
  ];
  for (const { headers, status } of cases) {
    assert.equal((await deliver(signedRequest(body, headers))).status, status);
    await assertNoOrderData();
  }
  // A failed authentication remains a thrown SDK response, never success.
  await assert.rejects(
    action(actionArgs(signedRequest(body, { "X-Shopify-Hmac-Sha256": "bad" }))),
    (error: unknown) => error instanceof Response && error.status === 401,
  );
  assert.equal(networkCalls, 0);
});

test("signed malformed JSON and invalid field shapes return 400 without writes", async () => {
  const malformedBodies = [
    `{"customer":"${customerMarker}"`,
    JSON.stringify({ ...orderPayload, total_price: 123.45 }),
    JSON.stringify({
      ...orderPayload,
      payment_gateway_names: [customerMarker, 7],
    }),
    JSON.stringify([orderPayload]),
    "null",
  ];
  for (const rawBody of malformedBodies) {
    assert.equal((await deliver(signedRequest(rawBody))).status, 400);
    await assertNoOrderData();
  }
  assert.equal(networkCalls, 0);
  const serializedLogs = JSON.stringify(logs);
  for (const sensitive of [customerMarker, secret, accessToken, refreshToken]) {
    assert.equal(serializedLogs.includes(sensitive), false);
  }
  assert.equal(routeEntries()[0].outcome, "invalid_json");
  assert.equal(routeEntries()[1].outcome, "invalid_payload");
});

test("verified unknown shops are acknowledged without creating an installation or order", async () => {
  const unknownShop = "unknown-webhook-test.myshopify.com";
  const response = await deliver(
    signedRequest(body, {
      "X-Shopify-Shop-Domain": unknownShop,
    }),
  );
  assert.equal(response.status, 200);
  await assertNoOrderData();
  assert.equal(await client.session.count({ where: { shop: unknownShop } }), 0);
  assert.equal(routeEntries()[0].outcome, "uninstalled");
  assert.equal(routeEntries()[0].shop, unknownShop);
  assert.equal(networkCalls, 0);
});

test("storage failure returns 503 and rolls back the receipt before the same delivery succeeds", async () => {
  await client.$executeRawUnsafe(`CREATE TRIGGER fail_webhook_order_write BEFORE INSERT ON "Order"
    BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END`);
  try {
    assert.equal((await deliver(signedRequest())).status, 503);
    await assertNoOrderData();
    assert.equal(routeEntries()[0].outcome, "storage_failed");
  } finally {
    await client.$executeRawUnsafe("DROP TRIGGER fail_webhook_order_write");
  }
  assert.equal((await deliver(signedRequest())).status, 200);
  assert.equal(await client.order.count(), 1);
  assert.equal(await client.webhookReceipt.count(), 1);
  assert.equal(networkCalls, 0);
});

test("expired offline tokens cause no external requests or refresh writes and logs omit secrets", async () => {
  const sessionBefore = await client.session.findUniqueOrThrow({
    where: { id: `offline_${shopA}` },
  });
  assert.equal((await deliver(signedRequest())).status, 200);
  assert.equal(networkCalls, 0);
  assert.deepEqual(
    await client.session.findUniqueOrThrow({
      where: { id: `offline_${shopA}` },
    }),
    sessionBefore,
  );
  const [entry] = routeEntries();
  assert.equal(entry.shop, shopA);
  assert.equal(entry.topic, "ORDERS_CREATE");
  assert.equal(entry.webhookId, "delivery-1");
  assert.equal(entry.verified, true);
  assert.equal(entry.outcome, "created");
  assert.equal(typeof entry.durationMs, "number");
  const serializedLogs = JSON.stringify(logs);
  for (const sensitive of [
    customerMarker,
    secret,
    accessToken,
    refreshToken,
    body,
  ]) {
    assert.equal(serializedLogs.includes(sensitive), false);
  }
});

test("records local route acknowledgement latency for 20 committed deliveries", async (context) => {
  const durations: number[] = [];
  for (let index = 0; index < 20; index += 1) {
    const request = signedRequest(
      JSON.stringify({ ...orderPayload, id: 560000000 + index }),
      { "X-Shopify-Webhook-Id": `latency-delivery-${index}` },
    );
    const startedAt = performance.now();
    const response = await deliver(request);
    durations.push(performance.now() - startedAt);
    assert.equal(response.status, 200);
  }
  assert.equal(await client.order.count(), 20);
  assert.equal(await client.webhookReceipt.count(), 20);
  assert.equal(networkCalls, 0);
  durations.sort((left, right) => left - right);
  context.diagnostic(
    `Local route action only, 20 writes (excludes tunnel/HTTP transport): ` +
      `min=${durations[0].toFixed(2)} ms, ` +
      `p95=${durations[Math.ceil(durations.length * 0.95) - 1].toFixed(2)} ms, ` +
      `max=${durations[durations.length - 1].toFixed(2)} ms`,
  );
});

function uninstallRequest(
  headers: Record<string, string | null> = {},
  rawBody = JSON.stringify({ id: 123, myshopify_domain: shopB }),
): Request {
  // A mismatched payload domain must never override the authenticated shop.
  return new Request(
    "https://webhook-test.example.test/webhooks/app/uninstalled",
    signedRequest(rawBody, {
      "X-Shopify-Topic": "app/uninstalled",
      "X-Shopify-Webhook-Id": "uninstall-1",
      ...headers,
    }),
  );
}

async function shopSnapshot(shop: string) {
  return {
    sessions: await client.session.findMany({
      where: { shop },
      orderBy: { id: "asc" },
    }),
    orders: await client.order.findMany({
      where: { shop },
      orderBy: { orderId: "asc" },
    }),
    receipts: await client.webhookReceipt.findMany({
      where: { shop },
      orderBy: { webhookId: "asc" },
    }),
  };
}

async function seedBothShops() {
  for (const shop of [shopA, shopB]) {
    assert.equal(
      (await deliver(signedRequest(body, { "X-Shopify-Shop-Domain": shop })))
        .status,
      200,
    );
    await client.session.create({
      data: {
        id: `online_${shop}`,
        shop,
        isOnline: true,
        state: "test",
        accessToken,
      },
    });
  }
}

const emptyShop = { sessions: [], orders: [], receipts: [] };

test("uninstall deletes all shop records atomically, preserves another shop, and tolerates repeats", async () => {
  await seedBothShops();
  const otherShopBefore = await shopSnapshot(shopB);
  assert.equal(
    (await deliver(uninstallRequest(), uninstallAction)).status,
    200,
  );
  assert.deepEqual(await shopSnapshot(shopA), emptyShop);
  assert.deepEqual(await shopSnapshot(shopB), otherShopBefore);
  for (const webhookId of ["uninstall-1", "uninstall-2"]) {
    assert.equal(
      (
        await deliver(
          uninstallRequest({ "X-Shopify-Webhook-Id": webhookId }),
          uninstallAction,
        )
      ).status,
      200,
    );
    assert.deepEqual(await shopSnapshot(shopA), emptyShop);
  }
  const [, entry] = logs.find(([message]) => message === "Uninstall webhook")!;
  assert.deepEqual(entry, {
    shop: shopA,
    topic: "APP_UNINSTALLED",
    webhookId: "uninstall-1",
    verified: true,
    outcome: "cleaned_up",
    status: 200,
    sessionsDeleted: 2,
    ordersDeleted: 1,
    receiptsDeleted: 1,
    durationMs: (entry as { durationMs: number }).durationMs,
  });
  assert.equal(networkCalls, 0);
});

test("uninstall verifies HMAC and removes leftover records when no session remains", async () => {
  await seedBothShops();
  await client.session.deleteMany({ where: { shop: shopA } });
  const leftoverData = await shopSnapshot(shopA);
  const otherShopBefore = await shopSnapshot(shopB);
  assert.equal(
    (
      await deliver(
        uninstallRequest({ "X-Shopify-Hmac-Sha256": "bad" }),
        uninstallAction,
      )
    ).status,
    401,
  );
  assert.deepEqual(await shopSnapshot(shopA), leftoverData);
  assert.equal(
    (await deliver(uninstallRequest(), uninstallAction)).status,
    200,
  );
  assert.deepEqual(await shopSnapshot(shopA), emptyShop);
  assert.deepEqual(await shopSnapshot(shopB), otherShopBefore);
  assert.equal(networkCalls, 0);
});

test("invalid uninstall signatures, headers, JSON, and topics never delete data", async () => {
  await seedBothShops();
  const before = await Promise.all([shopSnapshot(shopA), shopSnapshot(shopB)]);
  const requests: Array<[Request, number]> = [
    [uninstallRequest({ "X-Shopify-Hmac-Sha256": "bad" }), 401],
    [uninstallRequest({ "X-Shopify-Hmac-Sha256": null }), 400],
    [uninstallRequest({ "X-Shopify-Webhook-Id": null }), 400],
    [uninstallRequest({ "X-Shopify-Topic": "orders/create" }), 400],
    [uninstallRequest({}, `{"private":"${customerMarker}"`), 400],
  ];
  for (const [request, status] of requests) {
    assert.equal((await deliver(request, uninstallAction)).status, status);
    assert.deepEqual(
      await Promise.all([shopSnapshot(shopA), shopSnapshot(shopB)]),
      before,
    );
  }
  await assert.rejects(
    uninstallAction(
      actionArgs(uninstallRequest({ "X-Shopify-Hmac-Sha256": "bad" })),
    ),
    (error: unknown) => error instanceof Response && error.status === 401,
  );
  for (const sensitive of [customerMarker, secret, accessToken, refreshToken]) {
    assert.equal(JSON.stringify(logs).includes(sensitive), false);
  }
  assert.equal(networkCalls, 0);
});

test("a failed final cleanup delete rolls back sessions and orders so the uninstall can retry", async () => {
  await seedBothShops();
  const before = await Promise.all([shopSnapshot(shopA), shopSnapshot(shopB)]);
  await client.$executeRawUnsafe(`CREATE TRIGGER fail_cleanup BEFORE DELETE ON "WebhookReceipt"
    BEGIN SELECT RAISE(ABORT, 'simulated cleanup failure'); END`);
  try {
    assert.equal(
      (await deliver(uninstallRequest(), uninstallAction)).status,
      503,
    );
    assert.deepEqual(
      await Promise.all([shopSnapshot(shopA), shopSnapshot(shopB)]),
      before,
    );
  } finally {
    await client.$executeRawUnsafe("DROP TRIGGER fail_cleanup");
  }
  assert.equal(
    (await deliver(uninstallRequest(), uninstallAction)).status,
    200,
  );
  assert.deepEqual(await shopSnapshot(shopA), emptyShop);
  assert.deepEqual(await shopSnapshot(shopB), before[1]);
});

test("late order deliveries cannot restore orders or receipts after uninstall", async () => {
  await seedBothShops();
  assert.equal(
    (await deliver(uninstallRequest(), uninstallAction)).status,
    200,
  );
  for (const webhookId of ["delivery-1", "late-delivery"]) {
    assert.equal(
      (
        await deliver(
          signedRequest(body, { "X-Shopify-Webhook-Id": webhookId }),
        )
      ).status,
      200,
    );
    assert.deepEqual(await shopSnapshot(shopA), emptyShop);
    assert.equal(routeEntries().at(-1)?.outcome, "uninstalled");
  }
  assert.equal(networkCalls, 0);
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const racingOrder = {
  orderId: "991",
  name: "#race",
  total: "5.00",
  currency: "USD",
  createdAt: new Date("2026-09-22T06:00:00Z"),
  gatewayNames: ["cash"],
};

// Gates pause inside actual transactions, after the installation read or the
// first uninstall deletion. A separate Prisma connection starts the competing
// operation before the first transaction is allowed to finish.
for (const first of ["order", "uninstall"] as const) {
  test(
    `concurrent ${first}-first transactions leave no uninstalled-shop data`,
    { timeout: 10000 },
    async () => {
      const paused = gate();
      const resume = gate();
      await saveReceivedOrder(shopB, "other-shop", racingOrder, client);
      const otherShopBefore = await shopSnapshot(shopB);
      const heldClient = client.$extends({
        query: {
          session: {
            async findFirst({ args, query }) {
              const result = await query(args);
              if (first === "order") {
                paused.resolve();
                await resume.promise;
              }
              return result;
            },
            async deleteMany({ args, query }) {
              const result = await query(args);
              if (first === "uninstall") {
                paused.resolve();
                await resume.promise;
              }
              return result;
            },
          },
        },
      });
      // The extension preserves these model/transaction APIs; Prisma omits event
      // methods from its extended static type, which the services never use.
      const held = heldClient as unknown as PrismaClient;
      const firstResult =
        first === "order"
          ? saveReceivedOrder(shopA, "racing-delivery", racingOrder, held)
          : deleteShopData(shopA, held);
      let results;
      try {
        await Promise.race([
          paused.promise,
          firstResult.then(() => {
            throw new Error("Transaction did not pause");
          }),
        ]);
        const secondResult =
          first === "order"
            ? deleteShopData(shopA, secondClient)
            : saveReceivedOrder(
                shopA,
                "racing-delivery",
                racingOrder,
                secondClient,
              );
        const completed = Promise.all([firstResult, secondResult]);
        await new Promise<void>((resolve) => setImmediate(resolve));
        resume.resolve();
        results = await completed;
      } finally {
        resume.resolve();
        await firstResult;
      }
      assert.equal(
        first === "order" ? results[0] : results[1],
        first === "order" ? "created" : "uninstalled",
      );
      assert.deepEqual(await shopSnapshot(shopA), emptyShop);
      assert.deepEqual(await shopSnapshot(shopB), otherShopBefore);
      assert.equal(
        await saveReceivedOrder(
          shopA,
          "retry-after-race",
          racingOrder,
          secondClient,
        ),
        "uninstalled",
      );
      assert.deepEqual(await shopSnapshot(shopA), emptyShop);
    },
  );
}

test("cleanup refuses empty shop keys", async () => {
  for (const shop of ["", " ", ` ${shopA}`])
    await assert.rejects(deleteShopData(shop, client), TypeError);
  assert.equal(await client.session.count(), 2);
});
