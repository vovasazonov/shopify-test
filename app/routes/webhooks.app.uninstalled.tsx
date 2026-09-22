import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteShopData } from "../services/uninstall.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const startedAt = performance.now();
  const context = {
    shop: request.headers.get("X-Shopify-Shop-Domain"),
    topic: request.headers.get("X-Shopify-Topic"),
    webhookId: request.headers.get("X-Shopify-Webhook-Id"),
    verified: false,
  };
  try {
    // A missing session is expected on repeat uninstall deliveries. The SDK
    // still verifies the raw-body HMAC; cleanup never depends on session presence.
    const { shop, topic, webhookId } = await authenticate.webhook(request);
    Object.assign(context, { shop, topic, webhookId, verified: true });
    if (topic !== "APP_UNINSTALLED") {
      console.warn("Uninstall webhook", {
        ...context,
        outcome: "wrong_topic",
        status: 400,
      });
      return new Response("Unexpected webhook topic", { status: 400 });
    }

    const deleted = await deleteShopData(shop);
    console.info("Uninstall webhook", {
      ...context,
      outcome: "cleaned_up",
      status: 200,
      ...deleted,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    });
    return new Response(null, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      console.warn("Uninstall webhook", {
        ...context,
        outcome: "authentication_rejected",
        status: error.status,
      });
      throw error;
    }
    if (error instanceof SyntaxError) {
      // JSON parser messages can include payload fragments; never log them.
      console.warn("Uninstall webhook", {
        ...context,
        outcome: "invalid_json",
        status: 400,
      });
      return new Response("Invalid JSON payload", { status: 400 });
    }
    console.error("Uninstall webhook", {
      ...context,
      outcome: context.verified ? "cleanup_failed" : "authentication_failed",
      status: 503,
    });
    return new Response("Uninstall cleanup temporarily unavailable", {
      status: 503,
    });
  }
};
