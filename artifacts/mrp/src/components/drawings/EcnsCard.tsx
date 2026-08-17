import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListJobEcns,
  useListJobDrawings,
  useCreateEcn,
  useUpdateEcn,
  getListJobEcnsQueryKey,
  getListJobDrawingsQueryKey,
  EcnSource,
  EcnDisposition,
  EcnStatus,
  type Ecn,
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
import { Loader2, Plus, ClipboardEdit } from "lucide-react";
import {
  ECN_SOURCE_LABELS,
  ECN_DISPOSITION_LABELS,
  ECN_STATUS_LABELS,
  fmtDate,
  fmtDateTime,
  truncate,
} from "./constants";

const NO_DISPOSITION = "__none__";

interface RevisionOption {
  id: number;
  label: string;
}

function StatusBadge({ status }: { status: EcnStatus }) {
  const variant =
    status === "closed"
      ? "outline"
      : status === "approved"
        ? "default"
        : "secondary";
  return <Badge variant={variant}>{ECN_STATUS_LABELS[status]}</Badge>;
}

export default function EcnsCard({ jobId }: { jobId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const listQueryKey = getListJobEcnsQueryKey(jobId);

  const ecnsQuery = useListJobEcns(jobId, {
    query: { enabled: !!jobId, queryKey: listQueryKey },
  });
  const drawingsQuery = useListJobDrawings(jobId, {
    query: { enabled: !!jobId, queryKey: getListJobDrawingsQueryKey(jobId) },
  });
  const ecns = ecnsQuery.data ?? [];

  const revisionOptions: RevisionOption[] = (drawingsQuery.data ?? [])
    .filter((d) => d.activeRevision)
    .map((d) => ({
      id: d.activeRevision!.id,
      label: `${d.drawingNumber} Rev ${d.activeRevision!.revisionLabel}`,
    }));

  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<Ecn | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: listQueryKey });

  const createEcn = useCreateEcn({
    mutation: {
      onSuccess: () => {
        toast({ title: "ECN created" });
        invalidate();
        setAddOpen(false);
      },
      onError: () =>
        toast({ title: "Failed to create ECN", variant: "destructive" }),
    },
  });

  const updateEcn = useUpdateEcn({
    mutation: {
      onSuccess: () => {
        toast({ title: "ECN updated" });
        invalidate();
        setDetail(null);
      },
      onError: () =>
        toast({ title: "Failed to update ECN", variant: "destructive" }),
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row justify-between items-center">
        <CardTitle className="flex items-center gap-2">
          <ClipboardEdit className="w-5 h-5" /> ECNs
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setAddOpen(true)}
          data-testid="button-add-ecn"
        >
          <Plus className="w-4 h-4" /> New ECN
        </Button>
      </CardHeader>
      <CardContent>
        {ecns.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Disposition</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Approval / Closure</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ecns.map((ecn) => (
                <TableRow
                  key={ecn.id}
                  className="cursor-pointer"
                  onClick={() => setDetail(ecn)}
                  data-testid={`ecn-row-${ecn.id}`}
                >
                  <TableCell className="font-medium">{ecn.number}</TableCell>
                  <TableCell>{ECN_SOURCE_LABELS[ecn.source]}</TableCell>
                  <TableCell title={ecn.description}>
                    {truncate(ecn.description)}
                  </TableCell>
                  <TableCell>
                    {ecn.disposition
                      ? ECN_DISPOSITION_LABELS[ecn.disposition]
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={ecn.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {ecn.approvedByName && (
                      <div>
                        Approved by {ecn.approvedByName}
                        {ecn.approvedAt ? ` · ${fmtDate(ecn.approvedAt)}` : ""}
                      </div>
                    )}
                    {ecn.closedAt && <div>Closed {fmtDate(ecn.closedAt)}</div>}
                    {!ecn.approvedByName && !ecn.closedAt && "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-4">
            No ECNs yet.
          </div>
        )}
      </CardContent>

      <NewEcnDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        revisionOptions={revisionOptions}
        busy={createEcn.isPending}
        onSubmit={(data) => createEcn.mutate({ jobId, data })}
      />

      {detail && (
        <EcnDetailDialog
          ecn={detail}
          open={!!detail}
          onOpenChange={(o) => {
            if (!o) setDetail(null);
          }}
          revisionOptions={revisionOptions}
          busy={updateEcn.isPending}
          onSubmit={(data) => updateEcn.mutate({ ecnId: detail.id, data })}
        />
      )}
    </Card>
  );
}

function RevisionMultiSelect({
  options,
  selected,
  onToggle,
}: {
  options: RevisionOption[];
  selected: number[];
  onToggle: (id: number) => void;
}) {
  if (options.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No active revisions available.
      </p>
    );
  }
  return (
    <div className="space-y-1 max-h-40 overflow-y-auto border rounded-md p-2">
      {options.map((opt) => (
        <label
          key={opt.id}
          className="flex items-center gap-2 text-sm cursor-pointer"
        >
          <Checkbox
            checked={selected.includes(opt.id)}
            onCheckedChange={() => onToggle(opt.id)}
            data-testid={`checkbox-ecn-revision-${opt.id}`}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

function NewEcnDialog({
  open,
  onOpenChange,
  revisionOptions,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  revisionOptions: RevisionOption[];
  busy: boolean;
  onSubmit: (data: {
    source: EcnSource;
    description: string;
    affectedWork?: string | null;
    costImpact?: string | null;
    scheduleImpact?: string | null;
    disposition?: EcnDisposition | null;
    affectedRevisionIds?: number[];
  }) => void;
}) {
  const [source, setSource] = useState<EcnSource>("customer");
  const [description, setDescription] = useState("");
  const [affectedWork, setAffectedWork] = useState("");
  const [costImpact, setCostImpact] = useState("");
  const [scheduleImpact, setScheduleImpact] = useState("");
  const [disposition, setDisposition] = useState<string>(NO_DISPOSITION);
  const [revIds, setRevIds] = useState<number[]>([]);

  const reset = () => {
    setSource("customer");
    setDescription("");
    setAffectedWork("");
    setCostImpact("");
    setScheduleImpact("");
    setDisposition(NO_DISPOSITION);
    setRevIds([]);
  };

  const toggle = (id: number) =>
    setRevIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

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
          <DialogTitle>New ECN</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 max-h-[65vh] overflow-y-auto">
          <div className="space-y-2">
            <Label>Source</Label>
            <Select
              value={source}
              onValueChange={(v) => setSource(v as EcnSource)}
            >
              <SelectTrigger data-testid="select-ecn-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ECN_SOURCE_LABELS) as EcnSource[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {ECN_SOURCE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>
              Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="input-ecn-description"
            />
          </div>
          <div className="space-y-2">
            <Label>Affected Work</Label>
            <Textarea
              value={affectedWork}
              onChange={(e) => setAffectedWork(e.target.value)}
              data-testid="input-ecn-affected-work"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Cost Impact</Label>
              <Input
                value={costImpact}
                onChange={(e) => setCostImpact(e.target.value)}
                data-testid="input-ecn-cost-impact"
              />
            </div>
            <div className="space-y-2">
              <Label>Schedule Impact</Label>
              <Input
                value={scheduleImpact}
                onChange={(e) => setScheduleImpact(e.target.value)}
                data-testid="input-ecn-schedule-impact"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Disposition</Label>
            <Select value={disposition} onValueChange={setDisposition}>
              <SelectTrigger data-testid="select-ecn-disposition">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_DISPOSITION}>None</SelectItem>
                {(Object.keys(ECN_DISPOSITION_LABELS) as EcnDisposition[]).map(
                  (d) => (
                    <SelectItem key={d} value={d}>
                      {ECN_DISPOSITION_LABELS[d]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Affected Revisions</Label>
            <RevisionMultiSelect
              options={revisionOptions}
              selected={revIds}
              onToggle={toggle}
            />
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
                source,
                description: description.trim(),
                affectedWork: affectedWork.trim() || null,
                costImpact: costImpact.trim() || null,
                scheduleImpact: scheduleImpact.trim() || null,
                disposition:
                  disposition === NO_DISPOSITION
                    ? null
                    : (disposition as EcnDisposition),
                affectedRevisionIds: revIds,
              })
            }
            disabled={busy || !description.trim()}
            data-testid="button-submit-ecn"
          >
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EcnDetailDialog({
  ecn,
  open,
  onOpenChange,
  revisionOptions,
  busy,
  onSubmit,
}: {
  ecn: Ecn;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  revisionOptions: RevisionOption[];
  busy: boolean;
  onSubmit: (data: {
    description?: string;
    affectedWork?: string | null;
    costImpact?: string | null;
    scheduleImpact?: string | null;
    disposition?: EcnDisposition | null;
    status?: EcnStatus;
    affectedRevisionIds?: number[];
  }) => void;
}) {
  const [description, setDescription] = useState(ecn.description);
  const [affectedWork, setAffectedWork] = useState(ecn.affectedWork ?? "");
  const [costImpact, setCostImpact] = useState(ecn.costImpact ?? "");
  const [scheduleImpact, setScheduleImpact] = useState(ecn.scheduleImpact ?? "");
  const [disposition, setDisposition] = useState<string>(
    ecn.disposition ?? NO_DISPOSITION,
  );
  const [status, setStatus] = useState<EcnStatus>(ecn.status);
  const [revIds, setRevIds] = useState<number[]>(ecn.affectedRevisionIds ?? []);

  const toggle = (id: number) =>
    setRevIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onOpenChange(false);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{ecn.number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 max-h-[65vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as EcnStatus)}
              >
                <SelectTrigger data-testid="select-ecn-detail-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ECN_STATUS_LABELS) as EcnStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {ECN_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Disposition</Label>
              <Select value={disposition} onValueChange={setDisposition}>
                <SelectTrigger data-testid="select-ecn-detail-disposition">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DISPOSITION}>None</SelectItem>
                  {(Object.keys(ECN_DISPOSITION_LABELS) as EcnDisposition[]).map(
                    (d) => (
                      <SelectItem key={d} value={d}>
                        {ECN_DISPOSITION_LABELS[d]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="input-ecn-detail-description"
            />
          </div>
          <div className="space-y-2">
            <Label>Affected Work</Label>
            <Textarea
              value={affectedWork}
              onChange={(e) => setAffectedWork(e.target.value)}
              data-testid="input-ecn-detail-affected-work"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Cost Impact</Label>
              <Input
                value={costImpact}
                onChange={(e) => setCostImpact(e.target.value)}
                data-testid="input-ecn-detail-cost-impact"
              />
            </div>
            <div className="space-y-2">
              <Label>Schedule Impact</Label>
              <Input
                value={scheduleImpact}
                onChange={(e) => setScheduleImpact(e.target.value)}
                data-testid="input-ecn-detail-schedule-impact"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Affected Revisions</Label>
            <RevisionMultiSelect
              options={revisionOptions}
              selected={revIds}
              onToggle={toggle}
            />
          </div>
          {(ecn.approvedByName || ecn.closedAt) && (
            <div className="text-xs text-muted-foreground space-y-0.5 border-t pt-2">
              {ecn.approvedByName && (
                <div>
                  Approved by {ecn.approvedByName} · {fmtDateTime(ecn.approvedAt)}
                </div>
              )}
              {ecn.closedAt && <div>Closed {fmtDateTime(ecn.closedAt)}</div>}
            </div>
          )}
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
                description: description.trim(),
                affectedWork: affectedWork.trim() || null,
                costImpact: costImpact.trim() || null,
                scheduleImpact: scheduleImpact.trim() || null,
                disposition:
                  disposition === NO_DISPOSITION
                    ? null
                    : (disposition as EcnDisposition),
                status,
                affectedRevisionIds: revIds,
              })
            }
            disabled={busy || !description.trim()}
            data-testid="button-save-ecn"
          >
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
