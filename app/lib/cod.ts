export function isCodOrder(
  gatewayNames: readonly string[] | null | undefined,
  financialStatus: string | null | undefined,
): boolean {
  return (gatewayNames ?? []).some((gatewayName) => {
    const gateway = gatewayName.trim().toLowerCase();

    return (
      gateway.includes("cash") ||
      (financialStatus === "pending" && gateway === "manual")
    );
  });
}
