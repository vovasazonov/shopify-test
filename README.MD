# COD Order Watch

An embedded Shopify app being built to watch incoming orders and show merchants how many are Cash-On-Delivery (COD).

**Status: A1 setup verified; A2 and A3 complete locally.** The starter comes from Shopify's official React Router template (source commit `e548c95`). Shop-scoped order storage, atomic delivery receipts, COD classification, exact currency totals, and the authenticated order webhook handler are implemented and tested. **COD Order Watch** opens inside the free `cod-order-watch-dev.myshopify.com` dev store in the `test-assignment` organization. Cash on Delivery is active, development data access is configured, and the installed app has only `read_orders`. The dashboard is next (A4); complete uninstall cleanup and live order verification remain A5/A6. See [PLAN.md](PLAN.md) for the prioritized implementation checklist: complete A first, then B if time permits; C can be skipped.

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

Shopify setup is verified with Vladimir's own Partner organization. To start this linked app again:

```sh
RUST_LOG=info npm run dev -- --store cod-order-watch-dev.myshopify.com
```

Open the preview URL printed by the CLI (or press `p` in an interactive terminal). The installed app is available at [COD Order Watch in Shopify admin](https://admin.shopify.com/store/cod-order-watch-dev/apps/cod-order-watch/app) while the development server and tunnel are running. The server was left running after A1 verification. The current page is a setup placeholder; the full order workflow is not implemented yet.

Setup record and steps for another environment:

1. **Done:** Vladimir created the `test-assignment` Partner organization (organization ID `236923583`) using the same Shopify account as the CLI.
2. **Done:** created `cod-order-watch-dev.myshopify.com` as a free Basic **Dev** store, without demo data. For another environment, use `npm run shopify -- store create dev` or **Dev Dashboard > Stores > Create store > Dev**.
3. **Done:** created/linked **COD Order Watch** using `npm run config:link`. The linked `shopify.app.toml` preserves `read_orders`, webhook API version `2025-10`, and all three webhook declarations. Its client ID is public configuration, not a secret. Reuse this starter and A2 implementation; do not run `shopify app init` again. Linking another app can overwrite configuration, so review the diff afterward.
4. **Done:** activated **Cash on Delivery (COD)** under **Settings > Payments > Manual payment methods**.
5. **Done:** saved **Analytics** as the development data-use reason in **Partner Dashboard > Apps > COD Order Watch > API access requests > Protected customer data access**, with Vladimir's explicit approval. Customer names, addresses, email addresses, and phone numbers remain unselected. The current UI allowed this without a distribution choice or App Store review submission.
6. **Done:** started the development server, opened its preview URL, and verified the authenticated embedded setup page. The initial protected-data rejection was resolved by step 5.
7. **Done:** a read-only Admin API query of `currentAppInstallation.accessScopes` returned only `read_orders`; the persisted offline session agrees. The development bundle accepted by Shopify includes all three declared webhook topics with API version `2025-10` and URLs for the active tunnel. Processing is verified locally in A3; real Shopify delivery remains A6.

Node 26.5.0, Git 2.50.1, and Shopify CLI 4.8.0 were rechecked locally for this setup. The installed project CLI supports `store create dev`; no global CLI installation is needed to use the commands above.

Shopify CLI supplies `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, and `SCOPES` during development. Keep credentials, local SQLite databases, and `.shopify` state out of Git; the dependency lockfile is committed. No production deployment is required.

The initial page is a setup placeholder. The `orders/create` endpoint now authenticates, validates, and stores orders before returning HTTP 200; storage failures return a retryable HTTP 503. The template's session cleanup and scopes-update handlers are retained; complete uninstall cleanup remains A5.

This workflow follows [Shopify's scaffolding guide](https://shopify.dev/docs/apps/build/scaffold-app), [dev-store creation guide](https://shopify.dev/docs/apps/build/stores/development-stores), [app-linking command](https://shopify.dev/docs/api/shopify-cli/app/app-config-link), and [webhook subscription guide](https://shopify.dev/docs/apps/build/webhooks/get-started?deliveryMethod=http).

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

`app/services/orders.server.ts` exposes `saveReceivedOrder(shop, webhookId, order)` and `getOrdersForShop(shop)`. Both require a nonempty shop. Saving checks for an existing offline session, inserts the delivery receipt, and creates the order in one SQLite transaction. Unknown/uninstalled shops create no records. A repeated delivery returns `duplicate_delivery`; another delivery for the same order records its new receipt and returns `duplicate_order` without replacing the original order. Other storage failures propagate after rollback so the handler returns a retryable response. Expired offline access tokens do not by themselves mean an app was uninstalled.

Order totals use canonical decimal text in SQLite, avoiding its approximate floating-point storage. `app/lib/money.ts` uses Big.js for exact addition and returns one total per currency. It accepts nonnegative plain decimal strings, removes unnecessary leading/trailing zeros without rounding, and rejects JavaScript numbers, exponent notation, and invalid currency-code formats. Display formatting belongs to A4; stored precision is not restricted to two decimal places. See [SQLite floating-point behavior](https://www.sqlite.org/floatingpoint.html) and the [Big.js API](https://mikemcl.github.io/big.js/).

The webhook route uses this service. A5 must still replace the template uninstall handler with a transaction that deletes orders, receipts, and sessions together, so a concurrent delivery cannot restore uninstalled-shop data.

## Order webhook

`app/routes/webhooks.orders.create.tsx` passes the untouched request to the template's `authenticate.webhook(request)`. Only after it succeeds does `app/lib/order-webhook.ts` select and validate the required order fields. Unknown customer fields are ignored. IDs are stored as strings: numeric IDs must be positive safe integers, while positive integer strings retain arbitrary precision. Unsafe numeric IDs are rejected rather than silently rounded. Totals must be exact decimal strings; timestamps must include a timezone and a valid calendar date. Missing/null gateway names become an empty array.

| Delivery | Response and effect |
| --- | --- |
| Valid new order for an installed shop | 200 after the receipt and order commit together. |
| Repeated delivery ID or another delivery of the same order | 200 without changing order counts or values. |
| Valid order for an unknown/uninstalled shop | 200 with an `uninstalled` log outcome; creates no records or installation. |
| Invalid HMAC | SDK's 401 response, no order/receipt writes. |
| Missing signature/required headers, malformed JSON/order fields, or wrong topic | 400, no order/receipt writes. |
| Storage/session-read failure | 503; a rolled-back receipt leaves the same delivery retryable. |

The installed React Router SDK **1.2.1** reads the raw body with `request.text()`, calls the Shopify API SDK **13.1.0** verifier, and only then parses JSON. The verifier computes base64 HMAC-SHA256 with the app secret. Its `safeCompare` checks equal lengths and XORs every byte without exiting at the first difference; it uses the SDK's comparison loop, not Node's native `timingSafeEqual`. Inspected sources under `node_modules`:

- `@shopify/shopify-app-react-router/src/server/authenticate/webhooks/authenticate.ts`
- `@shopify/shopify-api/lib/utils/hmac-validator.ts`
- `@shopify/shopify-api/lib/auth/oauth/safe-compare.ts`
- `@shopify/shopify-api/runtime/crypto/utils.ts`

The helper also loads an offline session and can refresh an expiring access token. `app/shopify.server.ts` therefore uses shared configuration for two SDK instances: admin authentication keeps expiring-token refresh enabled, while the exported webhook authenticator disables that refresh. Webhook handling makes only local database calls, and it awaits storage before acknowledging. Installation is rechecked inside the order transaction rather than trusting the earlier session lookup. This follows [Shopify's delivery verification guidance](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries).

Each handler outcome logs shop, topic, webhook ID, verification state, HTTP status, and duration. Validation errors name the field; storage errors include a Prisma code when available. Bodies, customer fields, tokens, HMAC signatures, and raw exception messages are not logged by the handler.

## Technical decisions and remaining integration

| Decision | Reason |
| --- | --- |
| Reuse the React Router template | Keep setup and authentication within the short time budget. |
| Use `authenticate.webhook(request)` on the untouched request | Verify the signed raw body before using its contents; the installed HMAC and comparison helpers were inspected in A3. |
| Disable token refresh only for webhook authentication | Keep external API calls outside the acknowledgement path while preserving admin authentication. |
| Persist delivery IDs and orders atomically | A crash or retry must not lose an order or count it twice. |
| Unique shop/order and shop/delivery keys | Protect both order identity and webhook idempotency. |
| Commit a short local transaction before HTTP 200 | Acknowledge only safely stored work; storage failures remain retryable. |
| Authenticate dashboard queries and scope every query by shop | Keep merchant data isolated. |
| Verify uninstall even if its session is gone | Cleanup must still remove orders, receipts, and sessions. |
| Use exact decimal amounts and totals per currency | Avoid rounding errors and meaningless mixed-currency totals. |

The dashboard will count all persisted orders received by the app, not historical orders from before installation. COD share is `COD count / order count * 100`, or `0%` when empty. The table will contain the latest 20 orders; metrics will cover all stored orders for that shop.

## Verification

Local checks on 2026-09-22 (tests, typecheck, lint, build, and diff checks rerun for A3):

| Command | Result |
| --- | --- |
| `npm install --no-audit --no-fund` | Passed; dependencies and lockfile installed. |
| `RUST_LOG=info npm run setup` | Passed; generated Prisma Client and applied the order-storage migration to the development database. |
| `npm test` | Passed: 34 tests (16 A2, 11 payload-validation, 7 real-SDK route integration). Storage and route tests use fresh temporary SQLite databases with both committed migrations and remove them afterward. Never resets the development database. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed. |
| `npm run build` | Passed for browser and server bundles. |
| `git diff --check` | Passed. |
| `shopify organization list --json` and `shopify store list --type dev --json` | Verified the new organization and confirmed no existing dev stores before creation. |
| `shopify store create dev --name cod-order-watch-dev --organization-id 236923583 --plan basic --no-demo-data --json` | Passed; created the free dev store. |
| `npm run config:link` | Passed; created/linked COD Order Watch; restored the required scope and webhook API version afterward. |
| `shopify app config validate` | Passed for the linked `shopify.app.toml`. |
| `RUST_LOG=info shopify app dev --store cod-order-watch-dev.myshopify.com --no-color` | Passed after saving the approved data-use declaration; CLI reported Ready and the embedded setup page opened. |
| Admin API `currentAppInstallation { accessScopes { handle } }` | HTTP 200; only `read_orders` granted. Persisted offline session also has `read_orders`. |
| Accepted development bundle | Contains `orders/create`, `app/uninstalled`, and `app/scopes_update` at API version `2025-10`, targeting the current tunnel. Delivery remains untested. |

The agent environment injects `RUST_LOG=warn`, which causes Prisma's schema engine to fail on a fresh SQLite database with an empty error. Fresh-database checks succeeded with `RUST_LOG` unset or set to `info`, matching [Prisma issue #29355](https://github.com/prisma/prisma/issues/29355). If this occurs, run `RUST_LOG=info npm run setup`. No database or schema workaround was needed.

Automated coverage includes COD rules, exact decimal/currency handling, shop isolation, database uniqueness, delivery/order replay, absent installations, invalid storage input, and an actual SQLite trigger failure proving transactional rollback and successful retry. A3 adds signed requests through the actual route action and Shopify authenticator, rejected signatures/headers/topics/payloads, safe logs, and an expired-token test that intercepts network requests and proves none occur. The route-level trigger failure returns 503 without a receipt, then the same delivery returns 200 after the trigger is removed.

For 20 sequential new deliveries in the full test run, local route acknowledgement measured **0.90 ms minimum, 1.28 ms p95, and 3.56 ms maximum**. Timing includes SDK authentication, session lookup, validation, and committed database writes, but excludes HTTP transport and the Cloudflare tunnel. These local measurements are not a production load test. Each real handler invocation also logs its duration.

A6 still needs real Shopify/CLI delivery, dashboard limits/empty state, uninstall, and the remaining end-to-end cases. Live Shopify setup, the authenticated embedded page, and installed scopes are verified. No live order processing or Docker deployment tests have run.

The Admin API `webhookSubscriptions` query returned an empty list, which is expected for this configuration: it returns shop-scoped subscriptions, not the app-scoped subscriptions declared in TOML. The accepted development bundle was checked instead. See [Shopify's query reference](https://shopify.dev/docs/api/admin-graphql/2025-10/queries/webhooksubscriptions).

Dependency audit: npm currently reports 19 high-severity dependency entries rooted in unchanged starter tooling dependencies (`lodash`, `minimatch`, and `deepmerge-ts`). The A2 additions (`big.js`, `@types/big.js`, and `tsx`) were not flagged. Dependency remediation remains pending; no forced upgrades or incompatible Prisma downgrades were applied during A2. This audit does not establish whether an advisory is reachable through the app's request handlers.

To reproduce A3's signed delivery and replay checks locally, run `node --import tsx --test tests/webhooks.orders.create.test.ts` after `npm run setup`, or run the full `npm test` suite. The first integration test submits the same body and `X-Shopify-Webhook-Id` twice, verifies one receipt, then sends a new delivery ID for that same order and verifies one unchanged order with two receipts. It uses only fake credentials and temporary databases.

For A6 manual delivery checks, create a real order in the dev store and use `shopify app webhook trigger` for signed synthetic events. For the live duplicate demonstration, replay the same body **and the same `X-Shopify-Webhook-Id`**; invoking the CLI twice is insufficient unless the delivery ID is preserved. The live replay procedure will be recorded during A6.

The selected optional bonus is a fixed-payload HMAC verification test (B1), only after all A work passes and time remains. No bonus has been completed.

## Actual time spent

Elapsed time is measured for the current work session, including account setup and debugging. Earlier planning time remains unrecorded; the subtotal is not the full project total.

| Activity | Actual minutes | Status |
| --- | --- | --- |
| Brief review and planning | Not recorded | Planning documents created |
| Shopify account, store, and scaffold | 10 | Initial local preparation and checks |
| A1 setup clarification and prerequisite recheck | 3 | Updated workflow from Muhamed's reply and opened Partner signup |
| A1 dev store, app linking, and access diagnosis | 6 | Created dev store, enabled COD, linked app; identified required data declaration |
| A1 approved access and installation verification | 3 | Saved approved declaration; verified embedded app, scope, and development bundle |
| Data model and local tests | 9 | A2 complete locally |
| A3 webhook, SDK inspection, and integration checks | 7 | A3 complete locally; live delivery remains A6 |
| Dashboard and uninstall | Not started | Pending |
| Tests and fixes | Not started | Pending |
| Final README and demo rehearsal | Not started | Pending |
| Optional bonus / additional tests | Not started | Pending |
| **Recorded subtotal** | **38** | Earlier planning and user-led organization signup time still need to be added |

## Scope choices and more time

The timed implementation will omit historical backfill, order-update synchronization, Shopify order tagging, extra bonus features, custom OAuth, production hosting, and elaborate dashboard controls. Refreshing the page is sufficient for the initial demo.

For 10,000 merchants, the proposed next steps are a durable webhook queue with workers, PostgreSQL, retry/dead-letter handling, reconciliation for missed events, monitoring, and query/aggregation improvements. Full compliance webhook handling belongs in the production/public-app work before launch; this take-home selects the HMAC test as its optional bonus.

These are planned tradeoffs, not a claim that the app is implemented or production-ready. Update this section with actual omissions and known limitations before handing over the repository.
