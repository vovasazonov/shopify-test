# COD Order Watch

A planned embedded Shopify app that watches incoming orders and shows merchants how many are Cash-On-Delivery (COD).

**Status: planning only.** The app has not been scaffolded or implemented, and no application checks have run. See [PLAN.md](PLAN.md) for the prioritized implementation checklist: complete A first, then B if time permits; C can be skipped.

## Task and expected behavior

The local task brief is `Shopify-Interview-Task.pdf`, currently excluded from Git by `.gitignore`. Its requirements are captured in the plan:

- Run locally on a Shopify development store as an embedded app.
- Verify and process `orders/create` webhooks without double counting deliveries.
- Store order ID, name, total/currency, payment gateways, creation time, and COD status per shop.
- Show order count, COD count, COD percentage, total order value, and the latest 20 orders in Polaris.
- Delete a shop's stored data on `app/uninstalled`.
- Deliver a Git repository link and a 15-minute live demo/walkthrough, followed by about 10 minutes of Q&A. Hosting deployment is not required.

The time target is **4.5 hours including setup**, with a **5.5-hour hard stop**.

## Planned stack

TypeScript, Shopify's React Router app template, Polaris, and Prisma with SQLite. Use the template's authentication and session handling.

The brief allows Node 20+, but the [current Shopify CLI requirements](https://shopify.dev/docs/api/shopify-cli) specify Node 22.12 or later. Select a version also supported by the generated template and record the tested version here during A1.

## How to run

There is no runnable app in this repository yet. The following is the **initial setup workflow**, not a tested clone-and-run procedure. A7 will replace it with commands verified against the implemented project.

1. Create or confirm a Shopify Partner account and development store.
2. Enable **Settings > Payments > Manual payment methods > Cash on Delivery** in the store.
3. Install the CLI and scaffold the React Router app:

   ```sh
   node --version
   npm install -g @shopify/cli@latest
   shopify app init
   ```

4. Select TypeScript. The CLI creates a new app directory; integrate those files into this repository while preserving `PLAN.md`, `README.MD`, the task PDF, and the existing Git history.
5. From the app directory containing the generated `package.json`, start development:

   ```sh
   shopify app dev
   ```

6. Follow the login/store prompts, open the preview, and install the app. Configure `read_orders`, any required protected customer data access, and the `orders/create` and `app/uninstalled` subscriptions. Confirm configuration changes are applied to the dev store.

This workflow follows [Shopify's scaffolding guide](https://shopify.dev/docs/apps/build/scaffold-app) and [webhook subscription guide](https://shopify.dev/docs/apps/build/webhooks/get-started?deliveryMethod=http).

Before the implementation is submitted, document dependency installation, database initialization/migrations, required environment variable names, and exact start/test commands. Never commit secret values or a local database. Preserve the template's ignore rules and ensure `.env` is ignored before the first implementation commit.

## Planned COD rule

Normalize `payment_gateway_names` by trimming and lowercasing each name. Classify an order as COD when either condition holds:

1. Any gateway name contains `cash`.
2. `financial_status` is `pending` and one normalized gateway name is exactly `manual`.

| Gateway names | Financial status | COD |
| --- | --- | --- |
| `Cash on Delivery (COD)` | paid or pending | Yes |
| `manual` | pending | Yes |
| `manual` | paid | No |
| `shopify_payments` | pending | No |
| No gateways | pending | No |

This follows the task's heuristic. It may classify another cash-named method as COD, and it does not mean payment has been collected. With only `orders/create`, classification reflects the creation event; later edits are outside the initial scope.

## Planned technical decisions

| Decision | Reason |
| --- | --- |
| Reuse the React Router template | Keep setup and authentication within the short time budget. |
| Use `authenticate.webhook(request)` on the untouched request | Verify the signed raw body before using its contents; inspect the installed helper to explain its constant-time comparison. |
| Persist delivery IDs and orders atomically | A crash or retry must not lose an order or count it twice. |
| Unique shop/order and shop/delivery keys | Protect both order identity and webhook idempotency. |
| Commit a short local transaction before HTTP 200 | Acknowledge only safely stored work; storage failures remain retryable. |
| Authenticate dashboard queries and scope every query by shop | Keep merchant data isolated. |
| Verify uninstall even if its session is gone | Cleanup must still remove orders, receipts, and sessions. |
| Use exact decimal amounts and totals per currency | Avoid rounding errors and meaningless mixed-currency totals. |

The dashboard will count all persisted orders received by the app, not historical orders from before installation. COD share is `COD count / order count * 100`, or `0%` when empty. The table will contain the latest 20 orders; metrics will cover all stored orders for that shop.

## Verification plan

No tests have run yet. A6 will add automated COD and duplicate-persistence coverage and verify a real order, shop isolation, invalid requests, storage retries, empty state, and uninstall behavior.

For manual delivery checks, create a real order in the dev store and use `shopify app webhook trigger` for signed synthetic events. For the duplicate demonstration, replay the same body **and the same `X-Shopify-Webhook-Id`**; invoking the CLI twice is insufficient unless the delivery ID is preserved. The exact replay procedure will be documented after implementation.

The selected optional bonus is a fixed-payload HMAC verification test (B1), only after all A work passes and time remains. No bonus has been completed.

## Actual time spent

Actual time has not yet been recorded. Fill this table with measured time as work proceeds; do not copy estimates from the plan or report unfinished work as completed.

| Activity | Actual minutes | Status |
| --- | --- | --- |
| Brief review and planning | Not recorded | Planning documents created |
| Shopify account, store, and scaffold | Not started | Pending |
| Data model and webhooks | Not started | Pending |
| Dashboard and uninstall | Not started | Pending |
| Tests and fixes | Not started | Pending |
| Final README and demo rehearsal | Not started | Pending |
| Optional bonus / additional tests | Not started | Pending |
| **Total actual time** | **Not recorded** | Update before submission |

## Scope choices and more time

The timed implementation will omit historical backfill, order-update synchronization, Shopify order tagging, extra bonus features, custom OAuth, production hosting, and elaborate dashboard controls. Refreshing the page is sufficient for the initial demo.

For 10,000 merchants, the proposed next steps are a durable webhook queue with workers, PostgreSQL, retry/dead-letter handling, reconciliation for missed events, monitoring, and query/aggregation improvements. Full compliance webhook handling belongs in the production/public-app work before launch; this take-home selects the HMAC test as its optional bonus.

These are planned tradeoffs, not a claim that the app is implemented or production-ready. Update this section with actual omissions and known limitations before handing over the repository.
