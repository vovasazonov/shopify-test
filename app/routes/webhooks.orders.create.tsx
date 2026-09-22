import type { ActionFunctionArgs } from "react-router";
import {
  InvalidOrderPayloadError,
  parseOrderWebhook,
} from "../lib/order-webhook";
import {
  handleWebhook,
  InvalidWebhookPayloadError,
} from "../lib/webhook.server";
import { saveReceivedOrder } from "../services/orders.server";

export const action = async ({ request }: ActionFunctionArgs) =>
  handleWebhook(
    request,
    {
      topic: "ORDERS_CREATE",
      label: "Order webhook",
      failureOutcome: "storage_failed",
      failureMessage: "Order storage temporarily unavailable",
    },
    async ({ shop, webhookId, payload }) => {
      let order;
      try {
        order = parseOrderWebhook(payload);
      } catch (error) {
        if (!(error instanceof InvalidOrderPayloadError)) throw error;
        throw new InvalidWebhookPayloadError(
          error.message,
          "Invalid order payload",
        );
      }
      // Installation and receipt/order writes share one database transaction.
      return { outcome: await saveReceivedOrder(shop, webhookId, order) };
    },
  );
