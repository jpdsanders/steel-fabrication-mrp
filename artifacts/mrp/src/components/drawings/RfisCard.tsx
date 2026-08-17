import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListJobRfis,
  useListJobDrawings,
  useCreateRfi,
  useUpdateRfi,
  getListJobRfisQueryKey,
  getListJobDrawingsQueryKey,
  RfiStatus,
  type Rfi,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Loader2, Plus, MessageSquareQuote } from "lucide-react";
import { RFI_STATUS_LABELS, fmtDate, truncate } from "./constants";

const NO_DRAWING = "__none__";

function StatusBadge({ status }: { status: RfiStatus }) {
  const variant =
    status === "closed"
      ? "outline"
      : status === "pending"
        ? "secondary"
        : "default";
  return <Badge variant={variant}>{RFI_STATUS_LABELS[status]}</Badge>;
}

export default function RfisCard({ jobId }: { jobId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const listQueryKey = getListJobRfisQueryKey(jobId);

  const rfisQuery = useListJobRfis(jobId, {
    query: { enabled: !!jobId, queryKey: listQueryKey },
  });
  const drawingsQuery = useListJobDrawings(jobId, {
    query: { enabled: !!jobId, queryKey: getListJobDrawingsQueryKey(jobId) },
  });
  const rfis = rfisQuery.data ?? [];
  const drawings = drawingsQuery.data ?? [];

  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<Rfi | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: listQueryKey });

  const createRfi = useCreateRfi({
    mutation: {
      onSuccess: () => {
        toast({ title: "RFI created" });
        invalidate();
        setAddOpen(false);
      },
      onError: () =>
        toast({ title: "Failed to create RFI", variant: "destructive" }),
    },
  });

  const updateRfi = useUpdateRfi({
    mutation: {
      onSuccess: () => {
        toast({ title: "RFI updated" });
        invalidate();
        setDetail(null);
      },
      onError: () =>
        toast({ title: "Failed to update RFI", variant: "destructive" }),
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row justify-between items-center">
        <CardTitle className="flex items-center gap-2">
          <MessageSquareQuote className="w-5 h-5" /> RFIs
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setAddOpen(true)}
          data-testid="button-add-rfi"
        >
          <Plus className="w-4 h-4" /> New RFI
        </Button>
      </CardHeader>
      <CardContent>
        {rfis.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Question</TableHead>
                <TableHead>Directed To</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Response</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rfis.map((rfi) => (
                <TableRow
                  key={rfi.id}
                  className="cursor-pointer"
                  onClick={() => setDetail(rfi)}
                  data-testid={`rfi-row-${rfi.id}`}
                >
                  <TableCell className="font-medium">{rfi.number}</TableCell>
                  <TableCell title={rfi.question}>
                    {truncate(rfi.question)}
                  </TableCell>
                  <TableCell>{rfi.directedTo || "—"}</TableCell>
                  <TableCell>{fmtDate(rfi.dueDate)}</TableCell>
                  <TableCell>
                    <StatusBadge status={rfi.status} />
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground"
                    title={rfi.responseText ?? ""}
                  >
                    {rfi.responseText ? truncate(rfi.responseText, 40) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-4">
            No RFIs yet.
          </div>
        )}
      </CardContent>

      <NewRfiDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        drawings={drawings.map((d) => ({
          id: d.id,
          label: d.drawingNumber,
        }))}
        busy={createRfi.isPending}
        onSubmit={(data) => createRfi.mutate({ jobId, data })}
      />

      {detail && (
        <RfiDetailDialog
          rfi={detail}
          open={!!detail}
          onOpenChange={(o) => {
            if (!o) setDetail(null);
          }}
          busy={updateRfi.isPending}
          onSubmit={(data) => updateRfi.mutate({ rfiId: detail.id, data })}
        />
      )}
    </Card>
  );
}

function NewRfiDialog({
  open,
  onOpenChange,
  drawings,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drawings: { id: number; label: string }[];
  busy: boolean;
  onSubmit: (data: {
    question: string;
    drawingId?: number | null;
    directedTo?: string | null;
    dueDate?: string | null;
  }) => void;
}) {
  const [question, setQuestion] = useState("");
  const [drawingId, setDrawingId] = useState<string>(NO_DRAWING);
  const [directedTo, setDirectedTo] = useState("");
  const [dueDate, setDueDate] = useState("");

  const reset = () => {
    setQuestion("");
    setDrawingId(NO_DRAWING);
    setDirectedTo("");
    setDueDate("");
  };

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New RFI</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>
              Question <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              data-testid="input-rfi-question"
            />
          </div>
          <div className="space-y-2">
            <Label>Drawing</Label>
            <Select value={drawingId} onValueChange={setDrawingId}>
              <SelectTrigger data-testid="select-rfi-drawing">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_DRAWING}>None</SelectItem>
                {drawings.map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Directed To</Label>
              <Input
                value={directedTo}
                onChange={(e) => setDirectedTo(e.target.value)}
                data-testid="input-rfi-directed-to"
              />
            </div>
            <div className="space-y-2">
              <Label>Due Date</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                data-testid="input-rfi-due-date"
              />
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
                question: question.trim(),
                drawingId: drawingId === NO_DRAWING ? null : Number(drawingId),
                directedTo: directedTo.trim() || null,
                dueDate: dueDate || null,
              })
            }
            disabled={busy || !question.trim()}
            data-testid="button-submit-rfi"
          >
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RfiDetailDialog({
  rfi,
  open,
  onOpenChange,
  busy,
  onSubmit,
}: {
  rfi: Rfi;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onSubmit: (data: {
    status: RfiStatus;
    responseText?: string | null;
    directedTo?: string | null;
    dueDate?: string | null;
  }) => void;
}) {
  const [status, setStatus] = useState<RfiStatus>(rfi.status);
  const [responseText, setResponseText] = useState(rfi.responseText ?? "");
  const [directedTo, setDirectedTo] = useState(rfi.directedTo ?? "");
  const [dueDate, setDueDate] = useState(rfi.dueDate ?? "");

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onOpenChange(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rfi.number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-muted-foreground">Question</Label>
            <p className="text-sm whitespace-pre-wrap">{rfi.question}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as RfiStatus)}
              >
                <SelectTrigger data-testid="select-rfi-detail-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(RFI_STATUS_LABELS) as RfiStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {RFI_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Due Date</Label>
              <Input
                type="date"
                value={dueDate ? dueDate.slice(0, 10) : ""}
                onChange={(e) => setDueDate(e.target.value)}
                data-testid="input-rfi-detail-due-date"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Directed To</Label>
            <Input
              value={directedTo}
              onChange={(e) => setDirectedTo(e.target.value)}
              data-testid="input-rfi-detail-directed-to"
            />
          </div>
          <div className="space-y-2">
            <Label>Response</Label>
            <Textarea
              value={responseText}
              onChange={(e) => setResponseText(e.target.value)}
              data-testid="input-rfi-detail-response"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSubmit({
                status,
                responseText: responseText.trim() || null,
                directedTo: directedTo.trim() || null,
                dueDate: dueDate ? dueDate.slice(0, 10) : null,
              })
            }
            disabled={busy}
            data-testid="button-save-rfi"
          >
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
