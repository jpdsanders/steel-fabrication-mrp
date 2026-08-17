import { useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPurchaseOrder,
  getGetPurchaseOrderQueryKey,
  useUpdatePurchaseOrder,
  useDeletePurchaseOrder,
  useUpdatePurchaseOrderStatus,
  useListPurchaseOrderRevisions,
  getListPurchaseOrderRevisionsQueryKey,
  useListVendors,
  getListVendorsQueryKey,
  useListQualityClauses,
  getListQualityClausesQueryKey,
  getListPurchaseOrdersQueryKey,
  getListJobPurchaseOrdersQueryKey,
  getListDueInLinesQueryKey,
  type PurchaseOrderDetail as PoDetail,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  History,
  AlertTriangle,
  PackageCheck,
  PackageMinus,
  Package,
  PackageX,
} from "lucide-react";
import PoPricingLinesEditor, {
  type EditablePricingLine,
  emptyPricingLine,
  toPricingLineInputs,
  ClauseMultiSelect,
} from "@/components/purchasing/PoPricingLinesEditor";
import { poStatusBadge } from "@/components/purchasing/status";
import ReceivingCard from "@/components/purchasing/ReceivingCard";
import {
  vendorStatusBadge,
  vendorStatusLabel,
  vendorNeedsException,
  apiErrorMessage,
  formatCurrency,
} from "@/components/purchasing/vendorStatus";
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

type ReceiptStatus = "not_received" | "partial" | "complete" | "over";

function receiptStatusBadge(status: ReceiptStatus) {
  switch (status) {
    case "complete":
      return (
        <Badge className="gap-1 bg-green-600 text-white hover:bg-green-700 text-xs">
          <PackageCheck className="w-3 h-3" /> Complete
        </Badge>
      );
    case "partial":
      return (
        <Badge variant="outline" className="gap-1 border-amber-500 text-amber-700 dark:text-amber-400 text-xs">
          <PackageMinus className="w-3 h-3" /> Partial
        </Badge>
      );
    case "over":
      return (
        <Badge variant="destructive" className="gap-1 text-xs">
          <PackageX className="w-3 h-3" /> Over
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="gap-1 text-xs">
          <Package className="w-3 h-3" /> Not received
        </Badge>
      );
  }
}

function RecapTable({
  po,
  clauseCode,
}: {
  po: PoDetail;
  clauseCode: (id: number) => string;
}) {
  const groups = groupLines(po.lines);
  const grandPieces = po.lines.reduce((s, l) => s + l.pieces, 0);
  const grandLength = po.lines.reduce((s, l) => s + (l.lengthIn ?? 0), 0);
  const grandReceived = po.lines.reduce((s, l) => s + (l.receivedPieces ?? 0), 0);
  const grandRemaining = grandPieces - grandReceived;
  const overallPct = grandPieces > 0 ? Math.min(100, Math.round((grandReceived / grandPieces) * 100)) : 0;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>Grade</TableHead>
          <TableHead className="text-right">Ordered</TableHead>
          <TableHead className="text-right">Received</TableHead>
          <TableHead className="text-right">Remaining</TableHead>
          <TableHead>Receipt</TableHead>
          <TableHead className="text-right">Total length</TableHead>
          <TableHead className="text-right">Unit price</TableHead>
          <TableHead className="text-right">Extended</TableHead>
          <TableHead>Promise date</TableHead>
          <TableHead>Clauses</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map(([type, lines]) => {
          const groupPieces = lines.reduce((s, l) => s + l.pieces, 0);
          const groupLength = lines.reduce((s, l) => s + (l.lengthIn ?? 0), 0);
          const groupReceived = lines.reduce((s, l) => s + (l.receivedPieces ?? 0), 0);
          const groupRemaining = groupPieces - groupReceived;
          return [
            ...lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>{line.profileType ?? "—"}</TableCell>
                <TableCell>{line.profileSize ?? "—"}</TableCell>
                <TableCell>{line.grade ?? "—"}</TableCell>
                <TableCell className="text-right">{line.pieces}</TableCell>
                <TableCell className="text-right">{line.receivedPieces ?? 0}</TableCell>
                <TableCell className={`text-right font-medium ${(line.remainingPieces ?? 0) < 0 ? "text-destructive" : ""}`}>
                  {line.remainingPieces ?? line.pieces}
                </TableCell>
                <TableCell>{receiptStatusBadge((line.receiptStatus as ReceiptStatus) ?? "not_received")}</TableCell>
                <TableCell className="text-right">{formatFeetInches(line.lengthIn)}</TableCell>
                <TableCell className="text-right">{formatCurrency(line.unitPrice)}</TableCell>
                <TableCell className="text-right">{formatCurrency(line.extendedPrice)}</TableCell>
                <TableCell>{line.promiseDate ?? "—"}</TableCell>
                <TableCell>
                  {line.qualityClauseIds.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {line.qualityClauseIds.map((id) => (
                        <Badge key={id} variant="outline" className="text-xs">
                          {clauseCode(id)}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            )),
            <TableRow key={`subtotal-${type}`} className="bg-muted/50 font-medium">
              <TableCell colSpan={3}>Subtotal {type}</TableCell>
              <TableCell className="text-right">{groupPieces}</TableCell>
              <TableCell className="text-right">{groupReceived}</TableCell>
              <TableCell className="text-right">{groupRemaining}</TableCell>
              <TableCell colSpan={5} />
              <TableCell className="text-right">{formatFeetInches(groupLength)}</TableCell>
              <TableCell colSpan={2} />
            </TableRow>,
          ];
        })}
        <TableRow className="font-bold border-t-2">
          <TableCell colSpan={3}>Grand total</TableCell>
          <TableCell className="text-right">{grandPieces}</TableCell>
          <TableCell className="text-right">{grandReceived}</TableCell>
          <TableCell className="text-right">{grandRemaining}</TableCell>
          <TableCell>
            <span className="text-xs text-muted-foreground">{overallPct}% rcvd</span>
          </TableCell>
          <TableCell className="text-right">{formatFeetInches(grandLength)}</TableCell>
          <TableCell />
          <TableCell className="text-right">{formatCurrency(po.totalAmount)}</TableCell>
          <TableCell colSpan={2} />
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
  const [editLines, setEditLines] = useState<EditablePricingLine[]>([]);
  const [editVendorId, setEditVendorId] = useState<string>("");
  const [editJustification, setEditJustification] = useState("");
  const [editClauseIds, setEditClauseIds] = useState<number[]>([]);
  const [revisionNote, setRevisionNote] = useState("");
  const [changeOrderPrompt, setChangeOrderPrompt] = useState(false);
  const [reviewAction, setReviewAction] = useState<"approved" | "rejected" | null>(null);
  const [comment, setComment] = useState("");

  const { data: po, isLoading } = useGetPurchaseOrder(poId, {
    query: { enabled: !!poId, queryKey: getGetPurchaseOrderQueryKey(poId) },
  });
  const { data: vendors } = useListVendors(undefined, {
    query: { queryKey: getListVendorsQueryKey() },
  });
  const { data: clauses } = useListQualityClauses({
    query: { queryKey: getListQualityClausesQueryKey() },
  });
  const { data: revisions } = useListPurchaseOrderRevisions(poId, {
    query: { enabled: !!poId, queryKey: getListPurchaseOrderRevisionsQueryKey(poId) },
  });

  const clauseById = new Map((clauses ?? []).map((c) => [c.id, c]));
  const clauseCode = (id: number) => clauseById.get(id)?.code ?? String(id);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetPurchaseOrderQueryKey(poId) });
    queryClient.invalidateQueries({ queryKey: getListPurchaseOrdersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListPurchaseOrderRevisionsQueryKey(poId) });
    queryClient.invalidateQueries({ queryKey: getListDueInLinesQueryKey() });
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
      onError: (err) =>
        toast({
          title: "Could not update purchase order",
          description: apiErrorMessage(err, "Please try again."),
          variant: "destructive",
        }),
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
      onError: (err) =>
        toast({
          title: "Status change not allowed",
          description: apiErrorMessage(err, "You may not have the required role."),
          variant: "destructive",
        }),
    },
  });

  const deletePo = useDeletePurchaseOrder({
    mutation: {
      onSuccess: () => {
        toast({ title: "Purchase order deleted" });
        queryClient.invalidateQueries({ queryKey: getListPurchaseOrdersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListDueInLinesQueryKey() });
        if (po) {
          queryClient.invalidateQueries({ queryKey: getListJobPurchaseOrdersQueryKey(po.jobId) });
        }
        setLocation("/purchasing");
      },
      onError: (err) =>
        toast({
          title: "Could not delete purchase order",
          description: apiErrorMessage(err, "Please try again."),
          variant: "destructive",
        }),
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
  const pastDraft = po.status === "sent" || po.status === "approved";
  const revision = po.revision ?? 0;

  const editVendor = vendors?.find((v) => String(v.id) === editVendorId);
  const editNeedsException = vendorNeedsException(editVendor?.status);

  const startEditing = (keepRevisionNote = false) => {
    setEditLines(
      po.lines.map((l) => ({
        ...emptyPricingLine(),
        profileType: l.profileType ?? "",
        profileSize: l.profileSize ?? "",
        grade: l.grade ?? "",
        pieces: String(l.pieces),
        length: l.lengthIn != null ? formatFeetInches(l.lengthIn) : "",
        unitPrice: l.unitPrice != null ? String(l.unitPrice) : "",
        promiseDate: l.promiseDate ?? "",
        qualityClauseIds: l.qualityClauseIds ?? [],
      })),
    );
    setEditVendorId(po.vendorId != null ? String(po.vendorId) : "");
    setEditJustification(po.vendorExceptionJustification ?? "");
    setEditClauseIds(po.qualityClauseIds ?? []);
    if (!keepRevisionNote) setRevisionNote("");
    setEditing(true);
  };

  const requestEdit = () => {
    if (pastDraft) {
      setRevisionNote("");
      setChangeOrderPrompt(true);
    } else {
      startEditing();
    }
  };

  const saveEdit = () => {
    updatePo.mutate({
      poId,
      data: {
        vendorId: editVendorId ? Number(editVendorId) : undefined,
        vendorExceptionJustification: editNeedsException
          ? editJustification.trim() || null
          : null,
        qualityClauseIds: editClauseIds,
        revisionNote: pastDraft ? revisionNote.trim() || null : null,
        lines: toPricingLineInputs(editLines),
      },
    });
  };

  const approval = po.approval;

  return (
    <div className="p-8 space-y-6 max-w-5xl mx-auto po-print-root">
      <div className="print:hidden">
        <Button variant="ghost" onClick={() => setLocation("/purchasing")} className="gap-2 -ml-4">
          <ChevronLeft className="w-4 h-4" /> Back to Purchasing
        </Button>
      </div>

      <div className="flex justify-between items-start flex-wrap gap-4">
        <div>
          <div className="flex gap-3 items-center mb-1 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight">{po.poNumber}</h1>
            {poStatusBadge(po.status)}
            {revision > 0 && (
              <Badge variant="outline" data-testid="po-detail-revision">
                Rev {revision}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground">
            Materials purchase order for{" "}
            <Link href={`/jobs/${po.jobId}`} className="text-primary hover:underline print:no-underline print:text-foreground" data-testid="po-job-link">
              {po.jobNumber} {po.jobName}
            </Link>
          </p>
          <p className="text-sm font-medium mt-1">{po.customer}</p>
          {po.vendorName && (
            <div className="flex items-center gap-2 mt-2" data-testid="po-vendor">
              <span className="text-sm">Vendor: <span className="font-medium">{po.vendorName}</span></span>
              {vendorStatusBadge(po.vendorStatus)}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            Created {new Date(po.createdAt).toLocaleDateString()} · Updated {new Date(po.updatedAt).toLocaleDateString()}
          </p>
        </div>

        <div className="flex gap-2 flex-wrap print:hidden">
          <Button variant="outline" className="gap-2" onClick={() => window.print()} data-testid="button-po-print">
            <Printer className="w-4 h-4" /> Print / PDF
          </Button>
          {!editing && (
            <Button variant="outline" className="gap-2" onClick={requestEdit} data-testid="button-po-edit">
              <Pencil className="w-4 h-4" /> Edit
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

      {approval?.requiresApproval && po.status === "sent" && (
        <div
          className="flex items-center gap-2 text-sm rounded-md border border-amber-500 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 print:hidden"
          data-testid="po-approval-note"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            Requires approval: {approval.thresholdLabel ?? "review required"}
            {approval.requiredRole ? ` (role: ${approval.requiredRole})` : ""}.
          </span>
        </div>
      )}

      {po.vendorExceptionJustification && (
        <Card className="border-amber-500">
          <CardContent className="py-4">
            <Label className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4" /> Non-approved vendor exception
            </Label>
            <p className="text-sm mt-1 whitespace-pre-wrap" data-testid="po-exception-justification">
              {po.vendorExceptionJustification}
            </p>
          </CardContent>
        </Card>
      )}

      {po.reviewComment && (
        <Card className={po.status === "rejected" ? "border-destructive" : ""}>
          <CardContent className="py-4">
            <Label className="text-muted-foreground">PM review comment</Label>
            <p className="text-sm mt-1 whitespace-pre-wrap" data-testid="po-review-comment">{po.reviewComment}</p>
          </CardContent>
        </Card>
      )}

      {!editing && (po.qualityClauseIds?.length ?? 0) > 0 && (
        <Card>
          <CardContent className="py-4">
            <Label className="text-muted-foreground">PO quality clauses</Label>
            <div className="flex flex-wrap gap-2 mt-2" data-testid="po-quality-clauses">
              {(po.qualityClauseIds ?? []).map((id) => {
                const c = clauseById.get(id);
                return (
                  <Badge key={id} variant="secondary">
                    {c ? `${c.code} — ${c.title}` : id}
                  </Badge>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Material Recap by Type / Size / Grade</CardTitle>
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Vendor</Label>
                  <Select value={editVendorId} onValueChange={setEditVendorId}>
                    <SelectTrigger data-testid="select-edit-po-vendor">
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
              </div>

              {editNeedsException && (
                <div className="space-y-2 border border-amber-500 bg-amber-50 dark:bg-amber-950/30 rounded-md p-3">
                  <Label className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="w-4 h-4" /> Exception justification (required)
                  </Label>
                  <Textarea
                    value={editJustification}
                    onChange={(e) => setEditJustification(e.target.value)}
                    placeholder="Why is this non-approved vendor being used?"
                    data-testid="input-edit-po-exception"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>PO-level quality clauses</Label>
                <ClauseMultiSelect
                  clauses={clauses ?? []}
                  selected={editClauseIds}
                  onChange={setEditClauseIds}
                  idPrefix="edit-po"
                />
              </div>

              {pastDraft && (
                <div className="space-y-2 border rounded-md p-3">
                  <Label className="flex items-center gap-2">
                    <History className="w-4 h-4" /> Change order note (optional)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Editing this {po.status === "approved" ? "approved" : "sent"} PO
                    will create revision Rev {revision + 1}.
                  </p>
                  <Textarea
                    value={revisionNote}
                    onChange={(e) => setRevisionNote(e.target.value)}
                    placeholder="Describe what changed..."
                    data-testid="input-po-revision-note"
                  />
                </div>
              )}

              <PoPricingLinesEditor
                lines={editLines}
                onChange={setEditLines}
                clauses={clauses ?? []}
              />

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                <Button
                  onClick={saveEdit}
                  disabled={
                    updatePo.isPending ||
                    !editVendorId ||
                    (editNeedsException && !editJustification.trim())
                  }
                  data-testid="button-po-save-lines"
                >
                  {updatePo.isPending ? "Saving..." : pastDraft ? `Save as Rev ${revision + 1}` : "Save changes"}
                </Button>
              </div>
            </div>
          ) : po.lines.length > 0 ? (
            <div className="border rounded-md overflow-x-auto">
              <RecapTable po={po} clauseCode={clauseCode} />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No material lines on this purchase order.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="print:hidden">
        <ReceivingCard poId={po.id} jobId={po.jobId} />
      </div>

      {revisions && revisions.length > 0 && (
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="w-5 h-5" /> Revision history
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Rev #</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead>Author</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...revisions]
                    .sort((a, b) => b.revisionNumber - a.revisionNumber)
                    .map((rev) => (
                      <TableRow key={rev.id} data-testid={`po-revision-row-${rev.id}`}>
                        <TableCell className="font-medium">Rev {rev.revisionNumber}</TableCell>
                        <TableCell className="whitespace-pre-wrap">{rev.note ?? "—"}</TableCell>
                        <TableCell>{rev.createdByName ?? "—"}</TableCell>
                        <TableCell>{new Date(rev.createdAt).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={changeOrderPrompt} onOpenChange={setChangeOrderPrompt}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {po.poNumber} (Rev {revision + 1})</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <div className="flex items-start gap-2 text-sm rounded-md border border-amber-500 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                This PO is {po.status === "approved" ? "approved" : "sent for review"}.
                Editing it creates a numbered change-order revision (Rev {revision + 1}).
              </span>
            </div>
            <Label>Change order note (optional)</Label>
            <Textarea
              value={revisionNote}
              onChange={(e) => setRevisionNote(e.target.value)}
              placeholder="Describe what is changing..."
              data-testid="input-change-order-note"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeOrderPrompt(false)}>Cancel</Button>
            <Button
              onClick={() => {
                setChangeOrderPrompt(false);
                startEditing(true);
              }}
              data-testid="button-change-order-continue"
            >
              Continue to edit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewAction !== null} onOpenChange={(o) => { if (!o) setReviewAction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewAction === "approved" ? "Approve" : "Reject"} {po.poNumber}
            </DialogTitle>
          </DialogHeader>
          {reviewAction === "approved" && approval?.requiresApproval && (
            <div className="flex items-start gap-2 text-sm rounded-md border border-amber-500 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                {approval.thresholdLabel ?? "Approval required"}
                {approval.requiredRole ? ` — requires the ${approval.requiredRole} role.` : "."}
              </span>
            </div>
          )}
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
