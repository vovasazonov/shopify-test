import { Prisma, type PrismaClient } from "@prisma/client";
import db from "../db.server";
import { isCodOrder } from "../lib/cod";
import { normalizeAmount, validateCurrency } from "../lib/money";

export interface ReceivedOrder {
  orderId: string;
  name: string;
  total: string;
  currency: string;
  gatewayNames?: string[] | null;
  createdAt: Date;
  financialStatus?: string | null;
}

export type SaveOrderResult =
  "created" | "duplicate_delivery" | "duplicate_order" | "uninstalled";

function requireNonempty(value: string, field: string): void {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new TypeError(
      `${field} must be a nonempty string without outer whitespace`,
    );
  }
}

function orderData(shop: string, order: ReceivedOrder) {
  requireNonempty(order.orderId, "orderId");
  if (!/^[1-9]\d*$/.test(order.orderId)) {
    throw new TypeError("orderId must be a positive integer string");
  }
  requireNonempty(order.name, "name");
  if (
    !(order.createdAt instanceof Date) ||
    !Number.isFinite(order.createdAt.getTime())
  ) {
    throw new TypeError("createdAt must be a valid Date");
  }

  const gatewayNames = order.gatewayNames ?? [];
  if (
    !Array.isArray(gatewayNames) ||
    gatewayNames.some((name) => typeof name !== "string")
  ) {
    throw new TypeError("gatewayNames must contain only strings");
  }
  if (
    order.financialStatus != null &&
    typeof order.financialStatus !== "string"
  ) {
    throw new TypeError("financialStatus must be a string when supplied");
  }

  return {
    shop,
    orderId: order.orderId,
    name: order.name,
    total: normalizeAmount(order.total),
    currency: validateCurrency(order.currency),
    gatewayNames,
    createdAt: order.createdAt,
    isCod: isCodOrder(gatewayNames, order.financialStatus),
  };
}

// Call only after webhook authentication; A3 owns the HTTP/payload boundary.
export async function saveReceivedOrder(
  shop: string,
  webhookId: string,
  order: ReceivedOrder,
  client: PrismaClient = db,
): Promise<SaveOrderResult> {
  requireNonempty(shop, "shop");
  requireNonempty(webhookId, "webhookId");
  const data = orderData(shop, order);

  try {
    return await client.$transaction(async (tx): Promise<SaveOrderResult> => {
      // An expired access token still represents an installation. Only uninstall
      // removes the offline session; do not recreate it from an order delivery.
      const installation = await tx.session.findFirst({
        where: { shop, isOnline: false },
        select: { id: true },
      });
      if (!installation) return "uninstalled";

      await tx.webhookReceipt.create({ data: { shop, webhookId } });

      // The receipt insert has acquired SQLite's write lock. The unique key is
      // also enforced by the database, including when concurrent requests race.
      const existing = await tx.order.findUnique({
        where: { shop_orderId: { shop, orderId: data.orderId } },
        select: { orderId: true },
      });
      if (existing) return "duplicate_order";

      await tx.order.create({ data });
      return "created";
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      // The failed transaction has rolled back. Confirm this delivery already
      // exists instead of swallowing an unrelated uniqueness/storage failure.
      const receipt = await client.webhookReceipt.findUnique({
        where: { shop_webhookId: { shop, webhookId } },
        select: { webhookId: true },
      });
      if (receipt) return "duplicate_delivery";
    }
    throw error;
  }
}

export async function getOrdersForShop(
  shop: string,
  client: PrismaClient = db,
) {
  requireNonempty(shop, "shop");
  return client.order.findMany({
    where: { shop },
    orderBy: [{ createdAt: "desc" }, { orderId: "desc" }],
  });
}
