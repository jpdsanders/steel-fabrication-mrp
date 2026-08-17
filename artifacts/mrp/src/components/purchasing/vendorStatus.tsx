import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { VendorStatus } from "@workspace/api-client-react";
import type { DueInLineDueStatus } from "@workspace/api-client-react";

const VENDOR_LABELS: Record<VendorStatus, string> = {
  approved: "Approved",
  conditional: "Conditional",
  suspended: "Suspended",
  disqualified: "Disqualified",
};

const VENDOR_CLASSES: Record<VendorStatus, string> = {
  approved: "bg-green-600 hover:bg-green-600 text-white border-transparent",
  conditional: "bg-amber-500 hover:bg-amber-500 text-white border-transparent",
  suspended: "bg-orange-600 hover:bg-orange-600 text-white border-transparent",
  disqualified: "bg-red-600 hover:bg-red-600 text-white border-transparent",
};

export function vendorStatusLabel(status: string): string {
  return VENDOR_LABELS[status as VendorStatus] ?? status;
}

export function vendorStatusBadge(status: string | null | undefined) {
  if (!status) return null;
  const cls = VENDOR_CLASSES[status as VendorStatus];
  return (
    <Badge
      className={cn(cls)}
      variant={cls ? undefined : "outline"}
      data-testid={`vendor-status-${status}`}
    >
      {vendorStatusLabel(status)}
    </Badge>
  );
}

/** True when the vendor requires a purchase exception justification. */
export function vendorNeedsException(status: string | null | undefined): boolean {
  return status === "suspended" || status === "disqualified";
}

const DUE_LABELS: Record<DueInLineDueStatus, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  ok: "OK",
  no_date: "No promise date",
};

const DUE_CLASSES: Record<DueInLineDueStatus, string> = {
  overdue: "bg-red-600 hover:bg-red-600 text-white border-transparent",
  due_soon: "bg-amber-500 hover:bg-amber-500 text-white border-transparent",
  ok: "bg-green-600 hover:bg-green-600 text-white border-transparent",
  no_date: "bg-muted text-muted-foreground border-transparent",
};

export function dueStatusBadge(status: DueInLineDueStatus) {
  return (
    <Badge className={cn(DUE_CLASSES[status])} data-testid={`due-status-${status}`}>
      {DUE_LABELS[status]}
    </Badge>
  );
}

/** Extracts a server `{ error }` message from a mutation error, if present. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const msg = (err as { data?: { error?: string } })?.data?.error;
  return typeof msg === "string" && msg.trim() ? msg : fallback;
}

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
  return CURRENCY.format(value);
}
