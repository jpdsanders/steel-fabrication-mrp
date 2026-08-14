import { useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPurchaseOrder,
  getGetPurchaseOrderQueryKey,
  useUpdatePurchaseOrder,
  useDeletePurchaseOrder,
  useUpdatePurchaseOrderStatus,
  getListPurchaseOrdersQueryKey,
  getListJobPurchaseOrdersQueryKey,
  type PurchaseOrderDetail as PoDetail,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft,
  Pencil,
  Printer,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import PoLinesEditor, {
  type EditableLine,
  toLineInputs,
} from "@/components/purchasing/PoLinesEditor";
import { poStatusBadge } from "@/components/purchasing/status";
import { formatFeetInches } from "@/lib/units";

type Line = PoDetail["lines"][number];

function groupLines(lines: Line[]) {
  const groups = new Map<string, Line[]>();
  for (const line of lines) {
    const key = line.profileType ?? "Other";
    const list = groups.get(key) ?? [];
    list.push(line);
    groups.set(key, list);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function RecapTable({ po }: { po: PoDetail }) {
  const groups = groupLines(po.lines);
  const grandPieces = po.lines.reduce((s, l) => s + l.pieces, 0);
  const grandLength = po.lines.reduce((s, l) => s + (l.lengthIn ?? 0), 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>Grade</TableHead>
          <TableHead className="text-right">Pieces</TableHead>
          <TableHead className="text-right">Total length</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map(([type, lines]) => {
          const groupPieces = lines.reduce((s, l) => s + l.pieces, 0);
          const groupLength = lines.reduce((s, l) => s + (l.lengthIn ?? 0), 0);
          return [
            ...lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>{line.profileType ?? "—"}</TableCell>
                <TableCell>{line.profileSize ?? "—"}</TableCell>
                <TableCell>{line.grade ?? "—"}</TableCell>
                <TableCell className="text-right">{line.pieces}</TableCell>
                <TableCell className="text-right">{formatFeetInches(line.lengthIn)}</TableCell>
              </TableRow>
            )),
            <TableRow key={`subtotal-${type}`} className="bg-muted/50 font-medium">
              <TableCell colSpan={3}>Subtotal {type}</TableCell>
              <TableCell className="text-right">{groupPieces}</TableCell>
              <TableCell className="text-right">{formatFeetInches(groupLength)}</TableCell>
            </TableRow>,
          ];
        })}
        <TableRow className="font-bold border-t-2">
          <TableCell colSpan={3}>Grand total</TableCell>
          <TableCell className="text-right">{grandPieces}</TableCell>
          <TableCell className="text-right">{formatFeetInches(grandLength)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

export default function PurchaseOrderDetail() {
  const [, params] = useRoute("/purchasing/:id");
  const [, setLocation] = useLocation();
  const poId = Number(params?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [editLines, setEditLines] = useState<EditableLine[]>([]);
  const [reviewAction, setReviewAction] = useState<"approved" | "rejected" | null>(null);
  const [comment, setComment] = useState("");

  const { data: po, isLoading } = useGetPurchaseOrder(poId, {
    query: { enabled: !!poId, queryKey: getGetPurchaseOrderQueryKey(poId) },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetPurchaseOrderQueryKey(poId) });
    queryClient.invalidateQueries({ queryKey: getListPurchaseOrdersQueryKey() });
    if (po) {
      queryClient.invalidateQueries({ queryKey: getListJobPurchaseOrdersQueryKey(po.jobId) });
    }
  };

  const updatePo = useUpdatePurchaseOrder({
    mutation: {
      onSuccess: () => {
        toast({ title: "Purchase order updated" });
        setEditing(false);
        invalidate();
      },
      onError: () =>
        toast({ title: "Could not update purchase order", variant: "destructive" }),
    },
  });

  const updateStatus = useUpdatePurchaseOrderStatus({
    mutation: {
      onSuccess: (updated) => {
        toast({
          title:
            updated.status === "sent"
              ? "Sent to PM for review"
              : updated.status === "approved"
                ? "Purchase order approved"
                : "Purchase order rejected",
        });
        setReviewAction(null);
        setComment("");
        invalidate();
      },
      onError: () =>
        toast({ title: "Status change not allowed", variant: "destructive" }),
    },
  });

  const deletePo = useDeletePurchaseOrder({
    mutation: {
      onSuccess: () => {
        toast({ title: "Purchase order deleted" });
        queryClient.invalidateQueries({ queryKey: getListPurchaseOrdersQueryKey() });
        if (po) {
          queryClient.invalidateQueries({ queryKey: getListJobPurchaseOrdersQueryKey(po.jobId) });
        }
        setLocation("/purchasing");
      },
      onError: () =>
        toast({ title: "Could not delete purchase order", variant: "destructive" }),
    },
  });

  if (isLoading) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!po) return <div className="p-8">Purchase order not found.</div>;

  const editable = po.status === "draft" || po.status === "rejected";

  const startEditing = () => {
    setEditLines(
      po.lines.map((l) => ({
        profileType: l.profileType ?? "",
        profileSize: l.profileSize ?? "",
        grade: l.grade ?? "",
        pieces: String(l.pieces),
        length: l.lengthIn != null ? formatFeetInches(l.lengthIn) : "",
      })),
    );
    setEditing(true);
  };

  return (
    <div className="p-8 space-y-6 max-w-5xl mx-auto po-print-root">
      <div className="print:hidden">
        <Button variant="ghost" onClick={() => setLocation("/purchasing")} className="gap-2 -ml-4">
          <ChevronLeft className="w-4 h-4" /> Back to Purchasing
        </Button>
      </div>

      <div className="flex justify-between items-start flex-wrap gap-4">
        <div>
          <div className="flex gap-3 items-center mb-1">
            <h1 className="text-3xl font-bold tracking-tight">{po.poNumber}</h1>
            {poStatusBadge(po.status)}
          </div>
          <p className="text-muted-foreground">
            Materials purchase order for{" "}
            <Link href={`/jobs/${po.jobId}`} className="text-primary hover:underline print:no-underline print:text-foreground" data-testid="po-job-link">
              {po.jobNumber} {po.jobName}
            </Link>
          </p>
          <p className="text-sm font-medium mt-1">{po.customer}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Created {new Date(po.createdAt).toLocaleDateString()} · Updated {new Date(po.updatedAt).toLocaleDateString()}
          </p>
        </div>

        <div className="flex gap-2 flex-wrap print:hidden">
          <Button variant="outline" className="gap-2" onClick={() => window.print()} data-testid="button-po-print">
            <Printer className="w-4 h-4" /> Print / PDF
          </Button>
          {editable && !editing && (
            <Button variant="outline" className="gap-2" onClick={startEditing} data-testid="button-po-edit">
              <Pencil className="w-4 h-4" /> Edit lines
            </Button>
          )}
          {editable && (
            <Button
              className="gap-2"
              onClick={() => updateStatus.mutate({ poId, data: { status: "sent" } })}
              disabled={updateStatus.isPending || editing || po.lines.length === 0}
              data-testid="button-po-send"
            >
              <Send className="w-4 h-4" /> {po.status === "rejected" ? "Re-send to PM" : "Send to PM"}
            </Button>
          )}
          {po.status === "sent" && (
            <>
              <Button
                className="gap-2"
                onClick={() => { setReviewAction("approved"); setComment(""); }}
                data-testid="button-po-approve"
              >
                <ThumbsUp className="w-4 h-4" /> Approve
              </Button>
              <Button
                variant="outline"
                className="gap-2 text-destructive"
                onClick={() => { setReviewAction("rejected"); setComment(""); }}
                data-testid="button-po-reject"
              >
                <ThumbsDown className="w-4 h-4" /> Reject
              </Button>
            </>
          )}
          {po.status !== "approved" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="icon" className="text-destructive" data-testid="button-po-delete">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {po.poNumber}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes this purchase order and its lines.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive hover:bg-destructive/90"
                    onClick={() => deletePo.mutate({ poId })}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {po.reviewComment && (
        <Card className={po.status === "rejected" ? "border-destructive" : ""}>
          <CardContent className="py-4">
            <Label className="text-muted-foreground">PM review comment</Label>
            <p className="text-sm mt-1 whitespace-pre-wrap" data-testid="po-review-comment">{po.reviewComment}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Material Recap by Type / Size / Grade</CardTitle>
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="space-y-4">
              <PoLinesEditor lines={editLines} onChange={setEditLines} />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                <Button
                  onClick={() => updatePo.mutate({ poId, data: { lines: toLineInputs(editLines) } })}
                  disabled={updatePo.isPending}
                  data-testid="button-po-save-lines"
                >
                  {updatePo.isPending ? "Saving..." : "Save lines"}
                </Button>
              </div>
            </div>
          ) : po.lines.length > 0 ? (
            <div className="border rounded-md overflow-x-auto">
              <RecapTable po={po} />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No material lines on this purchase order.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={reviewAction !== null} onOpenChange={(o) => { if (!o) setReviewAction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewAction === "approved" ? "Approve" : "Reject"} {po.poNumber}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Review comment (optional)</Label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={reviewAction === "rejected" ? "What needs to change?" : "Any notes for the buyer?"}
              data-testid="input-po-review-comment"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewAction(null)}>Cancel</Button>
            <Button
              variant={reviewAction === "rejected" ? "destructive" : "default"}
              onClick={() =>
                reviewAction &&
                updateStatus.mutate({ poId, data: { status: reviewAction, comment: comment.trim() || null } })
              }
              disabled={updateStatus.isPending}
              data-testid="button-po-review-confirm"
            >
              {updateStatus.isPending
                ? "Saving..."
                : reviewAction === "approved"
                  ? "Approve"
                  : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
