import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import {
  handleWebhook,
  InvalidWebhookPayloadError,
} from "../lib/webhook.server";

export const action = async ({ request }: ActionFunctionArgs) =>
  handleWebhook(
    request,
    {
      topic: "APP_SCOPES_UPDATE",
      label: "Scopes webhook",
      failureOutcome: "storage_failed",
      failureMessage: "Scope update temporarily unavailable",
    },
    async ({ payload, session, shop }) => {
      const current: unknown = payload?.current;
      if (
        !Array.isArray(current) ||
        current.some(
          (scope) =>
            typeof scope !== "string" ||
            !scope ||
            scope !== scope.trim() ||
            scope.includes(","),
        )
      ) {
        throw new InvalidWebhookPayloadError(
          "current must be an array of nonempty scope names",
          "Invalid scope update payload",
        );
      }
      if (!session) return { outcome: "uninstalled" };

      // A concurrent uninstall can remove the authenticated session. updateMany
      // becomes a harmless no-op and can never recreate it or touch another shop.
      const { count } = await db.session.updateMany({
        where: { id: session.id, shop, isOnline: false },
        data: { scope: current.join(",") },
      });
      return {
        outcome: count ? "updated" : "uninstalled",
        details: { sessionsUpdated: count },
      };
    },
  );
