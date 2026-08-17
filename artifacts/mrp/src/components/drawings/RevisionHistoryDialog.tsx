import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDrawing,
  useUpdateDrawingRevisionStatus,
  getGetDrawingQueryKey,
  getListJobDrawingsQueryKey,
  getDownloadDrawingRevisionFileUrl,
  DrawingRevisionStatus,
  type DrawingListItem,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Download } from "lucide-react";
import { ActiveBadge, RevisionStatusBadge } from "./RevisionStatusBadge";
import {
  REVISION_STATUS_LABELS,
  REVISION_STATUS_ORDER,
  apiFileUrl,
  fmtDate,
  fmtDateTime,
} from "./constants";

export default function RevisionHistoryDialog({
  jobId,
  drawing,
  open,
  onOpenChange,
}: {
  jobId: number;
  drawing: DrawingListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const detailQuery = useGetDrawing(drawing.id, {
    query: {
      enabled: open && !!drawing.id,
      queryKey: getGetDrawingQueryKey(drawing.id),
    },
  });

  const updateStatus = useUpdateDrawingRevisionStatus({
    mutation: {
      onSuccess: () => {
        toast({ title: "Revision status updated" });
        queryClient.invalidateQueries({
          queryKey: getGetDrawingQueryKey(drawing.id),
        });
        queryClient.invalidateQueries({
          queryKey: getListJobDrawingsQueryKey(jobId),
        });
      },
      onError: (error) => {
        const detail =
          (error as { response?: { data?: { error?: string } } })?.response?.data
            ?.error;
        toast({
          title: "Failed to update status",
          description: detail,
          variant: "destructive",
        });
      },
    },
  });

  const revisions = detailQuery.data?.revisions ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {drawing.drawingNumber} — Revision History
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[65vh] overflow-y-auto py-2">
          {detailQuery.isLoading && (
            <div className="text-sm text-muted-foreground text-center py-6">
              Loading revisions…
            </div>
          )}
          {!detailQuery.isLoading && revisions.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-6">
              No revisions found.
            </div>
          )}
          {revisions.map((rev) => (
            <div
              key={rev.id}
              className="border rounded-md p-3 space-y-2"
              data-testid={`revision-${rev.id}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm">Rev {rev.revisionLabel}</span>
                <RevisionStatusBadge revision={rev} />
                {rev.isActive && <ActiveBadge />}
                {rev.acknowledgedByMe && (
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                    Acknowledged
                  </Badge>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <Select
                    value={rev.status}
                    onValueChange={(val) =>
                      updateStatus.mutate({
                        revisionId: rev.id,
                        data: { status: val as DrawingRevisionStatus },
                      })
                    }
                    disabled={updateStatus.isPending}
                  >
                    <SelectTrigger
                      className="h-8 w-[220px]"
                      data-testid={`select-status-${rev.id}`}
                    >
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    asChild
                    aria-label={`Download ${rev.documentFilename}`}
                  >
                    <a
                      href={apiFileUrl(getDownloadDrawingRevisionFileUrl(rev.id))}
                      download={rev.documentFilename}
                      data-testid={`link-download-revision-${rev.id}`}
                    >
                      <Download className="w-4 h-4" />
                    </a>
                  </Button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {rev.changeSummary || "Initial issue"}
              </p>

              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                <span>File: {rev.documentFilename}</span>
                <span>Issued by: {rev.issuedByName || "—"}</span>
                <span>Created: {fmtDate(rev.createdAt)}</span>
                {rev.supersededAt && (
                  <span>Superseded: {fmtDate(rev.supersededAt)}</span>
                )}
              </div>

              {rev.acknowledgments && rev.acknowledgments.length > 0 && (
                <div className="border-t pt-2 mt-1">
                  <div className="text-[11px] font-medium text-muted-foreground mb-1">
                    Acknowledgments
                  </div>
                  <ul className="space-y-0.5">
                    {rev.acknowledgments.map((ack) => (
                      <li
                        key={ack.userId}
                        className="text-xs text-muted-foreground flex justify-between"
                      >
                        <span>{ack.userName}</span>
                        <span>{fmtDateTime(ack.acknowledgedAt)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
