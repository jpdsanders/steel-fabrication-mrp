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
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { FileSpreadsheet, Plus } from "lucide-react";
import PoLinesEditor, {
  type EditableLine,
  toLineInputs,
} from "@/components/purchasing/PoLinesEditor";
import { poStatusBadge } from "@/components/purchasing/status";
import { formatFeetInches } from "@/lib/units";

export default function PurchaseOrdersCard({ jobId }: { jobId: number }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<EditableLine[]>([]);

  const { data: pos } = useListJobPurchaseOrders(jobId, {
    query: { enabled: !!jobId, queryKey: getListJobPurchaseOrdersQueryKey(jobId) },
  });
  const { data: bom } = useGetJobBom(jobId, {
    query: { enabled: !!jobId, queryKey: getGetJobBomQueryKey(jobId) },
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
      onError: () =>
        toast({ title: "Could not create purchase order", variant: "destructive" }),
    },
  });

  const openDialog = () => {
    const totals = bom?.totals ?? [];
    setLines(
      totals.map((t) => ({
        profileType: t.profileType ?? "",
        profileSize: t.profileSize ?? "",
        grade: t.grade ?? "",
        pieces: String(t.pieces),
        length: t.totalLengthIn != null ? formatFeetInches(t.totalLengthIn) : "",
      })),
    );
    setOpen(true);
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
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Purchase Order</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {bom && bom.totals.length > 0
              ? "Lines are prefilled from the job's bill of materials. Adjust them before saving."
              : "This job has no imported bill of materials. Add material lines manually."}
          </p>
          <PoLinesEditor lines={lines} onChange={setLines} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createPo.mutate({ jobId, data: { lines: toLineInputs(lines) } })}
              disabled={createPo.isPending || lines.length === 0}
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
