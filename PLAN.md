# COD Order Watch - Work Plan

Build a small embedded Shopify app that receives new orders, identifies Cash-On-Delivery (COD) orders, and shows a dashboard for the current shop.

Based on the five-page `Shopify-Interview-Task.pdf`, including its setup appendix. This plan covers implementation, verification, documentation, and the presentation. A1-A5 are complete. A6 has verified real Shopify order delivery, dashboard figures, signed replay/rejection, and all automated checks; the live uninstall/reinstall check is awaiting confirmation. A7 documentation and presentation remain next.

## Priorities and working rules

- **A - Very important:** required for a complete submission. Finish every A task before starting B.
- **B - Important:** improve confidence after A is complete, only within the remaining budget.
- **C - Optional:** can be skipped without compromising the required submission.
- Work in numbered order within each priority. If a required feature breaks during B or C, return to A.
- Commit after each meaningful milestone. Keep functions small and be ready to explain all code, including AI-assisted code.
- Keep `README.MD` limited to the PDF's requested content: how to run, the COD rule, key decisions, actual time spent, improvements with more time, and conscious omissions. Keep internal progress and verification records in this plan.
- Record actual elapsed time in the README's adjacent Started / Finished / Total elapsed time columns. Vladimir started on **2026-09-22 at 08:30 (Asia/Jerusalem)**. Leave Finished and Total elapsed time empty until A7 is complete, then calculate elapsed time from that start, including setup, debugging, and rehearsal. Estimates below are not actual time.

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

**Complete:** Vladimir created the `test-assignment` Partner organization. Created the free Basic dev store `cod-order-watch-dev.myshopify.com`, activated Cash on Delivery, and created/linked **COD Order Watch** using the existing repository. With Vladimir's explicit approval, saved Analytics as the protected customer data use for development; customer name, email, phone, and address fields remain unselected. No distribution method or App Store review submission was needed. `shopify app dev` now starts successfully, and the installed app's authenticated setup page opens inside Shopify. A direct Admin API query confirms `read_orders` is the only granted scope, also reflected in the persisted offline session. The accepted development bundle includes `orders/create`, `app/uninstalled`, and `app/scopes_update` at API version `2025-10`, pointing to the current tunnel. Webhook delivery and business behavior still belong to A3/A6. The local development server was left running after verification.

- [x] Create Vladimir's own Partner organization and a **Dev** store for app testing, using `npm run shopify -- store create dev` or the Dev Dashboard; enable the manual Cash on Delivery payment method.
- [x] Use TypeScript and the Shopify CLI React Router template with Prisma/SQLite. Tested locally with Node 26.5.0 and Shopify CLI 4.8.0; the project requires Node 22.12+.
- [x] Create/link **COD Order Watch** with `npm run config:link` and run `npm run dev`. The official starter is already in this repository; do not repeat `app init` over the existing app. Linking can overwrite `shopify.app.toml`, so preserve/reapply `read_orders` and the webhook declarations before starting development.
- [x] Install the app on the dev store and open its embedded page.
- [x] Request the minimum necessary `read_orders` scope, resolve any required protected customer data access setup, and confirm the installed app has the scope.
- [x] Declare `orders/create` and `app/uninstalled` in `shopify.app.toml` under `[[webhooks.subscriptions]]`, using relative handler URLs and the template's supported API version. Confirm the dev configuration is applied.
- [x] Add `.env` and other local secrets, database files, and generated artifacts to `.gitignore` before committing app files. Preserve the task PDF exclusion and commit the dependency lockfile.

**Done when:** the app opens inside the dev store, local development works, and subscription/scopes configuration is in place. No hosting deployment is required.

### A2 - Define shop-scoped storage and the COD rule

Uses the starter from A1. Implemented locally while Partner setup was pending; A1 installation is now verified.

**Complete locally:** migrations work on both the existing development database and a fresh temporary database. Sixteen A2 automated tests cover COD examples, exact amounts, currency separation, shop isolation, both unique keys, duplicate deliveries/orders, unknown shops, invalid storage input, and rollback followed by retry. A3 now connects the webhook route to this order service.

- [x] Preserve the template's session storage for authentication and installed-shop checks.
- [x] Add an Order model containing shop, Shopify order ID, name, total, currency, gateway names, order creation time, and `isCod`. Keep order IDs as strings.
- [x] Enforce unique `(shop, orderId)` and `(shop, webhookId)` keys, using a separate webhook receipt model for delivery IDs.
- [x] Save the receipt and order in one database transaction so a failed write cannot permanently mark an event as processed.
- [x] Store exact decimal amounts and use decimal arithmetic for totals; do not sum different currencies together.
- [x] Implement a small COD classifier: trim and lowercase gateway names; COD is true if any contains `cash`, or if `financial_status` is `pending` and a normalized gateway equals `manual`.

**Done when:** migrations work on an empty database, the classifier has explicit examples, and all order reads/writes require a shop. Include cash, pending/manual, paid/manual, and missing-gateway examples.

### A3 - Receive orders securely and without double counting

Depends on A1 and A2.

**Complete locally:** the route uses the real Shopify authenticator, validates required fields, and awaits the atomic storage service. Signed route tests use fresh migrated SQLite databases and prove replay, rejection, unknown-shop no-ops, rollback/retry, and no outbound calls even with an expired token and refresh token. The installed SDK's raw-body HMAC and comparison code were inspected. Webhook authentication disables automatic token refresh; admin authentication retains it. Live Shopify/tunnel delivery is still A6.

**Verification on 2026-09-22:** `npm test` passed 34 tests (16 A2, 11 payload-validation, 7 real-SDK route integration); `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` passed. Twenty sequential new deliveries measured 0.90 ms minimum, 1.28 ms p95, and 3.56 ms maximum through the local route action, excluding HTTP transport and the tunnel. The tests use fresh migrated temporary SQLite databases, never reset the development database, and generate signatures with fake credentials. Replay uses the same body and delivery ID, then a new delivery ID for the same order. A trigger-induced storage failure rolls back the receipt and returns 503; retry returns 200 after removing the trigger. This is not the independently precomputed fixed-signature B1 bonus.

- [x] Implement the `orders/create` handler with the template's `authenticate.webhook(request)` before consuming or trusting the body. Inspect the installed helper so we can explain raw-body HMAC verification and constant-time comparison.
- [x] Reject invalid signatures, malformed payloads, missing delivery IDs, and wrong topics without writing order data. Do not turn authentication failures into success responses.
- [x] For a verified delivery, check that the shop is installed. Ignore unknown/uninstalled shops with a logged no-op and HTTP 200; never create an installation from an order webhook.
- [x] Use `X-Shopify-Webhook-Id` for persistent deduplication. Enforce uniqueness in the database rather than relying on an in-memory set or a check followed by an unprotected insert.
- [x] Write only the required fields and the COD result. A second delivery for an already stored order must not create a second order, even if its delivery ID differs.
- [x] Return HTTP 200 after the short database transaction commits; duplicates also return 200. On a transient storage failure, roll back and return 5xx so Shopify can retry.
- [x] Keep the request path free of external API calls and unfinished background promises. Measure acknowledgement latency locally; aim comfortably below Shopify's five-second deadline.
- [x] Log shop, topic, delivery ID, outcome, and useful error context without secrets or full customer payloads.

**Done when:** one valid delivery creates one order; replaying the same delivery changes neither counts nor totals; rejected input creates no data; a failed transaction remains retryable.

### A4 - Build the embedded Polaris dashboard

Depends on A2 and A3.

**Complete:** the embedded Polaris dashboard derives its shop from the authenticated session, reads one shop-scoped order snapshot, and calculates metrics over all received orders while returning only the latest 20 rows. Amounts retain exact decimal precision and display currency codes; dates explicitly use UTC. Refresh revalidates the loader. Empty shops show zero counts/share and guidance; storage failures return 503 with a readable retry message, while authentication responses pass through to Shopify's boundary.

**Verification on 2026-09-22:** `npm test` passed 40 tests, including six new dashboard cases using a fresh migrated temporary database. These cover an empty shop, 25-order aggregates versus 20 displayed rows, multiple currencies, creation-date/ID ordering, refresh after insertion, authenticated-shop isolation despite a different query parameter, authentication redirects, actual database-read failure, safe error output, and exact amount formatting. Loader tests stub only the admin authentication boundary; browser verification used the installed app's real authentication. Typecheck, lint, build, and diff checks passed. Inside Shopify, Refresh showed three temporary local sample orders, two COD orders, 66.7%, EUR 9.50, and USD 100.30 with the correct rows. All three samples and their receipts were removed, and another Refresh restored the zero/empty state. These were local storage fixtures; actual Shopify order delivery remains A6.

- [x] Authenticate the admin request and derive its shop from the authenticated session, never from a user-supplied shop parameter.
- [x] Show total orders received, COD orders, COD percentage, and total order value using all stored orders for that shop.
- [x] Calculate COD share as `COD orders / all orders * 100`, with `0%` for an empty shop.
- [x] Show the latest 20 orders sorted by order creation time, using order ID to break ties. Include name, date, formatted total/currency, gateway names, and COD yes/no.
- [x] Provide a useful empty state and readable error state. Use refresh/reload for the demo; live polling is optional.
- [x] Show monetary totals separately per currency if necessary; the displayed value is received order value, not collected COD revenue.

**Done when:** a new order appears after refresh, figures match stored data, a fresh installation works with no orders, and another shop's data is inaccessible.

### A5 - Delete shop data on uninstall

Depends on A2 and A3.

**Complete locally:** the uninstall route verifies the untouched request with Shopify's authenticator, rejects the wrong topic, and cleans up the authenticated shop even if no session remains. `deleteShopData` deletes every online/offline session, order, and webhook receipt for that shop in one transaction. It acknowledges only after commit; repeats are harmless, and cleanup failures return 503 for retry. Logs include shop, topic, delivery ID, outcome, and deletion counts without payloads or secrets.

Order processing checks installation inside its transaction. With [SQLite's transaction isolation](https://www.sqlite.org/isolation.html), an order that commits first is removed by cleanup; an order that proceeds after cleanup sees no installation and writes nothing. Storage conflicts propagate for retry. No in-memory lock or extra installation record is required for this SQLite implementation; re-evaluate locking when moving to another database.

**Verification on 2026-09-22:** `npm test` passed 48 tests; typecheck, lint, build, and diff checks passed. The shared real-SDK route suite is now `tests/webhooks.test.ts`. Eight new cases cover deletion of all shop-owned records while preserving a second shop, repeated uninstalls, HMAC enforcement without sessions, invalid signatures/headers/JSON/topics, rollback after failure of the final delete, late order replays, both order-first and uninstall-first transaction races, and empty-shop-key rejection. Race tests pause inside actual transactions and start the competing operation through a separate Prisma connection to the same temporary database. All tests use disposable databases and fake credentials. The installed development store was not uninstalled; real uninstall/reinstall verification remains A6.

- [x] Authenticate `app/uninstalled` with HMAC, even when no active session remains.
- [x] Delete that shop's orders, webhook receipts, and sessions in a transaction. Include any other shop-owned records introduced during implementation.
- [x] Make repeat uninstall notifications harmless and return HTTP 200 after cleanup succeeds.
- [x] Ensure later order deliveries cannot recreate data while the shop is uninstalled, including the order/uninstall concurrency boundary.

**Done when:** uninstall removes the targeted shop's data, leaves another shop untouched, and repeated uninstall or late order deliveries do not restore deleted data.

### A6 - Verify the required behavior

Depends on A1-A5. Fix failures before moving on.

- [x] Add meaningful automated coverage for COD classification and database-backed duplicate handling. Include two shop fixtures to check isolation; use a temporary test database.
- [x] Create a real COD order in the development store, refresh the dashboard, and compare the row, counts, percentage, and amount. Also verify a non-COD order.
- [x] Use `shopify app webhook trigger` to check signed synthetic delivery. Prove replay separately with the **same body and same `X-Shopify-Webhook-Id`**; do not assume two CLI invocations reuse the ID.
- [x] Check invalid HMAC, malformed payload, unknown shop, zero orders, and more than 20 orders. Aggregates must include all orders, while the table contains only 20.
- [ ] Check storage failure/retry behavior, uninstall cleanup, repeat uninstall, and late delivery after uninstall.
- [x] Run the scaffold's available type, lint, build, and test checks. Record actual commands and results in this plan; keep the README's run/check instructions current and inspect staged files for secrets.

**Done when:** required cases pass, there is at least one meaningful automated test, and the end-to-end demo works. The specific fixed-signature HMAC bonus remains B1.

**A6 verification on 2026-09-22 (lifecycle check pending):**

- Created two real orders in the development store, with no customer contact details, taxes, shipping, or card charges. Per Vladimir's limit, each was **USD 0.50**, **USD 1.00 combined**. The initial USD 25.50 draft was reduced before order creation. Order `#1001` was created unpaid with no gateway and correctly classified non-COD; `#1002` was manually marked paid using `Cash on Delivery (COD)` and correctly classified COD. Both arrived through Shopify's actual `orders/create` subscription. The embedded dashboard's Refresh showed 2 orders, 1 COD, 50%, USD 1.00, and both correct rows.
- Sent separately signed requests to the live tunnel: invalid HMAC returned 401; malformed JSON and missing required fields returned 400; an unknown shop returned 200. None wrote orders or receipts. Replayed exactly the same raw body and `X-Shopify-Webhook-Id`: both requests returned 200, and the second changed neither orders nor receipts. A different delivery ID for the same order also kept the order count unchanged.
- Added 19 clearly named, zero-value synthetic order deliveries through HTTP. Refresh showed 21 orders, 20 COD, 95.2%, USD 1.00, and exactly 20 latest rows. The oldest USD 0.50 order was outside the table but remained in the USD 1.00 aggregate. Empty-state behavior was verified before these orders and is also covered by automated tests.
- Ran `npm run shopify -- app webhook trigger --topic orders/create --api-version 2025-10 --delivery-method http --address <development-endpoint>`, with the client secret supplied privately via `SHOPIFY_FLAG_CLIENT_SECRET`. The remote command reported enqueued delivery. A temporary loopback receiver then verified the CLI sample's HMAC and forwarded its unchanged body and Shopify headers to the live endpoint, confirming HTTP 400. The fixed sample's numeric ID is larger than `Number.MAX_SAFE_INTEGER`, so the existing deliberate validation rejects it rather than storing a rounded ID. Real Shopify orders and independently signed string-ID fixtures passed; the CLI sample is not evidence of a subscription failure.
- Repeated the CLI check with `--topic app/uninstalled` and the uninstall endpoint. The signed sample for `shop.myshopify.com` returned HTTP 200 through the same temporary receiver, and the CLI reported successful local delivery. The installed development shop remained untouched.
- `npm test` passed all **48 tests** against disposable migrated databases, including two-shop isolation, transaction failure/rollback/retry, repeated uninstall, late deliveries, and both uninstall/order race directions. `npm run typecheck`, `npm run lint`, and `npm run build` passed. Build output contained only the existing React Router future-option notices.
- `git diff --cached --check` passed; staged documentation was checked against the actual private app secret and credential/token patterns without printing credentials. The live uninstall confirmation remains open; no uninstall has occurred yet. README finish and elapsed time remain blank until A7.

### A7 - Finish documentation and prepare the submission

Depends on A6.

- [ ] Finalize `README.MD` using only the PDF's six requested topics: how to run, the COD rule, key decisions, actual time spent, improvements with more time, and conscious omissions. Include verified installation/run/test commands and needed environment variable names under how to run; keep internal progress and verification logs in this plan.
- [ ] Check that a reviewer can understand how to start the app within two minutes. Replace planned statements with observed implementation details.
- [ ] Keep coherent milestone commits, review the final changes, and prepare the Git repository link for submission.
- [ ] Rehearse a 15-minute walkthrough: 2 minutes for context/setup, 5 for a live order and duplicate replay, 5 for the handler/model/security, and 3 for tradeoffs and scaling to 10,000 merchants.
- [ ] Prepare for approximately 10 minutes of Q&A: raw-body verification, atomic deduplication, shop isolation, uninstall, money handling, and scaling limits.
- [ ] When all A7 work is complete, fill in the README's Finished time and Total elapsed time next to Started. Use the actual completion date/time in Asia/Jerusalem and calculate the duration from **2026-09-22 08:30**, expressed in hours and minutes. Keep both fields empty until then.

**Done when:** every required deliverable is ready, no undocumented required feature is missing, the local demo runs with `shopify app dev`, and the README shows the actual start, finish, and total elapsed time together.

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
