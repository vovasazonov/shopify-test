import { normalizeAmount, validateCurrency } from "./money";

export function formatOrderMoney(total: string, currency: string): string {
  validateCurrency(currency);
  const [integer, fraction = ""] = normalizeAmount(total).split(".");
  const currencyDigits =
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).resolvedOptions().minimumFractionDigits ?? 0;
  // Format the integer as BigInt, never a floating-point number. Keep any
  // additional stored decimal places instead of silently rounding them away.
  const grouped = new Intl.NumberFormat("en-US").format(BigInt(integer));
  const decimals = fraction.padEnd(currencyDigits, "0");
  return `${currency} ${grouped}${decimals ? `.${decimals}` : ""}`;
}

export function formatOrderDate(createdAt: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(createdAt));
}

export function formatCodShare(share: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(share)}%`;
}
