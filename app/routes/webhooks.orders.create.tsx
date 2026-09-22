import type { ActionFunctionArgs } from "react-router";
import {
  InvalidOrderPayloadError,
  parseOrderWebhook,
} from "../lib/order-webhook";
import { saveReceivedOrder } from "../services/orders.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const startedAt = performance.now();
  const context = {
    shop: request.headers.get("X-Shopify-Shop-Domain"),
    topic: request.headers.get("X-Shopify-Topic"),
    webhookId: request.headers.get("X-Shopify-Webhook-Id"),
    verified: false,
  };
  const log = (
    outcome: string,
    status: number,
    details: Record<string, unknown> = {},
  ) => {
    const entry = {
      ...context,
      outcome,
      status,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      ...details,
    };
    if (status >= 500) console.error("Order webhook", entry);
    else if (status >= 400) console.warn("Order webhook", entry);
    else console.info("Order webhook", entry);
  };

  let delivery;
  try {
    // Pass the untouched request: the SDK verifies the raw body before parsing.
    delivery = await authenticate.webhook(request);
  } catch (error) {
    if (error instanceof Response) {
      log("authentication_rejected", error.status);
      throw error;
    }
    if (error instanceof SyntaxError) {
      // JSON.parse messages can include customer payload fragments. Never log
      // the message or the body, including on this authenticated malformed JSON.
      log("invalid_json", 400);
      return new Response("Invalid JSON payload", { status: 400 });
    }
    log("authentication_failed", 503, storageErrorContext(error));
    return new Response("Webhook temporarily unavailable", { status: 503 });
  }

  const { shop, topic, webhookId, payload } = delivery;
  Object.assign(context, { shop, topic, webhookId, verified: true });
  if (topic !== "ORDERS_CREATE") {
    log("wrong_topic", 400);
    return new Response("Unexpected webhook topic", { status: 400 });
  }
  const deliveryId = request.headers.get("X-Shopify-Webhook-Id");
  if (
    !deliveryId ||
    deliveryId !== deliveryId.trim() ||
    deliveryId !== webhookId
  ) {
    log("invalid_delivery_id", 400);
    return new Response("Missing or invalid webhook ID", { status: 400 });
  }

  let order;
  try {
    order = parseOrderWebhook(payload);
  } catch (error) {
    if (!(error instanceof InvalidOrderPayloadError)) throw error;
    log("invalid_payload", 400, { reason: error.message });
    return new Response("Invalid order payload", { status: 400 });
  }

  try {
    // The service checks installation and atomically commits receipt + order.
    // No API calls or unawaited work may occur before acknowledging the delivery.
    const outcome = await saveReceivedOrder(shop, deliveryId, order);
    log(outcome, 200);
    return new Response(null, { status: 200 });
  } catch (error) {
    log("storage_failed", 503, storageErrorContext(error));
    return new Response("Order storage temporarily unavailable", {
      status: 503,
    });
  }
};

function storageErrorContext(error: unknown): Record<string, string> {
  // Prisma messages can contain queries and values. Log only a stable error
  // category/code; the delivery identifiers above are enough to correlate it.
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^P\d{4}$/.test(error.code)
  ) {
    return { errorType: "PrismaError", errorCode: error.code };
  }
  return { errorType: "StorageOrInternalError" };
}
