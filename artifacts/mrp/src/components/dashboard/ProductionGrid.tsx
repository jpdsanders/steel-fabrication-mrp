import { useLocation } from "wouter";
import type { DashboardJob } from "@workspace/api-client-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

type StageCol = {
  stageId: number;
  label: string;
  stageType: string;
  isGate: boolean;
  isFinal: boolean;
  className: string;
};

function colClass(c: { stageType: string; isGate: boolean; isFinal: boolean }): string {
  if (c.isGate || c.isFinal) return "bg-emerald-50 dark:bg-emerald-950/30";
  if (c.stageType === "vendor") return "bg-amber-50 dark:bg-amber-950/30";
  return "bg-sky-50 dark:bg-sky-950/30";
}

function daysOut(dueDate: string | null | undefined): number | null {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

function statusText(job: DashboardJob): string {
  if (job.status === "complete" || job.status === "closed") return "Complete";
  if (job.status === "on_hold") return "On Hold";
  if ((job.assemblyCount ?? 0) > 0 && job.assemblyGridStatus) {
    return job.assemblyGridStatus;
  }
  return job.assemblyStatus ?? (job.percentComplete > 0 ? "In Progress" : "Not Started");
}

function statusClass(text: string): string {
  switch (text) {
    case "Ready to Ship":
      return "text-green-600 dark:text-green-400";
    case "In Progress":
      return "text-blue-600 dark:text-blue-400";
    case "Complete":
      return "text-muted-foreground";
    case "On Hold":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

function pctDone(job: DashboardJob): number {
  return Math.round(
    (job.assemblyCount ?? 0) > 0
      ? (job.assemblyGridProgressPct ?? job.assemblyProgressPct ?? 0)
      : job.percentComplete,
  );
}

function CountCell({ value, className }: { value: number; className: string }) {
  return (
    <td className={`px-2 py-2.5 text-center text-sm tabular-nums border-l ${className} ${value === 0 ? "text-muted-foreground/50" : "font-semibold"}`}>
      {value}
    </td>
  );
}

export default function ProductionGrid({ jobs }: { jobs: DashboardJob[] }) {
  const [, navigate] = useLocation();

  // The pipeline is company-wide: every job's stage counts carry the same
  // ordered stage list, so derive the columns from the first job that has one.
  const pipeline = jobs.find((j) => j.assemblyStageCounts?.stages?.length)
    ?.assemblyStageCounts?.stages;
  const cols: StageCol[] = (pipeline ?? []).map((s, i, arr) => {
    const meta = {
      stageType: s.stageType,
      isGate: s.isReadyToShipGate,
      isFinal: i === arr.length - 1,
    };
    return {
      stageId: s.stageId,
      label: s.name,
      ...meta,
      className: colClass(meta),
    };
  });
  const vendorCount = cols.filter((c) => c.stageType === "vendor").length;

  return (
    <div className="border rounded-lg bg-card overflow-x-auto">
      <table className="w-full min-w-[1080px] border-collapse" data-testid="production-grid">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
            <th colSpan={6} className="border-b" />
            {cols.length > 0 && (
              <th
                colSpan={cols.length}
                className="px-2 py-1.5 border-b border-l text-center font-semibold bg-sky-100/60 dark:bg-sky-900/20"
              >
                Production Pipeline
                {vendorCount > 0 && (
                  <span className="ml-1 normal-case font-normal">(amber = vendor)</span>
                )}
              </th>
            )}
            <th colSpan={3} className="border-b border-l" />
          </tr>
          <tr className="text-xs text-muted-foreground">
            <th className="px-3 py-2 text-left font-medium">Job</th>
            <th className="px-3 py-2 text-left font-medium">Description</th>
            <th className="px-2 py-2 text-left font-medium">Due Date</th>
            <th className="px-2 py-2 text-center font-medium">Days Out</th>
            <th className="px-2 py-2 text-center font-medium">Total Qty</th>
            <th className="px-2 py-2 text-center font-medium border-l">No Stage</th>
            {cols.map((c) => (
              <th key={c.stageId} className={`px-2 py-2 text-center font-medium border-l ${c.className}`}>
                {c.label}
              </th>
            ))}
            <th className="px-2 py-2 text-center font-medium border-l">On Hold</th>
            <th className="px-2 py-2 text-left font-medium border-l">Status</th>
            <th className="px-3 py-2 text-left font-medium border-l w-[130px]">% Done</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const counts = job.assemblyStageCounts;
            const countByStageId = new Map(
              (counts?.stages ?? []).map((s) => [s.stageId, s.count]),
            );
            const days = daysOut(job.dueDate);
            const status = statusText(job);
            const pct = pctDone(job);
            return (
              <tr
                key={job.id}
                onClick={() => navigate(`/jobs/${job.id}`)}
                className="border-t cursor-pointer hover:bg-accent/50 transition-colors"
                data-testid={`grid-row-${job.id}`}
              >
                <td className="px-3 py-2.5">
                  <div className="font-semibold text-sm whitespace-nowrap">{job.jobNumber}</div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">{job.customer}</div>
                </td>
                <td className="px-3 py-2.5 text-sm max-w-[220px]">
                  <span className="line-clamp-2">{job.name}</span>
                </td>
                <td className="px-2 py-2.5 text-sm whitespace-nowrap">
                  {job.dueDate ?? <span className="text-muted-foreground/50">—</span>}
                </td>
                <td className="px-2 py-2.5 text-center text-sm tabular-nums">
                  {days === null ? (
                    <span className="text-muted-foreground/50">—</span>
                  ) : days < 0 && status !== "Complete" ? (
                    <Badge variant="destructive" className="tabular-nums">{days}</Badge>
                  ) : (
                    days
                  )}
                </td>
                <td className="px-2 py-2.5 text-center text-sm font-semibold tabular-nums">
                  {job.assemblyTotalQty ?? 0}
                </td>
                <td className={`px-2 py-2.5 text-center text-sm tabular-nums border-l ${(counts?.noStage ?? 0) === 0 ? "text-muted-foreground/50" : "font-semibold"}`}>
                  {counts?.noStage ?? 0}
                </td>
                {cols.map((c) => (
                  <CountCell
                    key={c.stageId}
                    value={countByStageId.get(c.stageId) ?? 0}
                    className={c.className}
                  />
                ))}
                <td className={`px-2 py-2.5 text-center text-sm tabular-nums border-l ${(counts?.onHold ?? 0) > 0 ? "font-semibold text-destructive" : "text-muted-foreground/50"}`}>
                  {counts?.onHold ?? 0}
                </td>
                <td className={`px-2 py-2.5 text-sm font-medium whitespace-nowrap border-l ${statusClass(status)}`}>
                  {status}
                </td>
                <td className="px-3 py-2.5 border-l">
                  <div className="flex items-center gap-2">
                    <Progress value={pct} className="h-2 w-16" />
                    <span className="text-xs tabular-nums font-medium w-9 text-right">{pct}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
