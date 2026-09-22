import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import type { ActionFunctionArgs } from "react-router";
import { createTestDatabase } from "./helpers/database";

const shop = "scopes-test.myshopify.com";
const otherShop = "other-scopes-test.myshopify.com";
const secret = "scope-webhook-test-secret-not-a-real-credential";
const privateMarker = "private-payload-value@example.invalid";
const environment = {
  SHOPIFY_API_KEY: "scope-webhook-test-api-key",
  SHOPIFY_API_SECRET: secret,
  SHOPIFY_APP_URL: "https://scopes.example.test",
  SCOPES: "read_orders",
  NODE_ENV: "test",
};
const originalEnvironment = new Map(
  Object.keys(environment).map((key) => [key, process.env[key]]),
);
const originalConsole = {
  info: console.info,
  warn: console.warn,
  error: console.error,
};
const originalFetch = global.fetch;
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let action: typeof import("../app/routes/webhooks.app.scopes_update").action;
let resetSdkFetch: (() => void) | undefined;
let networkCalls = 0;
let logs: unknown[][] = [];

before(async () => {
  database = await createTestDatabase();
  global.prismaGlobal = database.client;
  Object.assign(process.env, environment);
  const blockNetwork: typeof fetch = async () => {
    networkCalls += 1;
    throw new Error("Scope webhooks must not make external requests");
  };
  global.fetch = blockNetwork;
  ({ action } = await import("../app/routes/webhooks.app.scopes_update"));
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
  await database.client.session.deleteMany();
  await database.client.session.createMany({
    data: [shop, otherShop].map((domain) => ({
      id: `offline_${domain}`,
      shop: domain,
      state: "test-state",
      isOnline: false,
      accessToken: "scope-test-access-token",
      refreshToken: "scope-test-refresh-token",
      scope: "read_orders",
      expires: new Date("2020-01-01T00:00:00Z"),
      refreshTokenExpires: new Date("2099-01-01T00:00:00Z"),
    })),
  });
});

afterEach(() => {
  assert.equal(networkCalls, 0);
  for (const sensitive of [
    secret,
    privateMarker,
    "scope-test-access-token",
    "scope-test-refresh-token",
  ]) {
    assert.equal(JSON.stringify(logs).includes(sensitive), false);
  }
});

after(async () => {
  Object.assign(console, originalConsole);
  global.fetch = originalFetch;
  resetSdkFetch?.();
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await database?.dispose();
});

function signedRequest(
  rawBody = JSON.stringify({ current: ["read_orders", "read_products"] }),
  overrides: Record<string, string | null> = {},
): Request {
  const headers = new Headers({
    "Content-Type": "application/json",
    "X-Shopify-Hmac-Sha256": createHmac("sha256", secret)
      .update(rawBody)
      .digest("base64"),
    "X-Shopify-Shop-Domain": shop,
    "X-Shopify-Topic": "app/scopes_update",
    "X-Shopify-API-Version": "2025-10",
    "X-Shopify-Webhook-Id": "scope-delivery-1",
  });
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  return new Request("https://scopes.example.test/webhooks/app/scopes_update", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

function actionArgs(request: Request): ActionFunctionArgs {
  return {
    request,
    params: {},
    context: {},
    url: new URL(request.url),
    pattern: new URL(request.url).pathname,
  };
}

async function deliver(request: Request): Promise<Response> {
  try {
    return await action(actionArgs(request));
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

test("scope changes affect only the authenticated offline session and allow repeats or empty grants", async () => {
  await database.client.session.create({
    data: {
      id: "online-session",
      shop,
      isOnline: true,
      state: "test",
      accessToken: "test",
      scope: "read_orders",
    },
  });
  const otherBefore = await database.client.session.findMany({
    where: { id: { not: `offline_${shop}` } },
  });
  for (let delivery = 0; delivery < 2; delivery += 1) {
    assert.equal((await deliver(signedRequest())).status, 200);
    assert.equal(
      (
        await database.client.session.findUniqueOrThrow({
          where: { id: `offline_${shop}` },
        })
      ).scope,
      "read_orders,read_products",
    );
  }
  assert.equal(
    (await deliver(signedRequest(JSON.stringify({ current: [] })))).status,
    200,
  );
  assert.equal(
    (
      await database.client.session.findUniqueOrThrow({
        where: { id: `offline_${shop}` },
      })
    ).scope,
    "",
  );
  assert.deepEqual(
    await database.client.session.findMany({
      where: { id: { not: `offline_${shop}` } },
    }),
    otherBefore,
  );
});

test("invalid scope signatures, topics, headers and payloads cannot alter sessions", async () => {
  const before = await database.client.session.findMany();
  const requests: Array<[Request, number]> = [
    [signedRequest(undefined, { "X-Shopify-Hmac-Sha256": "invalid" }), 401],
    [signedRequest(undefined, { "X-Shopify-Hmac-Sha256": null }), 400],
    [signedRequest(undefined, { "X-Shopify-Webhook-Id": null }), 400],
    [signedRequest(undefined, { "X-Shopify-Topic": "orders/create" }), 400],
    [signedRequest(`{"private":"${privateMarker}"`), 400],
    ...[
      null,
      {},
      [],
      { current: null },
      { current: "read_orders" },
      { current: [privateMarker, 7] },
      { current: [""] },
      { current: ["read_orders,write_orders"] },
    ].map((payload): [Request, number] => [
      signedRequest(JSON.stringify(payload)),
      400,
    ]),
  ];
  for (const [request, status] of requests) {
    assert.equal((await deliver(request)).status, status);
    assert.deepEqual(await database.client.session.findMany(), before);
  }
  await assert.rejects(
    action(
      actionArgs(
        signedRequest(undefined, { "X-Shopify-Hmac-Sha256": "invalid" }),
      ),
    ),
    (error: unknown) => error instanceof Response && error.status === 401,
  );
});

test("scope deliveries for uninstalled shops are acknowledged without creating sessions", async () => {
  await database.client.session.deleteMany({ where: { shop } });
  const before = await database.client.session.findMany();
  assert.equal((await deliver(signedRequest())).status, 200);
  assert.deepEqual(await database.client.session.findMany(), before);
  const [, entry] = logs.find(([label]) => label === "Scopes webhook")!;
  assert.equal((entry as { outcome: string }).outcome, "uninstalled");
});

test("failed scope storage returns 503 and leaves the delivery retryable", async () => {
  const before = await database.client.session.findMany();
  await database.client
    .$executeRawUnsafe(`CREATE TRIGGER fail_scope_update BEFORE UPDATE ON "Session"
    BEGIN SELECT RAISE(ABORT, 'private-payload-value@example.invalid'); END`);
  try {
    assert.equal((await deliver(signedRequest())).status, 503);
    assert.deepEqual(await database.client.session.findMany(), before);
  } finally {
    await database.client.$executeRawUnsafe("DROP TRIGGER fail_scope_update");
  }
  assert.equal((await deliver(signedRequest())).status, 200);
  assert.equal(
    (
      await database.client.session.findUniqueOrThrow({
        where: { id: `offline_${shop}` },
      })
    ).scope,
    "read_orders,read_products",
  );
});
