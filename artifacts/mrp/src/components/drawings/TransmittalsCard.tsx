import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListJobTransmittals,
  useListJobDrawings,
  useListJobDocuments,
  useCreateTransmittal,
  getListJobTransmittalsQueryKey,
  getListJobDrawingsQueryKey,
  getListJobDocumentsQueryKey,
  TransmittalPurpose,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Send } from "lucide-react";
import {
  TRANSMITTAL_PURPOSE_LABELS,
  fmtDate,
  todayIso,
} from "./constants";

interface ItemInput {
  documentId?: number;
  drawingRevisionId?: number;
}

export default function TransmittalsCard({ jobId }: { jobId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const listQueryKey = getListJobTransmittalsQueryKey(jobId);

  const transmittalsQuery = useListJobTransmittals(jobId, {
    query: { enabled: !!jobId, queryKey: listQueryKey },
  });
  const drawingsQuery = useListJobDrawings(jobId, {
    query: { enabled: !!jobId, queryKey: getListJobDrawingsQueryKey(jobId) },
  });
  const documentsQuery = useListJobDocuments(jobId, {
    query: { enabled: !!jobId, queryKey: getListJobDocumentsQueryKey(jobId) },
  });

  const transmittals = transmittalsQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const revisions = (drawingsQuery.data ?? [])
    .filter((d) => d.activeRevision)
    .map((d) => ({
      id: d.activeRevision!.id,
      label: `${d.drawingNumber} Rev ${d.activeRevision!.revisionLabel}`,
    }));

  const [addOpen, setAddOpen] = useState(false);

  const createTransmittal = useCreateTransmittal({
    mutation: {
      onSuccess: () => {
        toast({ title: "Transmittal logged" });
        queryClient.invalidateQueries({ queryKey: listQueryKey });
        setAddOpen(false);
      },
      onError: () =>
        toast({ title: "Failed to log transmittal", variant: "destructive" }),
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row justify-between items-center">
        <CardTitle className="flex items-center gap-2">
          <Send className="w-5 h-5" /> Transmittals
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setAddOpen(true)}
          data-testid="button-add-transmittal"
        >
          <Plus className="w-4 h-4" /> Log Transmittal
        </Button>
      </CardHeader>
      <CardContent>
        {transmittals.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sent</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead>Sender</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transmittals.map((t) => (
                <TableRow key={t.id} data-testid={`transmittal-row-${t.id}`}>
                  <TableCell>{fmtDate(t.sentDate)}</TableCell>
                  <TableCell className="font-medium">{t.recipient}</TableCell>
                  <TableCell>{TRANSMITTAL_PURPOSE_LABELS[t.purpose]}</TableCell>
                  <TableCell>{t.senderName || "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {t.items.map((item) => (
                        <Badge
                          key={item.id}
                          variant="outline"
                          className="text-[10px]"
                        >
                          {item.label}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground text-xs"
                    title={t.notes ?? ""}
                  >
                    {t.notes || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-4">
            No transmittals logged yet.
          </div>
        )}
      </CardContent>

      <LogTransmittalDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        documents={documents.map((d) => ({ id: d.id, label: d.filename }))}
        revisions={revisions}
        busy={createTransmittal.isPending}
        onSubmit={(data) => createTransmittal.mutate({ jobId, data })}
      />
    </Card>
  );
}

function LogTransmittalDialog({
  open,
  onOpenChange,
  documents,
  revisions,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documents: { id: number; label: string }[];
  revisions: { id: number; label: string }[];
  busy: boolean;
  onSubmit: (data: {
    sentDate: string;
    recipient: string;
    purpose: TransmittalPurpose;
    notes?: string | null;
    items: ItemInput[];
  }) => void;
}) {
  const [sentDate, setSentDate] = useState(todayIso());
  const [recipient, setRecipient] = useState("");
  const [purpose, setPurpose] = useState<TransmittalPurpose>("for_approval");
  const [notes, setNotes] = useState("");
  const [docIds, setDocIds] = useState<number[]>([]);
  const [revIds, setRevIds] = useState<number[]>([]);

  const reset = () => {
    setSentDate(todayIso());
    setRecipient("");
    setPurpose("for_approval");
    setNotes("");
    setDocIds([]);
    setRevIds([]);
  };

  const toggle = (
    id: number,
    set: React.Dispatch<React.SetStateAction<number[]>>,
  ) =>
    set((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const itemCount = docIds.length + revIds.length;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) {
          reset();
          onOpenChange(false);
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Log Transmittal</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 max-h-[65vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Sent Date</Label>
              <Input
                type="date"
                value={sentDate}
                onChange={(e) => setSentDate(e.target.value)}
                data-testid="input-transmittal-date"
              />
            </div>
            <div className="space-y-2">
              <Label>Purpose</Label>
              <Select
                value={purpose}
                onValueChange={(v) => setPurpose(v as TransmittalPurpose)}
              >
                <SelectTrigger data-testid="select-transmittal-purpose">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(
                      TRANSMITTAL_PURPOSE_LABELS,
                    ) as TransmittalPurpose[]
                  ).map((p) => (
                    <SelectItem key={p} value={p}>
                      {TRANSMITTAL_PURPOSE_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>
              Recipient <span className="text-destructive">*</span>
            </Label>
            <Input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              data-testid="input-transmittal-recipient"
            />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              data-testid="input-transmittal-notes"
            />
          </div>
          <div className="space-y-2">
            <Label>
              Items <span className="text-destructive">*</span>{" "}
              <span className="text-xs text-muted-foreground">
                ({itemCount} selected)
              </span>
            </Label>
            <div className="space-y-3">
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Drawing Revisions
                </div>
                {revisions.length > 0 ? (
                  <div className="space-y-1 max-h-32 overflow-y-auto border rounded-md p-2">
                    {revisions.map((r) => (
                      <label
                        key={r.id}
                        className="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <Checkbox
                          checked={revIds.includes(r.id)}
                          onCheckedChange={() => toggle(r.id, setRevIds)}
                          data-testid={`checkbox-transmittal-revision-${r.id}`}
                        />
                        {r.label}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No active revisions.
                  </p>
                )}
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Documents
                </div>
                {documents.length > 0 ? (
                  <div className="space-y-1 max-h-32 overflow-y-auto border rounded-md p-2">
                    {documents.map((d) => (
                      <label
                        key={d.id}
                        className="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <Checkbox
                          checked={docIds.includes(d.id)}
                          onCheckedChange={() => toggle(d.id, setDocIds)}
                          data-testid={`checkbox-transmittal-document-${d.id}`}
                        />
                        <span className="truncate" title={d.label}>
                          {d.label}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No documents.</p>
                )}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSubmit({
                sentDate,
                recipient: recipient.trim(),
                purpose,
                notes: notes.trim() || null,
                items: [
                  ...revIds.map((id) => ({ drawingRevisionId: id })),
                  ...docIds.map((id) => ({ documentId: id })),
                ],
              })
            }
            disabled={busy || !recipient.trim() || itemCount === 0}
            data-testid="button-submit-transmittal"
          >
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Log
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
