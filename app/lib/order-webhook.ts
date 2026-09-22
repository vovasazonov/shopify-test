import type { ReceivedOrder } from "../services/orders.server";
import { normalizeAmount, validateCurrency } from "./money";

export class InvalidOrderPayloadError extends Error {
  constructor(field: string, requirement: string) {
    super(`${field} ${requirement}`);
    this.name = "InvalidOrderPayloadError";
  }
}

function parseOrderId(value: unknown, graphqlId: unknown): string {
  if (graphqlId != null) {
    const match =
      typeof graphqlId === "string" && graphqlId === graphqlId.trim()
        ? /^gid:\/\/shopify\/Order\/([1-9]\d*)$/.exec(graphqlId)
        : null;
    if (!match) {
      throw new InvalidOrderPayloadError(
        "admin_graphql_api_id",
        "must be an Order global ID when supplied",
      );
    }
    const exactId = match[1];
    // The SDK parses JSON numbers before returning the authenticated payload.
    // Shopify's string GID preserves digits that a large numeric id can lose.
    // Compare the numeric representation only for consistency; never store it.
    if (
      (typeof value === "number" &&
        Number.isInteger(value) &&
        value > 0 &&
        Number(exactId) === value) ||
      value === exactId
    ) {
      return exactId;
    }
    throw new InvalidOrderPayloadError("id", "must match admin_graphql_api_id");
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (
    typeof value === "string" &&
    value === value.trim() &&
    /^[1-9]\d*$/.test(value)
  ) {
    return value;
  }
  throw new InvalidOrderPayloadError(
    "id",
    "must be a positive safe integer or a positive integer string",
  );
}

function parseName(value: unknown): string {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new InvalidOrderPayloadError(
      "name",
      "must be a nonempty string without outer whitespace",
    );
  }
  return value;
}

function parseTotal(value: unknown): string {
  if (typeof value === "string") {
    try {
      return normalizeAmount(value);
    } catch {
      // Report only the field requirement, never payload values.
    }
  }
  throw new InvalidOrderPayloadError(
    "total_price",
    "must be a nonnegative plain decimal string",
  );
}

function parseCurrency(value: unknown): string {
  if (typeof value === "string") {
    try {
      return validateCurrency(value);
    } catch {
      // Report only the field requirement, never payload values.
    }
  }
  throw new InvalidOrderPayloadError(
    "currency",
    "must be a three-letter uppercase code",
  );
}

function parseCreatedAt(value: unknown): Date {
  const invalid = () =>
    new InvalidOrderPayloadError(
      "created_at",
      "must be a valid ISO timestamp with a timezone",
    );
  if (typeof value !== "string" || value !== value.trim()) throw invalid();

  const timestamp =
    /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
  const match = timestamp.exec(value);
  if (!match) throw invalid();

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  // Date parsing alone normalizes impossible dates such as February 30.
  if (day > daysInMonth[month - 1]) throw invalid();

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw invalid();
  return date;
}

function parseGateways(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((name) => typeof name !== "string")) {
    throw new InvalidOrderPayloadError(
      "payment_gateway_names",
      "must be an array of strings when supplied",
    );
  }
  return value;
}

function parseFinancialStatus(value: unknown): string | null | undefined {
  if (value == null || typeof value === "string") return value;
  throw new InvalidOrderPayloadError(
    "financial_status",
    "must be a string when supplied",
  );
}

export function parseOrderWebhook(payload: unknown): ReceivedOrder {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new InvalidOrderPayloadError("payload", "must be an object");
  }
  const order = payload as Record<string, unknown>;
  return {
    orderId: parseOrderId(order.id, order.admin_graphql_api_id),
    name: parseName(order.name),
    total: parseTotal(order.total_price),
    currency: parseCurrency(order.currency),
    createdAt: parseCreatedAt(order.created_at),
    gatewayNames: parseGateways(order.payment_gateway_names),
    financialStatus: parseFinancialStatus(order.financial_status),
  };
}
