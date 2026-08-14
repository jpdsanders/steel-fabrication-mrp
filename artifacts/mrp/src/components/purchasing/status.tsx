import { Badge } from "@/components/ui/badge";
import type { PurchaseOrderStatus } from "@workspace/api-client-react";

const LABELS: Record<PurchaseOrderStatus, string> = {
  draft: "Draft",
  sent: "Sent for review",
  approved: "Approved",
  rejected: "Rejected",
};

export function poStatusLabel(status: PurchaseOrderStatus): string {
  return LABELS[status] ?? status;
}

export function poStatusBadge(status: PurchaseOrderStatus) {
  const variant =
    status === "approved"
      ? "default"
      : status === "rejected"
        ? "destructive"
        : status === "sent"
          ? "secondary"
          : "outline";
  return (
    <Badge variant={variant} data-testid={`po-status-${status}`}>
      {poStatusLabel(status)}
    </Badge>
  );
}
