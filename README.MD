# COD Order Watch

An embedded Shopify app being built to watch incoming orders and show merchants how many are Cash-On-Delivery (COD).

**Status: A2 complete locally; A1 installation pending.** The starter comes from Shopify's official React Router template (source commit `e548c95`). Shop-scoped order storage, atomic delivery receipts, COD classification, and exact currency totals are implemented and tested. Shopify sign-in succeeded, but app creation and installation are blocked until the account is invited to a Partner organization with app-development and development-store access. The CLI's `app init` attempt stopped with `No Organization found`. The webhook HTTP handler and dashboard still need implementation. See [PLAN.md](PLAN.md) for the prioritized implementation checklist: complete A first, then B if time permits; C can be skipped.

## Task and expected behavior

The local task brief is `Shopify-Interview-Task.pdf`, currently excluded from Git by `.gitignore`. Its requirements are captured in the plan:

- Run locally on a Shopify development store as an embedded app.
- Verify and process `orders/create` webhooks without double counting deliveries.
- Store order ID, name, total/currency, payment gateways, creation time, and COD status per shop.
- Show order count, COD count, COD percentage, total order value, and the latest 20 orders in Polaris.
- Delete a shop's stored data on `app/uninstalled`.
- Deliver a Git repository link and a 15-minute live demo/walkthrough, followed by about 10 minutes of Q&A. Hosting deployment is not required.

The time target is **4.5 hours including setup**, with a **5.5-hour hard stop**.

## Stack

TypeScript, Shopify's React Router app template, Polaris, and Prisma with SQLite. Use the template's authentication and session handling.

The brief allows Node 20+, but the [current Shopify CLI requirements](https://shopify.dev/docs/api/shopify-cli) specify Node 22.12 or later. This project requires Node 22.12+; the local setup uses Node 26.5.0 and npm 11.17.0. Shopify CLI 4.8.0 is a project dependency.

## How to run

Local preparation uses the repository's package scripts:

```sh
npm ci
npm run setup
npm test
npm run typecheck
npm run lint
npm run build
```

The remaining Shopify workflow requires Partner organization access and has **not yet been verified**:

1. Accept the organization's invitation with permission to manage development apps and access a development store.
2. Create/link the **COD Order Watch** app using `npm run config:link`, preserving the local `read_orders` scope and webhook declarations. The committed configuration is currently unlinked.
3. Create or select a development store and enable **Settings > Payments > Manual payment methods > Cash on Delivery**.
4. Resolve any required protected customer data setup for order access. Customer names, addresses, email addresses, and phone numbers are not needed for this app.
5. Run `npm run dev -- --store <development-store>.myshopify.com`, follow the installation link, and open the embedded app.
6. Verify the installed app's granted scopes and applied webhook subscriptions.

Shopify CLI supplies `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, and `SCOPES` during development. Keep credentials, local SQLite databases, and `.shopify` state out of Git; the dependency lockfile is committed. No production deployment is required.

The initial page is a setup placeholder. The `orders/create` endpoint authenticates requests but returns HTTP 503 until A3 connects verified payload handling to the storage service; it must not acknowledge orders that it cannot save. Shopify retries are finite, so create demonstration orders only after A3. The template's session cleanup and scopes-update handlers are retained; complete uninstall cleanup remains A5.

This workflow follows [Shopify's scaffolding guide](https://shopify.dev/docs/apps/build/scaffold-app) and [webhook subscription guide](https://shopify.dev/docs/apps/build/webhooks/get-started?deliveryMethod=http).

## COD rule

Implemented in `app/lib/cod.ts`. Normalize `payment_gateway_names` by trimming and lowercasing each name. Classify an order as COD when either condition holds:

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

## Storage and exact amounts

`prisma/schema.prisma` preserves Shopify's Session model and adds Order and WebhookReceipt. Their compound primary keys are `(shop, orderId)` and `(shop, webhookId)`. Order IDs stay strings; gateway names are stored as a JSON array.

`app/services/orders.server.ts` exposes `saveReceivedOrder(shop, webhookId, order)` and `getOrdersForShop(shop)`. Both require a nonempty shop. Saving checks for an existing offline session, inserts the delivery receipt, and creates the order in one SQLite transaction. Unknown/uninstalled shops create no records. A repeated delivery returns `duplicate_delivery`; another delivery for the same order records its new receipt and returns `duplicate_order` without replacing the original order. Other storage failures propagate after rollback so A3 can return a retryable response. Expired offline access tokens do not by themselves mean an app was uninstalled.

Order totals use canonical decimal text in SQLite, avoiding its approximate floating-point storage. `app/lib/money.ts` uses Big.js for exact addition and returns one total per currency. It accepts nonnegative plain decimal strings, removes unnecessary leading/trailing zeros without rounding, and rejects JavaScript numbers, exponent notation, and invalid currency-code formats. Display formatting belongs to A4; stored precision is not restricted to two decimal places. See [SQLite floating-point behavior](https://www.sqlite.org/floatingpoint.html) and the [Big.js API](https://mikemcl.github.io/big.js/).

The webhook route has not yet been wired to this service. A5 must also replace the template uninstall handler with a transaction that deletes orders, receipts, and sessions together, so a concurrent delivery cannot restore uninstalled-shop data.

## Technical decisions and remaining integration

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

## Verification

Local checks on 2026-09-22 (rerun for A2 where applicable):

| Command | Result |
| --- | --- |
| `npm install --no-audit --no-fund` | Passed; dependencies and lockfile installed. |
| `RUST_LOG=info npm run setup` | Passed; generated Prisma Client and applied the order-storage migration to the development database. |
| `npm test` | Passed: 16 tests. Uses a fresh temporary SQLite database with both committed migrations and removes it afterward. Never resets the development database. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed. |
| `npm run build` | Passed for browser and server bundles. |
| `git diff --check` | Passed. |

The agent environment injects `RUST_LOG=warn`, which causes Prisma's schema engine to fail on a fresh SQLite database with an empty error. Fresh-database checks succeeded with `RUST_LOG` unset or set to `info`, matching [Prisma issue #29355](https://github.com/prisma/prisma/issues/29355). If this occurs, run `RUST_LOG=info npm run setup`. No database or schema workaround was needed.

Automated coverage includes COD rules, exact decimal/currency handling, shop isolation, database uniqueness, delivery/order replay, absent installations, invalid storage input, and an actual SQLite trigger failure proving transactional rollback and successful retry. A6 still needs HTTP/HMAC integration and real Shopify order verification, dashboard limits/empty state, uninstall, and the remaining end-to-end cases. No live Shopify checks or Docker deployment tests have run.

Dependency audit: npm currently reports 19 high-severity dependency entries rooted in unchanged starter tooling dependencies (`lodash`, `minimatch`, and `deepmerge-ts`). The A2 additions (`big.js`, `@types/big.js`, and `tsx`) were not flagged. Dependency remediation remains pending; no forced upgrades or incompatible Prisma downgrades were applied during A2. This audit does not establish whether an advisory is reachable through the app's request handlers.

For manual delivery checks, create a real order in the dev store and use `shopify app webhook trigger` for signed synthetic events. For the duplicate demonstration, replay the same body **and the same `X-Shopify-Webhook-Id`**; invoking the CLI twice is insufficient unless the delivery ID is preserved. The exact replay procedure will be documented after implementation.

The selected optional bonus is a fixed-payload HMAC verification test (B1), only after all A work passes and time remains. No bonus has been completed.

## Actual time spent

Elapsed time is measured for the current work session, including account setup and debugging. Earlier planning time remains unrecorded; the subtotal is not the full project total.

| Activity | Actual minutes | Status |
| --- | --- | --- |
| Brief review and planning | Not recorded | Planning documents created |
| Shopify account, store, and scaffold | 10 | Local preparation and checks; Partner invitation and store setup pending |
| Data model and local tests | 9 | A2 complete locally; webhook integration remains A3 |
| Dashboard and uninstall | Not started | Pending |
| Tests and fixes | Not started | Pending |
| Final README and demo rehearsal | Not started | Pending |
| Optional bonus / additional tests | Not started | Pending |
| **Recorded subtotal** | **19** | Earlier planning time still needs to be added |

## Scope choices and more time

The timed implementation will omit historical backfill, order-update synchronization, Shopify order tagging, extra bonus features, custom OAuth, production hosting, and elaborate dashboard controls. Refreshing the page is sufficient for the initial demo.

For 10,000 merchants, the proposed next steps are a durable webhook queue with workers, PostgreSQL, retry/dead-letter handling, reconciliation for missed events, monitoring, and query/aggregation improvements. Full compliance webhook handling belongs in the production/public-app work before launch; this take-home selects the HMAC test as its optional bonus.

These are planned tradeoffs, not a claim that the app is implemented or production-ready. Update this section with actual omissions and known limitations before handing over the repository.
