import { Badge } from "@/components/ui/badge";
import type { DrawingRevision } from "@workspace/api-client-react";
import { REVISION_STATUS_LABELS } from "./constants";

/** Workflow status badge (or "Superseded" when the revision has been superseded). */
export function RevisionStatusBadge({
  revision,
}: {
  revision: Pick<DrawingRevision, "status" | "supersededAt">;
}) {
  if (revision.supersededAt) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Superseded
      </Badge>
    );
  }
  return <Badge variant="secondary">{REVISION_STATUS_LABELS[revision.status]}</Badge>;
}

export function ActiveBadge() {
  return (
    <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white text-[10px] h-4 px-1.5">
      ACTIVE
    </Badge>
  );
}
