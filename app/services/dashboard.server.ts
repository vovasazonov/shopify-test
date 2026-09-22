import type { PrismaClient } from "@prisma/client";
import { sumAmountsByCurrency } from "../lib/money";
import { getOrdersForShop } from "./orders.server";

export async function getDashboardForShop(shop: string, client?: PrismaClient) {
  // One shop-scoped snapshot keeps metrics and rows consistent. For this small
  // app, sum decimal text in JavaScript rather than SQLite's approximate SUM.
  const orders = await getOrdersForShop(shop, client);
  const totalOrders = orders.length;
  const codOrders = orders.filter((order) => order.isCod).length;

  return {
    totalOrders,
    codOrders,
    codShare: totalOrders === 0 ? 0 : (codOrders / totalOrders) * 100,
    totals: sumAmountsByCurrency(orders),
    latestOrders: orders.slice(0, 20).map((order) => ({
      orderId: order.orderId,
      name: order.name,
      total: order.total,
      currency: order.currency,
      createdAt: order.createdAt.toISOString(),
      gatewayNames: Array.isArray(order.gatewayNames)
        ? order.gatewayNames.filter(
            (name): name is string => typeof name === "string",
          )
        : [],
      isCod: order.isCod,
    })),
  };
}

export type OrderDashboardData = Awaited<
  ReturnType<typeof getDashboardForShop>
>;
