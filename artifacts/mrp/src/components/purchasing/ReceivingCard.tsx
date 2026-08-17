import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPoReceivingRecords,
  getListPoReceivingRecordsQueryKey,
  useCreateReceivingRecord,
  useGetPurchaseOrder,
  getGetPurchaseOrderQueryKey,
  getListJobDocumentsQueryKey,
  getListInventoryItemsQueryKey,
  getGetJobHeatSheetQueryKey,
  type Document,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { PackageCheck, Plus, Trash2, FileText, AlertTriangle } from "lucide-react";
import { formatFeetInches } from "@/lib/units";
import { getApiUrl } from "@/lib/api";

/** Upload a CMTR to the job and return the created document. */
async function uploadCmtr(jobId: number, file: File): Promise<Document> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("category", "mtr");
  const res = await fetch(getApiUrl(`jobs/${jobId}/documents`), {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    let message = "CMTR upload failed";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }
  return (await res.json()) as Document;
}

type DraftLine = {
  purchaseOrderLineId: number | null;
  label: string;
  pieces: string;
  heatNumber: string;
  file: File | null;
  discrepancyNotes: string;
};

export default function ReceivingCard({ poId, jobId }: { poId: number; jobId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [receivedDate, setReceivedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);

  const { data: po } = useGetPurchaseOrder(poId, {
    query: { enabled: !!poId, queryKey: getGetPurchaseOrderQueryKey(poId) },
  });
  const { data: records } = useListPoReceivingRecords(poId, {
    query: { enabled: !!poId, queryKey: getListPoReceivingRecordsQueryKey(poId) },
  });

  const createReceiving = useCreateReceivingRecord();

  const lineLabel = (l: { profileType?: string | null; profileSize?: string | null; grade?: string | null; lengthIn?: number | null }) =>
    [l.profileType, l.profileSize, l.grade, l.lengthIn != null ? formatFeetInches(l.lengthIn) : null]
      .filter(Boolean)
      .join(" ") || "Material line";

  const openDialog = () => {
    setReceivedDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setDraftLines(
      (po?.lines ?? []).map((l) => ({
        purchaseOrderLineId: l.id,
        label: lineLabel(l),
        pieces: String(l.pieces),
        heatNumber: "",
        file: null,
        discrepancyNotes: "",
      })),
    );
    setOpen(true);
  };

  const updateLine = (index: number, patch: Partial<DraftLine>) => {
    setDraftLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const removeLine = (index: number) => {
    setDraftLines((prev) => prev.filter((_, i) => i !== index));
  };

  const canSubmit =
    draftLines.length > 0 &&
    receivedDate !== "" &&
    draftLines.every(
      (l) => l.heatNumber.trim() !== "" && l.file !== null && Number(l.pieces) >= 1,
    );

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      // Upload every CMTR first, then create the receiving record.
      const lines = [];
      for (const l of draftLines) {
        const doc = await uploadCmtr(jobId, l.file!);
        lines.push({
          purchaseOrderLineId: l.purchaseOrderLineId,
          heatNumber: l.heatNumber.trim(),
          cmtrDocumentId: doc.id,
          pieces: Math.max(1, Math.round(Number(l.pieces) || 1)),
          discrepancyNotes: l.discrepancyNotes.trim() || null,
        });
      }
      await createReceiving.mutateAsync({
        poId,
        data: { receivedDate, notes: notes.trim() || null, lines },
      });
      toast({ title: "Receiving recorded", description: "Material added to inventory with heat traceability." });
      queryClient.invalidateQueries({ queryKey: getListPoReceivingRecordsQueryKey(poId) });
      queryClient.invalidateQueries({ queryKey: getListJobDocumentsQueryKey(jobId) });
      queryClient.invalidateQueries({ queryKey: getListInventoryItemsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetJobHeatSheetQueryKey(jobId) });
      setOpen(false);
    } catch (err) {
      toast({
        title: "Could not record receiving",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <PackageCheck className="w-5 h-5" /> Receiving
        </CardTitle>
        <Button size="sm" onClick={openDialog} data-testid="button-record-receiving">
          <Plus className="w-4 h-4 mr-1" /> Record receipt
        </Button>
      </CardHeader>
      <CardContent>
        {(records ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing received yet. Heat numbers and mill certs are captured at receiving.
          </p>
        ) : (
          <div className="space-y-4">
            {(records ?? []).map((r) => (
              <div key={r.id} className="border rounded-md" data-testid={`receiving-record-${r.id}`}>
                <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50 text-sm">
                  <span className="font-medium">Received {r.receivedDate}</span>
                  <span className="text-muted-foreground">
                    {r.receivedByName ? `by ${r.receivedByName}` : ""}
                  </span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Material</TableHead>
                      <TableHead>Pcs</TableHead>
                      <TableHead>Heat #</TableHead>
                      <TableHead>CMTR</TableHead>
                      <TableHead>Discrepancy</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.lines.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell>{lineLabel(l)}</TableCell>
                        <TableCell>{l.pieces}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" data-testid={`heat-number-${l.id}`}>{l.heatNumber}</Badge>
                        </TableCell>
                        <TableCell>
                          <a
                            href={getApiUrl(`documents/${l.cmtrDocumentId}/download`)}
                            className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                            download={l.cmtrFilename ?? undefined}
                          >
                            <FileText className="w-3.5 h-3.5" /> {l.cmtrFilename ?? "CMTR"}
                          </a>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {l.discrepancyNotes ? (
                            <span className="inline-flex items-center gap-1 text-amber-600">
                              <AlertTriangle className="w-3.5 h-3.5" /> {l.discrepancyNotes}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {r.notes && <p className="text-sm text-muted-foreground px-3 py-2 border-t">{r.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record receiving</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Received date</Label>
                <Input
                  type="date"
                  value={receivedDate}
                  onChange={(e) => setReceivedDate(e.target.value)}
                  data-testid="input-received-date"
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              A heat/lot number and the CMTR (mill cert) file are required for every line —
              they cannot be added later.
            </p>
            <div className="space-y-3">
              {draftLines.map((l, i) => (
                <div key={i} className="border rounded-md p-3 space-y-3" data-testid={`receiving-line-${i}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{l.label}</span>
                    <Button variant="ghost" size="icon" onClick={() => removeLine(i)} data-testid={`button-remove-receiving-line-${i}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Pieces received</Label>
                      <Input
                        type="number"
                        min={1}
                        value={l.pieces}
                        onChange={(e) => updateLine(i, { pieces: e.target.value })}
                        data-testid={`input-received-pieces-${i}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Heat / lot number *</Label>
                      <Input
                        value={l.heatNumber}
                        onChange={(e) => updateLine(i, { heatNumber: e.target.value })}
                        placeholder="e.g. 58A21377"
                        data-testid={`input-heat-number-${i}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">CMTR file *</Label>
                      <Input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={(e) => updateLine(i, { file: e.target.files?.[0] ?? null })}
                        data-testid={`input-cmtr-file-${i}`}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Discrepancy notes</Label>
                    <Input
                      value={l.discrepancyNotes}
                      onChange={(e) => updateLine(i, { discrepancyNotes: e.target.value })}
                      placeholder="Short count, damage, wrong size..."
                      data-testid={`input-discrepancy-${i}`}
                    />
                  </div>
                </div>
              ))}
              {draftLines.length === 0 && (
                <p className="text-sm text-muted-foreground">No lines to receive.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Delivery notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-receiving-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!canSubmit || saving} data-testid="button-save-receiving">
              {saving ? "Saving..." : "Record receipt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
