# COD Order Watch

An embedded Shopify app for tracking incoming orders and identifying Cash-On-Delivery (COD) orders.

## How to run

Requires Node.js 22.12+, a Shopify Partner account, and a development store with **Cash on Delivery** enabled under **Settings > Payments > Manual payment methods**.

```sh
npm ci
RUST_LOG=info npm run setup
npm run dev -- --store cod-order-watch-dev.myshopify.com
```

Open the preview URL printed by the CLI to install or open the embedded app. Keep the development server running during the demo; no deployment is required.

For your own Shopify app/store, run `npm run config:link` first and substitute your store domain. After linking, preserve `read_orders` and the webhook subscriptions in `shopify.app.toml`. Configure development access to order data if Shopify requests it; this app does not require customer names, email addresses, phone numbers, or addresses.

The CLI supplies `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, and `SCOPES`. Keep credentials and local databases out of Git.

Run the automated checks with:

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

## COD rule

Trim and lowercase each payment gateway name. An order is COD if any gateway contains `cash`, or if `financial_status` is exactly `pending` and a gateway is exactly `manual`.

- `Cash on Delivery (COD)`: COD, regardless of payment status.
- `manual` with `pending`: COD.
- `manual` with `paid`, or no gateways: not COD.

Classification reflects the order creation event and does not mean payment has been collected.

## Key decisions

- Use the Shopify React Router template with TypeScript and Prisma/SQLite to keep setup small and reuse Shopify authentication.
- Verify the untouched request with `authenticate.webhook(request)` before using its payload. The SDK computes raw-body HMAC-SHA256 and compares equal-length signatures with a full-byte XOR loop. Disable token refresh only for webhook authentication to avoid external API calls before acknowledgement.
- Scope records by shop and require an existing offline session. Never create an installation from an order webhook.
- Commit the delivery receipt and order together. Database uniqueness on `(shop, webhookId)` and `(shop, orderId)` prevents double counting. Return 200 after commit or for duplicates/unknown shops; storage failures return 503 so the delivery can retry.
- Keep IDs as strings and monetary amounts as exact decimal text, using Big.js for arithmetic. Keep totals separate by currency. Reject unsafe numeric IDs instead of silently rounding them.
- Persist only the required order fields and COD result. Log delivery identifiers and outcomes without customer payloads or secrets.
- Derive the dashboard's shop from the authenticated session. Metrics cover all received orders; the table shows the latest 20 with UTC dates. Use Refresh to load new orders, and label totals as received order value rather than collected COD revenue.
- Authenticate uninstall deliveries even without a session, then delete the shop's orders, receipts, and all sessions in one transaction. Repeats are harmless; order transactions recheck installation so late deliveries cannot restore deleted data.

## Actual time spent

Times are local to **Asia/Jerusalem**. Elapsed time includes Shopify setup.

| Started | Finished | Total elapsed time |
| --- | --- | --- |
| 2026-09-22 08:30 | | |

## What I would do with more time

For 10,000 merchants, move to PostgreSQL and a durable webhook queue with workers, retries, dead-letter handling, and monitoring. Add reconciliation for missed orders, order-update synchronization, and complete privacy/compliance workflows before a production launch.

## What I consciously left out

Historical order backfill, Shopify order tagging, `orders/updated`, compliance webhooks, custom OAuth, production hosting, and advanced dashboard controls are outside the current implementation. The optional fixed-signature HMAC bonus test has not been completed.

Required work still in progress: live Shopify end-to-end verification, including uninstall/reinstall.
