import type { PrismaClient } from "@prisma/client";
import db from "../db.server";

export async function deleteShopData(shop: string, client: PrismaClient = db) {
  if (typeof shop !== "string" || !shop || shop !== shop.trim()) {
    throw new TypeError(
      "shop must be a nonempty string without outer whitespace",
    );
  }

  // SQLite serializes successful write transactions. An order either finishes
  // before this cleanup (and is deleted), or checks installation after it (and
  // does nothing). Conflicts propagate for retry. Keep all deletions in one commit.
  return client.$transaction(async (tx) => {
    const sessions = await tx.session.deleteMany({ where: { shop } });
    const orders = await tx.order.deleteMany({ where: { shop } });
    const receipts = await tx.webhookReceipt.deleteMany({ where: { shop } });
    return {
      sessionsDeleted: sessions.count,
      ordersDeleted: orders.count,
      receiptsDeleted: receipts.count,
    };
  });
}
