import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListJobDrawings,
  getListJobDrawingsQueryKey,
  getGetJobCloseoutPackageQueryKey,
  DrawingRevisionStatus,
  type DrawingListItem,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useToast } from "@/hooks/use-toast";
import { FileStack, Loader2, Plus, History, GitBranch, Search } from "lucide-react";
import { ActiveBadge, RevisionStatusBadge } from "./RevisionStatusBadge";
import AcknowledgmentGate from "./AcknowledgmentGate";
import RevisionHistoryDialog from "./RevisionHistoryDialog";
import {
  DRAWING_ACCEPT,
  REVISION_STATUS_LABELS,
  REVISION_STATUS_ORDER,
  postMultipart,
} from "./constants";

export default function DrawingsCard({ jobId }: { jobId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const listQueryKey = getListJobDrawingsQueryKey(jobId);

  const drawingsQuery = useListJobDrawings(jobId, {
    query: { enabled: !!jobId, queryKey: listQueryKey },
  });
  const drawings = drawingsQuery.data ?? [];

  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [revisionFor, setRevisionFor] = useState<DrawingListItem | null>(null);
  const [historyFor, setHistoryFor] = useState<DrawingListItem | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return drawings;
    return drawings.filter(
      (d) =>
        d.drawingNumber.toLowerCase().includes(q) ||
        (d.description ?? "").toLowerCase().includes(q),
    );
  }, [drawings, search]);

  const invalidateLists = () => {
    queryClient.invalidateQueries({ queryKey: listQueryKey });
    queryClient.invalidateQueries({
      queryKey: getGetJobCloseoutPackageQueryKey(jobId),
    });
  };

  return (
    <>
      <Card className="relative">
        <CardHeader className="flex flex-row justify-between items-center">
          <CardTitle className="flex items-center gap-2">
            <FileStack className="w-5 h-5" /> Drawings
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                className="h-8 pl-8 pr-3 text-sm rounded-md border border-input bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-44"
                placeholder="Search drawings…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-drawings"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setAddOpen(true)}
              data-testid="button-add-drawing"
            >
              <Plus className="w-4 h-4" /> Add Drawing
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length > 0 ? (
            <div className="space-y-2">
              {filtered.map((drawing) => {
                const active = drawing.activeRevision;
                return (
                  <div
                    key={drawing.id}
                    className="flex items-center gap-3 border rounded-md px-3 py-2"
                    data-testid={`drawing-${drawing.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                        <span>{drawing.drawingNumber}</span>
                        {active && (
                          <>
                            <span className="text-xs text-muted-foreground">
                              Rev {active.revisionLabel}
                            </span>
                            <RevisionStatusBadge revision={active} />
                            <ActiveBadge />
                          </>
                        )}
                      </div>
                      {drawing.description && (
                        <div
                          className="text-xs text-muted-foreground truncate"
                          title={drawing.description}
                        >
                          {drawing.description}
                        </div>
                      )}
                      <div className="text-[11px] text-muted-foreground">
                        {drawing.revisionCount} revision
                        {drawing.revisionCount === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1"
                        onClick={() => setRevisionFor(drawing)}
                        data-testid={`button-new-revision-${drawing.id}`}
                      >
                        <GitBranch className="w-4 h-4" /> New Revision
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1"
                        onClick={() => setHistoryFor(drawing)}
                        data-testid={`button-history-${drawing.id}`}
                      >
                        <History className="w-4 h-4" /> History
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">
              {search.trim()
                ? "No drawings match your search."
                : "No drawings yet. Add a shop drawing to begin revision control."}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Blocking acknowledgment gate — appears automatically when required. */}
      {drawingsQuery.isSuccess && (
        <AcknowledgmentGate jobId={jobId} drawings={drawings} />
      )}

      <AddDrawingDialog
        jobId={jobId}
        open={addOpen}
        onOpenChange={setAddOpen}
        onDone={invalidateLists}
      />

      {revisionFor && (
        <NewRevisionDialog
          drawing={revisionFor}
          open={!!revisionFor}
          onOpenChange={(o) => {
            if (!o) setRevisionFor(null);
          }}
          onDone={invalidateLists}
        />
      )}

      {historyFor && (
        <RevisionHistoryDialog
          jobId={jobId}
          drawing={historyFor}
          open={!!historyFor}
          onOpenChange={(o) => {
            if (!o) setHistoryFor(null);
          }}
        />
      )}
    </>
  );
}

function AddDrawingDialog({
  jobId,
  open,
  onOpenChange,
  onDone,
}: {
  jobId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [drawingNumber, setDrawingNumber] = useState("");
  const [description, setDescription] = useState("");
  const [revisionLabel, setRevisionLabel] = useState("0");
  const [status, setStatus] = useState<DrawingRevisionStatus>(
    "issued_for_approval",
  );
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setDrawingNumber("");
    setDescription("");
    setRevisionLabel("0");
    setStatus("issued_for_approval");
  };

  const submit = async () => {
    if (!file || !drawingNumber.trim()) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("drawingNumber", drawingNumber.trim());
      if (description.trim()) form.append("description", description.trim());
      form.append("revisionLabel", revisionLabel.trim() || "0");
      form.append("status", status);
      const res = await postMultipart(`/api/jobs/${jobId}/drawings`, form);
      if (!res.ok) {
        toast({
          title: res.error ?? "Failed to add drawing",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Drawing added" });
      reset();
      onDone();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
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
          <DialogTitle>Add Drawing</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>File</Label>
            <Input
              type="file"
              accept={DRAWING_ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="input-drawing-file"
            />
          </div>
          <div className="space-y-2">
            <Label>Drawing Number</Label>
            <Input
              value={drawingNumber}
              onChange={(e) => setDrawingNumber(e.target.value)}
              placeholder="D-100"
              data-testid="input-drawing-number"
            />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              data-testid="input-drawing-description"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Revision Label</Label>
              <Input
                value={revisionLabel}
                onChange={(e) => setRevisionLabel(e.target.value)}
                placeholder="0"
                data-testid="input-drawing-revision-label"
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as DrawingRevisionStatus)}
              >
                <SelectTrigger data-testid="select-drawing-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REVISION_STATUS_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {REVISION_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            onClick={submit}
            disabled={busy || !file || !drawingNumber.trim()}
            data-testid="button-submit-drawing"
          >
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Add Drawing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewRevisionDialog({
  drawing,
  open,
  onOpenChange,
  onDone,
}: {
  drawing: DrawingListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const hasActive = !!drawing.activeRevision;
  const [file, setFile] = useState<File | null>(null);
  const [revisionLabel, setRevisionLabel] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [status, setStatus] = useState<DrawingRevisionStatus>(
    "issued_for_approval",
  );
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setRevisionLabel("");
    setChangeSummary("");
    setStatus("issued_for_approval");
  };

  const changeRequired = hasActive;
  const canSubmit =
    !!file &&
    !!revisionLabel.trim() &&
    (!changeRequired || !!changeSummary.trim());

  const submit = async () => {
    if (!canSubmit || !file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("revisionLabel", revisionLabel.trim());
      if (changeSummary.trim())
        form.append("changeSummary", changeSummary.trim());
      form.append("status", status);
      const res = await postMultipart(
        `/api/drawings/${drawing.id}/revisions`,
        form,
      );
      if (!res.ok) {
        toast({
          title: res.error ?? "Failed to add revision",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Revision added" });
      reset();
      onDone();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
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
          <DialogTitle>New Revision — {drawing.drawingNumber}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>File</Label>
            <Input
              type="file"
              accept={DRAWING_ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="input-revision-file"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Revision Label</Label>
              <Input
                value={revisionLabel}
                onChange={(e) => setRevisionLabel(e.target.value)}
                placeholder="A"
                data-testid="input-revision-label"
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as DrawingRevisionStatus)}
              >
                <SelectTrigger data-testid="select-revision-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REVISION_STATUS_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {REVISION_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>
              Change Summary
              {changeRequired && <span className="text-destructive"> *</span>}
            </Label>
            <Textarea
              value={changeSummary}
              onChange={(e) => setChangeSummary(e.target.value)}
              placeholder={
                changeRequired
                  ? "Required — describe what changed from the active revision"
                  : "Optional"
              }
              data-testid="input-revision-change-summary"
            />
            {changeRequired && (
              <p className="text-xs text-muted-foreground">
                A change summary is required because this drawing already has an
                active revision.
              </p>
            )}
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
            onClick={submit}
            disabled={busy || !canSubmit}
            data-testid="button-submit-revision"
          >
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Add Revision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
