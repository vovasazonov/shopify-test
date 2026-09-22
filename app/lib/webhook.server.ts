import { authenticate } from "../shopify.server";

type WebhookDelivery = Awaited<ReturnType<typeof authenticate.webhook>>;

interface WebhookOptions {
  topic: string;
  label: string;
  failureOutcome: string;
  failureMessage: string;
}

interface WebhookResult {
  outcome: string;
  details?: Record<string, number | string>;
}

export class InvalidWebhookPayloadError extends Error {
  constructor(
    requirement: string,
    readonly responseMessage = "Invalid webhook payload",
  ) {
    super(requirement);
    this.name = "InvalidWebhookPayloadError";
  }
}

export async function handleWebhook(
  request: Request,
  options: WebhookOptions,
  processDelivery: (delivery: WebhookDelivery) => Promise<WebhookResult>,
): Promise<Response> {
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
    if (status >= 500) console.error(options.label, entry);
    else if (status >= 400) console.warn(options.label, entry);
    else console.info(options.label, entry);
  };

  let delivery: WebhookDelivery;
  try {
    // The SDK verifies the untouched raw body before parsing. Authentication
    // remains valid without a session, including repeated uninstall deliveries.
    delivery = await authenticate.webhook(request);
  } catch (error) {
    if (error instanceof Response) {
      log("authentication_rejected", error.status);
      throw error;
    }
    if (error instanceof SyntaxError) {
      // JSON parser messages can include customer payload fragments.
      log("invalid_json", 400);
      return new Response("Invalid JSON payload", { status: 400 });
    }
    log("authentication_failed", 503, safeErrorContext(error));
    return new Response("Webhook temporarily unavailable", { status: 503 });
  }

  const { shop, topic, webhookId } = delivery;
  Object.assign(context, { shop, topic, webhookId, verified: true });
  if (topic !== options.topic) {
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

  try {
    // Acknowledge only after the local write finishes; callbacks must not start
    // external API requests or unfinished background work.
    const { outcome, details } = await processDelivery(delivery);
    log(outcome, 200, details);
    return new Response(null, { status: 200 });
  } catch (error) {
    if (error instanceof InvalidWebhookPayloadError) {
      log("invalid_payload", 400, { reason: error.message });
      return new Response(error.responseMessage, { status: 400 });
    }
    log(options.failureOutcome, 503, safeErrorContext(error));
    return new Response(options.failureMessage, { status: 503 });
  }
}

function safeErrorContext(error: unknown): Record<string, string> {
  // Prisma messages can contain queries and values. Log only a stable category
  // or code; delivery identifiers provide correlation without disclosing data.
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
