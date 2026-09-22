import type { ActionFunctionArgs } from "react-router";
import { handleWebhook } from "../lib/webhook.server";
import { deleteShopData } from "../services/uninstall.server";

export const action = async ({ request }: ActionFunctionArgs) =>
  handleWebhook(
    request,
    {
      topic: "APP_UNINSTALLED",
      label: "Uninstall webhook",
      failureOutcome: "cleanup_failed",
      failureMessage: "Uninstall cleanup temporarily unavailable",
    },
    async ({ shop }) => ({
      outcome: "cleaned_up",
      // Cleanup also handles repeated notifications after the session is gone.
      details: await deleteShopData(shop),
    }),
  );
