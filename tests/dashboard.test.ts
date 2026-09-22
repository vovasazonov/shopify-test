import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, mock, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LoaderFunctionArgs } from "react-router";
import { OrderDashboard } from "../app/components/order-dashboard";
import {
  formatCodShare,
  formatOrderDate,
  formatOrderMoney,
} from "../app/lib/order-display";

const root = fileURLToPath(new URL("..", import.meta.url));
const shopA = "dashboard-alpha.myshopify.com";
const shopB = "dashboard-beta.myshopify.com";
let directory: string;
let client: PrismaClient;
let loader: typeof import("../app/routes/app._index").loader;
let authenticate: typeof import("../app/shopify.server").authenticate;
let saveReceivedOrder: typeof import("../app/services/orders.server").saveReceivedOrder;

before(async () => {
  directory = mkdtempSync(path.join(tmpdir(), "cod-dashboard-tests-"));
  cpSync(
    path.join(root, "prisma/schema.prisma"),
    path.join(directory, "schema.prisma"),
  );
  cpSync(
    path.join(root, "prisma/migrations"),
    path.join(directory, "migrations"),
    { recursive: true },
  );
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
      "--schema",
      path.join(directory, "schema.prisma"),
    ],
    {
      env: { ...process.env, RUST_LOG: "info" },
      stdio: "pipe",
    },
  );
  client = new PrismaClient({
    datasourceUrl: pathToFileURL(path.join(directory, "dev.sqlite")).href,
  });
  await client.$connect();
  process.env.NODE_ENV = "test";
  process.env.SHOPIFY_API_KEY = "dashboard-test-api-key";
  process.env.SHOPIFY_API_SECRET = "dashboard-test-secret-not-real";
  process.env.SHOPIFY_APP_URL = "https://dashboard.example.test";
  // Test files run in isolated processes. All route imports use the disposable DB.
  global.prismaGlobal = client;
  ({ loader } = await import("../app/routes/app._index"));
  ({ authenticate } = await import("../app/shopify.server"));
  ({ saveReceivedOrder } = await import("../app/services/orders.server"));
});

beforeEach(async () => {
  await client.webhookReceipt.deleteMany();
  await client.order.deleteMany();
  await client.session.deleteMany();
  await client.session.createMany({
    data: [shopA, shopB].map((shop) => ({
      id: `offline_${shop}`,
      shop,
      state: "test",
      isOnline: false,
      accessToken: "fake-test-token",
    })),
  });
  // Only the authentication boundary is stubbed; loader and storage are real.
  mock.method(authenticate, "admin", async () => ({
    session: { shop: shopA },
  }));
});
afterEach(() => mock.restoreAll());
after(async () => {
  if (client) await client.$disconnect();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

function args(shop = shopB): LoaderFunctionArgs {
  const url = new URL(`https://dashboard.example.test/app?shop=${shop}`);
  return {
    request: new Request(url),
    url,
    pattern: "/app",
    params: {},
    context: {},
  };
}

function order(orderId: string, total = "0.10", currency = "USD") {
  return {
    orderId,
    name: `#${orderId}`,
    total,
    currency,
    createdAt: new Date("2026-09-22T06:00:00Z"),
    gatewayNames: ["manual"],
    financialStatus: "pending",
  };
}

function markup(
  dashboard: Awaited<ReturnType<typeof loader>>["data"]["dashboard"],
) {
  return renderToStaticMarkup(
    createElement(OrderDashboard, {
      dashboard,
      refreshing: false,
      onRefresh() {},
    }),
  );
}

test("an empty shop shows zero metrics and an actionable empty state", async () => {
  const {
    data: { dashboard },
  } = await loader(args());
  assert.deepEqual(dashboard, {
    totalOrders: 0,
    codOrders: 0,
    codShare: 0,
    totals: [],
    latestOrders: [],
  });
  const html = markup(dashboard);
  assert.match(html, /No orders received yet/);
  assert.match(html, /0%/);
  assert.match(html, /Create an order/);
  assert.doesNotMatch(html, /<s-table>/);
});

test("metrics cover all orders while only the latest 20 are sent, scoped to the authenticated shop", async () => {
  // 25 same-date orders exercise ID tie-breaking; the first 5 fall outside the table.
  for (let index = 0; index < 25; index++) {
    await saveReceivedOrder(
      shopA,
      `a-${index}`,
      {
        ...order(
          String(1000 + index),
          index < 5 ? "10.01" : "0.10",
          index < 5 ? "EUR" : "USD",
        ),
        financialStatus: index < 5 ? "pending" : "paid",
      },
      client,
    );
  }
  await saveReceivedOrder(shopB, "other-shop", order("9999", "999999"), client);
  const {
    data: { dashboard },
  } = await loader(args(shopB));
  assert.ok(dashboard);
  assert.equal(dashboard.totalOrders, 25);
  assert.equal(dashboard.codOrders, 5);
  assert.equal(dashboard.codShare, 20);
  assert.deepEqual(dashboard.totals, [
    { currency: "EUR", total: "50.05" },
    { currency: "USD", total: "2" },
  ]);
  assert.deepEqual(
    dashboard.latestOrders.map((row) => row.orderId),
    Array.from({ length: 20 }, (_, i) => String(1024 - i)),
  );
  const html = markup(dashboard);
  assert.equal((html.match(/<s-table-row>/g) ?? []).length, 20);
  assert.match(html, /Showing 20 of 25/);
  assert.match(html, /EUR 50.05/);
  assert.doesNotMatch(html, /999999|#9999/);
});

test("refresh sees a newly received order and creation date takes precedence over ID", async () => {
  await saveReceivedOrder(shopA, "older", order("9999"), client);
  assert.equal((await loader(args())).data.dashboard?.totalOrders, 1);
  await saveReceivedOrder(
    shopA,
    "newer",
    {
      ...order("1", "0.20"),
      createdAt: new Date("2026-09-22T07:00:00Z"),
      gatewayNames: [],
      financialStatus: "paid",
    },
    client,
  );
  const dashboard = (await loader(args())).data.dashboard;
  assert.ok(dashboard);
  assert.equal(dashboard.totalOrders, 2);
  assert.equal(dashboard.codOrders, 1);
  assert.equal(dashboard.codShare, 50);
  assert.deepEqual(dashboard.totals, [{ currency: "USD", total: "0.3" }]);
  assert.deepEqual(
    dashboard.latestOrders.map((row) => row.orderId),
    ["1", "9999"],
  );
  const html = markup(dashboard);
  assert.match(html, /Not provided/);
  assert.match(html, />Yes<\/s-badge>/);
  assert.match(html, />No<\/s-badge>/);
});

test("authentication responses propagate without reading orders", async () => {
  const rejected = new Response(null, {
    status: 302,
    headers: { Location: "/auth/login" },
  });
  mock.method(authenticate, "admin", async () => {
    throw rejected;
  });
  await client.$executeRawUnsafe(
    'ALTER TABLE "Order" RENAME TO "UnavailableOrder"',
  );
  try {
    await assert.rejects(
      loader(args()),
      (error: unknown) => error === rejected,
    );
  } finally {
    await client.$executeRawUnsafe(
      'ALTER TABLE "UnavailableOrder" RENAME TO "Order"',
    );
  }
});

test("storage errors produce a retryable readable state without leaking error details", async () => {
  const log = mock.method(console, "error", () => {});
  await client.$executeRawUnsafe(
    'ALTER TABLE "Order" RENAME TO "UnavailableOrder"',
  );
  let result;
  try {
    result = await loader(args());
  } finally {
    await client.$executeRawUnsafe(
      'ALTER TABLE "UnavailableOrder" RENAME TO "Order"',
    );
  }
  assert.equal(result.init?.status, 503);
  assert.equal(result.data.dashboard, null);
  const html = markup(result.data.dashboard);
  assert.match(
    html,
    /Orders couldn&#x27;t be loaded|Orders couldn't be loaded/,
  );
  assert.match(html, /Try refreshing again/);
  assert.doesNotMatch(html, /UnavailableOrder|Prisma|findMany/);
  assert.doesNotMatch(
    JSON.stringify(log.mock.calls),
    /UnavailableOrder|Prisma|findMany/,
  );
});

test("money display preserves large amounts and currency precision without floating-point conversion", () => {
  assert.equal(
    formatOrderMoney("9007199254740993.123456789", "USD"),
    "USD 9,007,199,254,740,993.123456789",
  );
  assert.equal(formatOrderMoney("0.3", "USD"), "USD 0.30");
  assert.equal(formatOrderMoney("1234", "JPY"), "JPY 1,234");
  assert.equal(formatOrderMoney("1.2", "KWD"), "KWD 1.200");
  assert.equal(formatCodShare(100 / 3), "33.3%");
  assert.equal(formatCodShare(0), "0%");
  assert.equal(
    formatOrderDate("2026-09-22T09:00:00+03:00"),
    "Sep 22, 2026, 6:00 AM",
  );
});
