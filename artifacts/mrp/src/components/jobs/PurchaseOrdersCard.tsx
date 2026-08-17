import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListJobPurchaseOrders,
  getListJobPurchaseOrdersQueryKey,
  useCreatePurchaseOrder,
  getListPurchaseOrdersQueryKey,
  useGetJobBom,
  getGetJobBomQueryKey,
  useListVendors,
  getListVendorsQueryKey,
  useListQualityClauses,
  getListQualityClausesQueryKey,
  useGetJobStockMatches,
  getGetJobStockMatchesQueryKey,
  useCommitInventoryItem,
  getListInventoryItemsQueryKey,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { FileSpreadsheet, Plus, AlertTriangle, PackageCheck, Bookmark } from "lucide-react";
import { poStatusBadge } from "@/components/purchasing/status";
import {
  vendorStatusLabel,
  vendorNeedsException,
  apiErrorMessage,
} from "@/components/purchasing/vendorStatus";
import PoPricingLinesEditor, {
  type EditablePricingLine,
  emptyPricingLine,
  toPricingLineInputs,
  ClauseMultiSelect,
} from "@/components/purchasing/PoPricingLinesEditor";
import { formatFeetInches } from "@/lib/units";

export default function PurchaseOrdersCard({ jobId }: { jobId: number }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [committingItemId, setCommittingItemId] = useState<number | null>(null);
  const [lines, setLines] = useState<EditablePricingLine[]>([]);
  const [vendorId, setVendorId] = useState<string>("");
  const [justification, setJustification] = useState("");
  const [poClauseIds, setPoClauseIds] = useState<number[]>([]);

  const { data: pos } = useListJobPurchaseOrders(jobId, {
    query: { enabled: !!jobId, queryKey: getListJobPurchaseOrdersQueryKey(jobId) },
  });
  const { data: bom } = useGetJobBom(jobId, {
    query: { enabled: !!jobId, queryKey: getGetJobBomQueryKey(jobId) },
  });
  const { data: vendors } = useListVendors(undefined, {
    query: { queryKey: getListVendorsQueryKey() },
  });
  const { data: clauses } = useListQualityClauses({
    query: { queryKey: getListQualityClausesQueryKey() },
  });
  // In-stock check: surface matching on-hand material before defaulting to a new PO.
  const { data: stockMatches } = useGetJobStockMatches(jobId, {
    query: { enabled: !!jobId && open, queryKey: getGetJobStockMatchesQueryKey(jobId) },
  });

  const selectedVendor = vendors?.find((v) => String(v.id) === vendorId);
  const needsException = vendorNeedsException(selectedVendor?.status);

  const commitItem = useCommitInventoryItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Item reserved for this job" });
        setCommittingItemId(null);
        queryClient.invalidateQueries({ queryKey: getGetJobStockMatchesQueryKey(jobId) });
        queryClient.invalidateQueries({ queryKey: getListInventoryItemsQueryKey() });
      },
      onError: (err: unknown) =>
        toast({
          title: "Could not reserve item",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        }),
    },
  });

  const createPo = useCreatePurchaseOrder({
    mutation: {
      onSuccess: (po) => {
        toast({ title: `Purchase order ${po.poNumber} created` });
        queryClient.invalidateQueries({ queryKey: getListJobPurchaseOrdersQueryKey(jobId) });
        queryClient.invalidateQueries({ queryKey: getListPurchaseOrdersQueryKey() });
        setOpen(false);
        setLocation(`/purchasing/${po.id}`);
      },
      onError: (err) =>
        toast({
          title: "Could not create purchase order",
          description: apiErrorMessage(err, "Please try again."),
          variant: "destructive",
        }),
    },
  });

  const openDialog = () => {
    const totals = bom?.totals ?? [];
    setLines(
      totals.map((t) => ({
        ...emptyPricingLine(),
        profileType: t.profileType ?? "",
        profileSize: t.profileSize ?? "",
        grade: t.grade ?? "",
        pieces: String(t.pieces),
        length: t.totalLengthIn != null ? formatFeetInches(t.totalLengthIn) : "",
      })),
    );
    setVendorId("");
    setJustification("");
    setPoClauseIds([]);
    setOpen(true);
  };

  const handleCreate = () => {
    if (!vendorId) return;
    createPo.mutate({
      jobId,
      data: {
        vendorId: Number(vendorId),
        vendorExceptionJustification: needsException
          ? justification.trim() || null
          : null,
        qualityClauseIds: poClauseIds,
        lines: toPricingLineInputs(lines),
      },
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row justify-between items-center">
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5" /> Purchase Orders
        </CardTitle>
        <Button variant="outline" size="sm" className="gap-2" onClick={openDialog} data-testid="button-new-po">
          <Plus className="w-4 h-4" /> New Purchase Order
        </Button>
      </CardHeader>
      <CardContent>
        {pos && pos.length > 0 ? (
          <div className="space-y-2">
            {pos.map((po) => (
              <div
                key={po.id}
                className="flex items-center justify-between border rounded-md px-3 py-2 cursor-pointer hover:bg-muted/50"
                onClick={() => setLocation(`/purchasing/${po.id}`)}
                data-testid={`po-row-${po.id}`}
              >
                <div>
                  <div className="font-medium">{po.poNumber}</div>
                  <div className="text-xs text-muted-foreground">
                    {po.vendorName ? `${po.vendorName} · ` : ""}
                    {po.lineCount} lines, {po.totalPieces} pieces
                  </div>
                </div>
                {poStatusBadge(po.status)}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No purchase orders yet. Create one to send a material recap to the PM for review.
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Purchase Order</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Vendor</Label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger data-testid="select-po-vendor">
                  <SelectValue placeholder="Select a vendor..." />
                </SelectTrigger>
                <SelectContent>
                  {(vendors ?? []).map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>
                      {v.name} ({vendorStatusLabel(v.status).toLowerCase()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {needsException && (
              <div className="space-y-2 border border-amber-500 bg-amber-50 dark:bg-amber-950/30 rounded-md p-3">
                <Label className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="w-4 h-4" />
                  Exception justification (required)
                </Label>
                <p className="text-xs text-muted-foreground">
                  {selectedVendor?.name} is {vendorStatusLabel(selectedVendor!.status).toLowerCase()}.
                  Purchasing from a non-approved vendor requires a written
                  justification.
                </p>
                <Textarea
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder="Why is this non-approved vendor being used?"
                  data-testid="input-po-exception"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>PO-level quality clauses</Label>
              <ClauseMultiSelect
                clauses={clauses ?? []}
                selected={poClauseIds}
                onChange={setPoClauseIds}
              />
            </div>

            {stockMatches && stockMatches.some((m) => m.availablePieces > 0) && (
              <div className="space-y-2 border border-green-600 bg-green-50 dark:bg-green-950/30 rounded-md p-3" data-testid="stock-match-panel">
                <Label className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <PackageCheck className="w-4 h-4" /> Matching material already in stock
                </Label>
                <p className="text-xs text-muted-foreground">
                  Consider consuming on-hand stock (Inventory page) before buying new material.
                </p>
                <div className="space-y-1">
                  {stockMatches
                    .filter((m) => m.availablePieces > 0)
                    .map((m, i) => (
                      <div key={i} className="text-sm space-y-1" data-testid={`stock-match-${i}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">
                            {[m.profileType, m.profileSize, m.grade].filter(Boolean).join(" ")}
                          </span>
                          <span className="text-muted-foreground">
                            need {m.neededPieces} pc — {m.availablePieces} pc available
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {m.items.slice(0, 3).map((it) => (
                            <div key={it.id} className="flex items-center gap-1">
                              <Badge variant="secondary">
                                {it.quantity} pc{it.lengthIn != null ? ` · ${formatFeetInches(it.lengthIn)}` : ""}
                                {it.heatNumber ? ` · heat ${it.heatNumber}` : ""}
                                {it.isRemnant ? " · remnant" : ""}
                                {it.sourceJobNumber ? ` · job ${it.sourceJobNumber}` : ""}
                              </Badge>
                              {it.status === "available" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs text-green-700 dark:text-green-400"
                                  onClick={() => {
                                    setCommittingItemId(it.id);
                                    commitItem.mutate({ itemId: it.id, data: { jobId } });
                                  }}
                                  disabled={commitItem.isPending && committingItemId === it.id}
                                  data-testid={`button-commit-stock-${it.id}`}
                                >
                                  <Bookmark className="w-3 h-3 mr-1" />
                                  {commitItem.isPending && committingItemId === it.id ? "Reserving…" : "Reserve"}
                                </Button>
                              )}
                              {it.status === "committed" && (
                                <Badge variant="outline" className="text-xs text-amber-600 dark:text-amber-400 border-amber-400">
                                  Reserved
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Material lines</Label>
              <p className="text-sm text-muted-foreground">
                {bom && bom.totals.length > 0
                  ? "Lines are prefilled from the job's bill of materials. Adjust them before saving."
                  : "This job has no imported bill of materials. Add material lines manually."}
              </p>
              <PoPricingLinesEditor
                lines={lines}
                onChange={setLines}
                clauses={clauses ?? []}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={
                createPo.isPending ||
                !vendorId ||
                lines.length === 0 ||
                (needsException && !justification.trim())
              }
              data-testid="button-po-create"
            >
              {createPo.isPending ? "Creating..." : "Create draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
