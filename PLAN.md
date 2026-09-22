# COD Order Watch - Work Plan

Build a small embedded Shopify app that receives new orders, identifies Cash-On-Delivery (COD) orders, and shows a dashboard for the current shop.

Based on the five-page `Shopify-Interview-Task.pdf`, including its setup appendix. This plan covers implementation, verification, documentation, and the presentation. A2 is complete locally. A1 now has Vladimir's own Partner organization, dev store, and linked app; installation is waiting for the protected customer data declaration required for order webhooks.

## Priorities and working rules

- **A - Very important:** required for a complete submission. Finish every A task before starting B.
- **B - Important:** improve confidence after A is complete, only within the remaining budget.
- **C - Optional:** can be skipped without compromising the required submission.
- Work in numbered order within each priority. If a required feature breaks during B or C, return to A.
- Commit after each meaningful milestone. Keep functions small and be ready to explain all code, including AI-assisted code.
- Record actual elapsed work in `README.MD`, including planning, account setup, debugging, and rehearsal. Estimates below are not actual time.

## Time budget

Target: **270 minutes (4.5 hours)**. Absolute stop: **330 minutes (5.5 hours)**.

| Work | Planned minutes |
| --- | ---: |
| Brief review and planning | 10 |
| A1 - Setup and installation | 30 |
| A2 - Data model and COD rule | 25 |
| A3 - Order webhook | 55 |
| A4 - Embedded dashboard | 35 |
| A5 - Uninstall cleanup | 15 |
| A6 - Required verification | 35 |
| A7 - README and presentation | 30 |
| B1 - Selected bonus test | 15 |
| B2 - Additional reliability tests | 10 |
| Contingency | 10 |
| **Total** | **270** |

Use the budget as a limit, not a reason to rush correctness. If setup or implementation runs long, drop B and C first. At 270 minutes, stop adding features; use any extension only to fix required failures and finish the handoff. At 330 minutes, stop and document remaining gaps honestly. C has no reserved time.

## A - Required work

### A1 - Set up Shopify and install the starter app

**Progress:** Vladimir created the `test-assignment` Partner organization. Created the free Basic dev store `cod-order-watch-dev.myshopify.com` with no demo data, activated Cash on Delivery, and created/linked **COD Order Watch** using the existing repository. The `read_orders` scope, `2025-10` webhook API version, and all three webhook declarations were preserved. `shopify app dev` started Prisma, the local server, and the tunnel, but Shopify rejected the preview because the app is not yet approved for order webhooks containing protected customer data. The Partner Dashboard allows the development data-use declaration without selecting distribution; no distribution method has been selected. Saving the proposed Analytics reason was blocked by automatic approval review and requires user authorization. Customer name, email, phone, and address fields remain unselected. Installation, granted-scope verification, and live webhook configuration remain pending. The development server stopped after the preview failure.

- [x] Create Vladimir's own Partner organization and a **Dev** store for app testing, using `npm run shopify -- store create dev` or the Dev Dashboard; enable the manual Cash on Delivery payment method.
- [x] Use TypeScript and the Shopify CLI React Router template with Prisma/SQLite. Tested locally with Node 26.5.0 and Shopify CLI 4.8.0; the project requires Node 22.12+.
- [ ] Create/link **COD Order Watch** with `npm run config:link` and run `npm run dev`. The official starter is already in this repository; do not repeat `app init` over the existing app. Linking can overwrite `shopify.app.toml`, so preserve/reapply `read_orders` and the webhook declarations before starting development.
- [ ] Install the app on the dev store and open its embedded page.
- [ ] Request the minimum necessary `read_orders` scope, resolve any required protected customer data access setup, and confirm the installed app has the scope.
- [ ] Declare `orders/create` and `app/uninstalled` in `shopify.app.toml` under `[[webhooks.subscriptions]]`, using relative handler URLs and the template's supported API version. Confirm the dev configuration is applied.
- [x] Add `.env` and other local secrets, database files, and generated artifacts to `.gitignore` before committing app files. Preserve the task PDF exclusion and commit the dependency lockfile.

**Done when:** the app opens inside the dev store, local development works, and subscription/scopes configuration is in place. No hosting deployment is required.

### A2 - Define shop-scoped storage and the COD rule

Uses the local starter from A1. Proceeding locally while Partner setup is pending was approved; A1 still needs to finish before live Shopify verification.

**Complete locally:** migrations work on both the existing development database and a fresh temporary database. Sixteen automated tests cover COD examples, exact amounts, currency separation, shop isolation, both unique keys, duplicate deliveries/orders, unknown shops, invalid storage input, and rollback followed by retry. The order service is ready for A3; the live webhook route still returns 503 after authentication.

- [x] Preserve the template's session storage for authentication and installed-shop checks.
- [x] Add an Order model containing shop, Shopify order ID, name, total, currency, gateway names, order creation time, and `isCod`. Keep order IDs as strings.
- [x] Enforce unique `(shop, orderId)` and `(shop, webhookId)` keys, using a separate webhook receipt model for delivery IDs.
- [x] Save the receipt and order in one database transaction so a failed write cannot permanently mark an event as processed.
- [x] Store exact decimal amounts and use decimal arithmetic for totals; do not sum different currencies together.
- [x] Implement a small COD classifier: trim and lowercase gateway names; COD is true if any contains `cash`, or if `financial_status` is `pending` and a normalized gateway equals `manual`.

**Done when:** migrations work on an empty database, the classifier has explicit examples, and all order reads/writes require a shop. Include cash, pending/manual, paid/manual, and missing-gateway examples.

### A3 - Receive orders securely and without double counting

Depends on A1 and A2.

- [ ] Implement the `orders/create` handler with the template's `authenticate.webhook(request)` before consuming or trusting the body. Inspect the installed helper so we can explain raw-body HMAC verification and constant-time comparison.
- [ ] Reject invalid signatures, malformed payloads, missing delivery IDs, and wrong topics without writing order data. Do not turn authentication failures into success responses.
- [ ] For a verified delivery, check that the shop is installed. Ignore unknown/uninstalled shops with a logged no-op and HTTP 200; never create an installation from an order webhook.
- [ ] Use `X-Shopify-Webhook-Id` for persistent deduplication. Enforce uniqueness in the database rather than relying on an in-memory set or a check followed by an unprotected insert.
- [ ] Write only the required fields and the COD result. A second delivery for an already stored order must not create a second order, even if its delivery ID differs.
- [ ] Return HTTP 200 after the short database transaction commits; duplicates also return 200. On a transient storage failure, roll back and return 5xx so Shopify can retry.
- [ ] Keep the request path free of external API calls and unfinished background promises. Measure acknowledgement latency locally; aim comfortably below Shopify's five-second deadline.
- [ ] Log shop, topic, delivery ID, outcome, and useful error context without secrets or full customer payloads.

**Done when:** one valid delivery creates one order; replaying the same delivery changes neither counts nor totals; rejected input creates no data; a failed transaction remains retryable.

### A4 - Build the embedded Polaris dashboard

Depends on A2 and A3.

- [ ] Authenticate the admin request and derive its shop from the authenticated session, never from a user-supplied shop parameter.
- [ ] Show total orders received, COD orders, COD percentage, and total order value using all stored orders for that shop.
- [ ] Calculate COD share as `COD orders / all orders * 100`, with `0%` for an empty shop.
- [ ] Show the latest 20 orders sorted by order creation time, using order ID to break ties. Include name, date, formatted total/currency, gateway names, and COD yes/no.
- [ ] Provide a useful empty state and readable error state. Use refresh/reload for the demo; live polling is optional.
- [ ] Show monetary totals separately per currency if necessary; the displayed value is received order value, not collected COD revenue.

**Done when:** a new order appears after refresh, figures match stored data, a fresh installation works with no orders, and another shop's data is inaccessible.

### A5 - Delete shop data on uninstall

Depends on A2 and A3.

- [ ] Authenticate `app/uninstalled` with HMAC, even when no active session remains.
- [ ] Delete that shop's orders, webhook receipts, and sessions in a transaction. Include any other shop-owned records introduced during implementation.
- [ ] Make repeat uninstall notifications harmless and return HTTP 200 after cleanup succeeds.
- [ ] Ensure later order deliveries cannot recreate data while the shop is uninstalled, including the order/uninstall concurrency boundary.

**Done when:** uninstall removes the targeted shop's data, leaves another shop untouched, and repeated uninstall or late order deliveries do not restore deleted data.

### A6 - Verify the required behavior

Depends on A1-A5. Fix failures before moving on.

- [ ] Add meaningful automated coverage for COD classification and database-backed duplicate handling. Include two shop fixtures to check isolation; use a temporary test database.
- [ ] Create a real COD order in the development store, refresh the dashboard, and compare the row, counts, percentage, and amount. Also verify a non-COD order.
- [ ] Use `shopify app webhook trigger` to check signed synthetic delivery. Prove replay separately with the **same body and same `X-Shopify-Webhook-Id`**; do not assume two CLI invocations reuse the ID.
- [ ] Check invalid HMAC, malformed payload, unknown shop, zero orders, and more than 20 orders. Aggregates must include all orders, while the table contains only 20.
- [ ] Check storage failure/retry behavior, uninstall cleanup, repeat uninstall, and late delivery after uninstall.
- [ ] Run the scaffold's available type, lint, build, and test checks. Record actual commands and results in the README; inspect staged files for secrets.

**Done when:** required cases pass, there is at least one meaningful automated test, and the end-to-end demo works. The specific fixed-signature HMAC bonus remains B1.

### A7 - Finish documentation and prepare the submission

Depends on A6.

- [ ] Update `README.MD` with verified installation/run/test commands, environment variable names without values, the COD rule, key decisions, actual time, omissions, and future improvements.
- [ ] Check that a reviewer can understand how to start the app within two minutes. Replace planned statements with observed implementation details.
- [ ] Keep coherent milestone commits, review the final changes, and prepare the Git repository link for submission.
- [ ] Rehearse a 15-minute walkthrough: 2 minutes for context/setup, 5 for a live order and duplicate replay, 5 for the handler/model/security, and 3 for tradeoffs and scaling to 10,000 merchants.
- [ ] Prepare for approximately 10 minutes of Q&A: raw-body verification, atomic deduplication, shop isolation, uninstall, money handling, and scaling limits.

**Done when:** every required deliverable is ready, no undocumented required feature is missing, and the local demo runs with `shopify app dev`.

## B - Important, only after all A tasks are complete

### B1 - Add the selected bonus: fixed-signature HMAC test

- [ ] Test the production verification path with a fixed payload, test secret, and independently precomputed signature.
- [ ] Prove acceptance of the valid request and rejection when a byte changes or the signature is missing/invalid.
- [ ] Avoid testing a separate verifier that the handler never uses. Record this as our **one chosen bonus** in the README.

**Done when:** the test passes and demonstrably catches tampering. Skip if it would threaten the time limit.

### B2 - Extend reliability coverage

- [ ] Add focused automated cases for concurrent duplicate deliveries, transaction rollback followed by retry, and uninstall isolation where A6 only provided manual coverage.
- [ ] Re-run affected checks and refresh documented results after the changes.

**Done when:** the added tests exercise meaningful failure modes and the app remains ready for presentation.

## C - Optional and safe to skip

### C1 - Dashboard convenience and visual polish

- [ ] Consider automatic refresh, clearer gateway badges, or small responsive-layout improvements.
- [ ] Skip charts, filters, pagination, and custom styling unless all higher priorities are finished with time left.

### C2 - Future feature backlog

- [ ] After the take-home, consider `orders/updated`, Shopify `COD` tagging, and compliance webhooks. These are alternative bonuses in the brief; do not add them on top of B1 during the timed submission.
- [ ] For production, investigate a durable queue, workers, PostgreSQL, reconciliation for missed orders, monitoring, and complete privacy workflows.

**Done when:** worthwhile follow-ups are documented. Implementation can be skipped entirely; production readiness is outside this local-demo scope.

## Reference notes

- The PDF is the scope authority; its setup appendix is the setup material even though it mentions a separate `SETUP.md`.
- [Shopify app scaffolding](https://shopify.dev/docs/apps/build/scaffold-app) and [CLI requirements](https://shopify.dev/docs/api/shopify-cli) inform A1. The brief permits Node 20+, but the current CLI requires 22.12+.
- Muhamed's setup clarification: create a personal Partner organization and free dev store; company access and a paid subscription are unnecessary. Follow [dev-store creation](https://shopify.dev/docs/apps/build/stores/development-stores) and [linking an existing app](https://shopify.dev/docs/api/shopify-cli/app/app-config-link) for the prepared repository.
- [Webhook subscriptions](https://shopify.dev/docs/apps/build/webhooks/get-started?deliveryMethod=http) covers configuration and order access; [delivery verification](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries) covers HMAC, duplicates, and timeouts.
