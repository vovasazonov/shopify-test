import type { OrderDashboardData } from "../services/dashboard.server";
import {
  formatCodShare,
  formatOrderDate,
  formatOrderMoney,
} from "../lib/order-display";

interface Props {
  dashboard: OrderDashboardData | null;
  refreshing: boolean;
  onRefresh: () => void;
}

export function OrderDashboard({ dashboard, refreshing, onRefresh }: Props) {
  return (
    <s-page heading="COD Order Watch">
      <s-button
        slot="primary-action"
        onClick={onRefresh}
        loading={refreshing}
        disabled={refreshing}
      >
        Refresh
      </s-button>
      {!dashboard ? (
        <s-banner heading="Orders couldn't be loaded" tone="critical">
          Your order data is temporarily unavailable. Try refreshing again.
        </s-banner>
      ) : (
        <s-stack gap="base">
          <s-paragraph>
            Orders received by this app. Refresh to see new orders.
          </s-paragraph>
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
            gap="base"
          >
            <s-section heading="Orders received">
              <s-heading>
                {dashboard.totalOrders.toLocaleString("en-US")}
              </s-heading>
            </s-section>
            <s-section heading="COD orders">
              <s-heading>
                {dashboard.codOrders.toLocaleString("en-US")}
              </s-heading>
            </s-section>
            <s-section heading="COD share">
              <s-heading>{formatCodShare(dashboard.codShare)}</s-heading>
            </s-section>
            <s-section heading="Total order value">
              <s-stack gap="small">
                {dashboard.totals.length === 0 ? (
                  <s-heading>0</s-heading>
                ) : (
                  dashboard.totals.map(({ currency, total }) => (
                    <s-heading key={currency}>
                      {formatOrderMoney(total, currency)}
                    </s-heading>
                  ))
                )}
                <s-text color="subdued">
                  Received order value, not collected COD revenue.
                </s-text>
              </s-stack>
            </s-section>
          </s-grid>
          {dashboard.totalOrders === 0 ? (
            <s-section heading="No orders received yet">
              <s-paragraph>
                Create an order in your store, then refresh this page. Orders
                placed before the app was installed are not imported.
              </s-paragraph>
            </s-section>
          ) : (
            <s-section heading="Latest orders">
              <s-box paddingBlockEnd="base">
                <s-paragraph>
                  Showing {dashboard.latestOrders.length} of{" "}
                  {dashboard.totalOrders} received orders, newest first. Dates
                  are in UTC.
                </s-paragraph>
              </s-box>
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Order</s-table-header>
                  <s-table-header listSlot="secondary">
                    Date (UTC)
                  </s-table-header>
                  <s-table-header format="currency" listSlot="inline">
                    Total
                  </s-table-header>
                  <s-table-header>Gateway</s-table-header>
                  <s-table-header listSlot="inline">COD</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {dashboard.latestOrders.map((order) => (
                    <s-table-row key={order.orderId}>
                      <s-table-cell>{order.name}</s-table-cell>
                      <s-table-cell>
                        <time dateTime={order.createdAt}>
                          {formatOrderDate(order.createdAt)}
                        </time>
                      </s-table-cell>
                      <s-table-cell>
                        {formatOrderMoney(order.total, order.currency)}
                      </s-table-cell>
                      <s-table-cell>
                        {order.gatewayNames.join(", ") || "Not provided"}
                      </s-table-cell>
                      <s-table-cell>
                        <s-badge tone={order.isCod ? "success" : "neutral"}>
                          {order.isCod ? "Yes" : "No"}
                        </s-badge>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </s-section>
          )}
        </s-stack>
      )}
    </s-page>
  );
}
