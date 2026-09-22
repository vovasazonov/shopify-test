import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getDashboardForShop } from "../services/dashboard.server";
import { OrderDashboard } from "../components/order-dashboard";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Authentication responses must reach Shopify's boundary unchanged.
  const { session } = await authenticate.admin(request);
  try {
    return data({ dashboard: await getDashboardForShop(session.shop) });
  } catch {
    console.error("Dashboard load failed", { shop: session.shop });
    return data({ dashboard: null }, { status: 503 });
  }
};

export default function Index() {
  const { dashboard } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  return (
    <OrderDashboard
      dashboard={dashboard}
      refreshing={revalidator.state !== "idle"}
      onRefresh={() => {
        void revalidator.revalidate();
      }}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
