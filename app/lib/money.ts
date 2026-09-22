import BigDecimal from "big.js";

export function normalizeAmount(amount: string): string {
  if (
    typeof amount !== "string" ||
    amount.trim() !== amount ||
    !/^\d+(?:\.\d+)?$/.test(amount)
  ) {
    throw new Error("Amount must be a nonnegative plain decimal string");
  }

  return new BigDecimal(amount).toFixed();
}

export function validateCurrency(currency: string): string {
  if (
    typeof currency !== "string" ||
    currency.length !== 3 ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    throw new Error("Currency must be a three-letter uppercase code");
  }

  return currency;
}

export function sumAmountsByCurrency(
  orders: readonly { total: string; currency: string }[],
): Array<{ currency: string; total: string }> {
  const totals = new Map<string, BigDecimal>();

  for (const order of orders) {
    const currency = validateCurrency(order.currency);
    const amount = normalizeAmount(order.total);
    totals.set(currency, (totals.get(currency) ?? new BigDecimal("0")).plus(amount));
  }

  return [...totals]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, total]) => ({ currency, total: total.toFixed() }));
}
