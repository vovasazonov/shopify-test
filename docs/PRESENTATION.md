# COD Order Watch: presentation notes

Submission: [Git repository](https://github.com/vovasazonov/shopify-test). Allow 15 minutes for the demo/walkthrough and approximately 10 minutes for questions. This is a local development demo; no hosting deployment is required.

## Before presenting

1. Follow [the README](../README.MD), start `npm run dev -- --store cod-order-watch-dev.myshopify.com`, and open the CLI preview. Keep it running. If reinstalling, restart development and reopen the preview so the local app and subscriptions are active.
2. Open the embedded dashboard, Shopify Orders, the development terminal, and the source files listed below. Refresh and note the starting counts and currency totals. An installation after uninstall is empty even if Shopify still contains older orders.
3. Privately obtain the app's client secret from the Dev Dashboard or `npm run shopify -- app env show`. This command displays credentials: do it before screen sharing. Set the secret in the replay terminal without putting its value in shell history. For zsh:

   ```sh
   read -rs 'SHOPIFY_API_SECRET?App client secret: '; echo
   export SHOPIFY_API_SECRET
   export DEMO_APP_URL='https://YOUR-CURRENT-TUNNEL.trycloudflare.com'
   ```

   Replace the URL with the current app URL printed by `shopify app dev`. The separate replay terminal does not inherit credentials from the development server.

4. Have a low-value development order ready to create using the manual **Cash on Delivery (COD)** payment method. Do not use a real card or collect money. In A6, the successful path was to select **Cash on Delivery (COD)** while manually marking the test order paid; the gateway still makes it COD. Creating an unpaid order without a gateway is correctly non-COD.
5. Run the automated checks before the meeting. Keep the focused replay command below available if the tunnel fails. It uses fake credentials and disposable storage; identify it as a local route test, not a live Shopify delivery.

## 00:00-02:00 — Context and setup

Say: “This app answers how many orders received since installation are Cash-On-Delivery. The dashboard is embedded in Shopify and uses Polaris. I chose the React Router template, TypeScript, and Prisma/SQLite so the work focuses on reliable webhook handling and shop isolation.”

Show the four metrics and the latest-order columns. Explain that total order value includes all received orders, currencies stay separate, dates are UTC, and Refresh loads new data. Describe the COD rule: normalize gateway names; any containing `cash` qualifies, as does exact `manual` with exact `pending` status. This is a classification rule, not proof of collected payment.

## 02:00-07:00 — Live order and exact replay

**02:00-04:30: real Shopify order.** Create the prepared development order, return to the app, and click Refresh. Match its name, gateway, COD flag, date, and amount. If the baseline was N orders and C COD orders, a COD order produces N+1 and C+1; share is `(C+1)/(N+1)*100`. Only its currency total increases. Show the `created` outcome in the development terminal. This demonstrates Shopify → tunnel → authenticated handler → database → authenticated dashboard.

**04:30-07:00: repeat the same signed delivery.** Use the committed zero-value fixture for a predictable demonstration. It is synthetic, contains no customer data, and does not create an order in Shopify:

```sh
node scripts/replay-order.mjs "$DEMO_APP_URL" cod-order-watch-dev.myshopify.com docs/demo-order.json
```

Expect HTTP 200, then Refresh. On the fixture's first delivery, `#DEMO-REPLAY` appears as COD, order and COD counts each increase by one, and order value is unchanged. Run the **identical command again**, then Refresh: counts, share, totals, and row remain unchanged. The log changes from `created` to `duplicate_delivery` with the same delivery ID. HTTP 200 alone is insufficient evidence: an uninstalled shop also receives 200 without a write.

The helper reads the file as raw bytes, derives a stable delivery ID from their SHA-256 digest, and signs those same bytes using the app secret. Each invocation sends once so there is time to inspect the dashboard. Do not edit the file between sends. If previously used, the fixture is already a duplicate; for a new demonstration, copy it to a temporary file, choose a new positive string ID and matching GID suffix, and use that same file for both sends. Its timestamp controls its table position; use a current ISO timestamp if more than 20 newer orders exist.

Two separate `shopify app webhook trigger` calls are not proof that the delivery ID stayed the same. The helper deliberately controls both body and delivery ID. After the demo, `unset SHOPIFY_API_SECRET DEMO_APP_URL` in the replay terminal.

If connectivity fails, spend at most 30 seconds diagnosing it, then run:

```sh
node --import tsx --test --test-name-pattern='signed route delivery persists only required fields and replay never double counts' tests/webhooks.test.ts
```

Open that test to show three successful requests: original delivery, identical replay, and a new delivery ID for the same order. Assertions prove one order, one receipt after identical replay, two receipts after the new delivery ID, unchanged stored values, and no second-shop data. Refer to A6 in [the plan](../PLAN.md) for the separately recorded real Shopify order and uninstall/reinstall checks.

## 07:00-12:00 — Handler, model, and security

| Time        | Open                                                                                                | Explain                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 07:00-08:30 | `app/routes/webhooks.orders.create.tsx`, `app/lib/webhook.server.ts`, `app/shopify.server.ts`       | The shared wrapper gives the untouched request to Shopify's SDK before reading payload fields. HMAC-SHA256 uses the client secret and raw body; the Base64 result is compared against the header. Re-serializing parsed JSON can alter whitespace/key ordering and break the signature. The installed SDK rejects unequal lengths and uses a full-byte XOR loop for equal lengths. SDK authentication failures retain their rejection responses. Webhook authentication disables token refresh; admin authentication keeps it. |
| 08:30-10:30 | `app/lib/order-webhook.ts`, `prisma/schema.prisma`, `app/services/orders.server.ts`                 | Validate required fields and preserve exact IDs and decimal text. Order's key is `(shop, orderId)`; receipt's key is `(shop, webhookId)`. In one transaction, check the offline session, insert the receipt, check the existing order, and insert if new. A failing order write rolls back the receipt; a retry can succeed. Database uniqueness survives restarts and concurrent deliveries.                                                                                                                                  |
| 10:30-12:00 | `app/routes/app._index.tsx`, `app/services/dashboard.server.ts`, `app/services/uninstall.server.ts` | Dashboard shop comes from the authenticated session, never a query parameter. Aggregates use all received orders; only 20 rows reach the table. Big.js sums decimal strings by currency. HMAC-authenticated uninstall deletes sessions, orders, and receipts atomically; late deliveries see no installation. Show the test names for isolation, rollback, and both uninstall/order race directions.                                                                                                                           |

Explain acknowledgement precisely: HTTP 200 follows a completed local transaction or a verified duplicate/uninstalled no-op. Invalid input is rejected. A storage failure returns 503. There are no outbound API calls or unfinished background promises in this path. Local route timings exclude the HTTP server and tunnel and are not production performance guarantees.

## 12:00-15:00 — Tradeoffs and 10,000 merchants

Say: “SQLite and loading one shop's complete order history are deliberate choices for a small local app. Merchant count alone does not size production; order rate, burst size, and retention matter.”

1. Move to PostgreSQL with connection pooling and indexed shop queries. Revisit transaction isolation and lock an installation record consistently between workers and uninstall. Preserve both uniqueness constraints and exact decimal types.
2. Authenticate, validate, and durably accept deliveries before acknowledging. Process them with idempotent workers; add bounded retries, dead-letter handling, queue-age monitoring, and per-shop fairness. A queue does not create exactly-once delivery.
3. Fetch the latest 20 with an indexed limit; maintain exact aggregates by shop/currency transactionally instead of scanning every order. Reconcile missed deliveries with rate-limited Admin API access, and define update/refund semantics before claiming revenue reporting.
4. Prevent queued work from restoring deleted shops using an installation generation or tombstone. Address backups, retention, compliance webhooks, and monitoring before production distribution.

Close on the demonstrated behavior: one received order, one count, correct shop, retryable failures, and cleanup on uninstall. Disclose historical backfill, updates, tagging, compliance workflows, hosting, and bonus tasks as omissions. All implementation and verification status is recorded in the plan.

## Q&A prompts — approximately 10 minutes

| Question                                        | Answer                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Why must verification use the raw body?         | HMAC authenticates bytes, not a parsed object. Whitespace and encoding changes produce a different signature. The route passes the untouched Request to Shopify's authenticator before consuming its payload.                                                                                                |
| Did you implement the constant-time comparison? | No. The installed Shopify SDK performs length checks and an XOR accumulation across all bytes for equal-length strings. The app uses that helper, with real-SDK integration tests; the independently precomputed fixed-signature bonus was skipped.                                                          |
| Why two unique keys?                            | Delivery identity prevents replay; order identity prevents a second delivery ID from creating a second order. Both include shop. A new delivery ID for an existing order records a receipt without changing the order.                                                                                       |
| What if storage fails or the process crashes?   | A crash before commit leaves no committed receipt/order pair. Failure returns 503 when a response is possible. If commit succeeds but the response is lost, a repeat delivery finds the existing receipt and returns 200.                                                                                    |
| Is a valid signature enough to accept an order? | No. Topic, delivery ID, payload, and installation must also pass. Unknown/uninstalled shops are logged no-ops; we do not create installations from deliveries.                                                                                                                                               |
| Can another shop be selected through the URL?   | No. The dashboard loader uses the authenticated session's shop. Storage keys and queries are shop-scoped; two-shop tests cover this.                                                                                                                                                                         |
| What if uninstall races with an order?          | Both operations are transactional. With the current SQLite implementation, an earlier order is deleted by cleanup; a later order sees no installation. Conflicts remain retryable. Tests exercise both directions with separate connections. PostgreSQL/queued workers need an explicit equivalent strategy. |
| What happens after reinstall?                   | Authentication creates a fresh session; the dashboard starts empty because there is no backfill. A delayed event from an earlier installation could be accepted after reinstall: there is no installation-generation boundary today.                                                                         |
| Why decimal strings and string IDs?             | JavaScript numbers and SQLite REAL cannot represent every required decimal or large integer exactly. Big.js handles arithmetic; currency totals stay separate. A validated Shopify Order GID preserves digits lost by parsing a large numeric ID; unsafe numeric-only IDs are rejected.                      |
| Does COD mean unpaid?                           | No. Any gateway containing `cash` qualifies even if paid. Exact `manual` requires pending status. Missing gateways are non-COD. The broad substring rule follows the brief and can classify other cash-named gateways; it is not a universal payment taxonomy.                                               |
| Are metrics current revenue?                    | No. They represent received creation events. Later payment changes, cancellations, refunds, and historical orders are not synchronized.                                                                                                                                                                      |
| What is the first scaling bottleneck?           | SQLite write contention and the dashboard reading all orders for a shop. Measure burst ingestion, lock waits, queue age, and dashboard latency before setting production capacity targets.                                                                                                                   |
| Why keep work inside the webhook?               | The current work is a short local transaction with no network calls, acknowledged after commit. Production bursts justify durable acceptance plus workers, while preserving retry and idempotency semantics.                                                                                                 |

## Submission handoff

Submit the repository link above. The README contains only the brief's six requested topics; these notes support the presentation, and the plan holds detailed verification evidence. Review the final commit and remote branch before sending. The task PDF, private credentials, databases, and local IDE files do not belong in the submission.
