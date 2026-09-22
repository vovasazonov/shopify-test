import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

// Send once per invocation. Repeating the command preserves both the raw bytes
// and delivery ID, so the presenter can refresh the dashboard between requests.
const [appUrl, shop, payloadPath] = process.argv.slice(2);
const secret = process.env.SHOPIFY_API_SECRET;
if (!appUrl || !shop || !payloadPath || !secret) {
  console.error(
    "Usage: SHOPIFY_API_SECRET=<private environment value> node scripts/replay-order.mjs <app-url> <shop.myshopify.com> <payload.json>",
  );
  process.exit(1);
}

try {
  const endpoint = new URL("/webhooks/orders/create", appUrl);
  if (
    endpoint.username ||
    endpoint.password ||
    !(
      endpoint.protocol === "https:" ||
      (endpoint.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname))
    ) ||
    !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)
  ) {
    throw new Error(
      "Use an HTTPS app URL (or HTTP loopback) and a Shopify shop domain.",
    );
  }
  const body = await readFile(payloadPath);
  JSON.parse(body.toString("utf8"));
  const webhookId = `demo-${createHash("sha256").update(body).digest("hex")}`;
  const signature = createHmac("sha256", secret).update(body).digest("base64");
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Topic": "orders/create",
      "X-Shopify-Shop-Domain": shop,
      "X-Shopify-Webhook-Id": webhookId,
      "X-Shopify-API-Version": "2025-10",
      "X-Shopify-Hmac-Sha256": signature,
    },
    body,
  });
  console.log(`HTTP ${response.status}; delivery ${webhookId}`);
  console.log(
    "Refresh the dashboard and inspect the server outcome; HTTP 200 alone does not prove a write.",
  );
  if (response.status !== 200) process.exitCode = 1;
} catch {
  // Do not print credentials, raw payloads, or potentially sensitive URLs.
  console.error(
    "Replay failed. Check the URL, shop, JSON file, secret, and running development server.",
  );
  process.exitCode = 1;
}
