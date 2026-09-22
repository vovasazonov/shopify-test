import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  if (topic !== "ORDERS_CREATE") {
    return new Response("Unexpected webhook topic", { status: 400 });
  }

  console.warn("Order processing is not implemented", { shop, topic });

  // A3 will persist orders before acknowledging delivery. Keep retries possible
  // while this setup-only endpoint cannot safely accept an order.
  return new Response("Order processing is not available yet", { status: 503 });
};
