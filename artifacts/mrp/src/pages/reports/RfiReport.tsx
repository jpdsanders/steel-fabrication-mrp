import { useGetRfiTurnaroundReport } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MessageSquareText } from "lucide-react";
import { num } from "./reportUtils";

function statusBadge(status: string, overdue: boolean) {
  if (overdue) return <Badge className="bg-red-600 hover:bg-red-600">Overdue</Badge>;
  switch (status) {
    case "open":
      return <Badge className="bg-blue-600 hover:bg-blue-600">Open</Badge>;
    case "pending":
      return <Badge className="bg-amber-500 hover:bg-amber-500">Pending</Badge>;
    default:
      return <Badge variant="secondary">Closed</Badge>;
  }
}

export default function RfiReport() {
  const { data: report, isLoading } = useGetRfiTurnaroundReport();
  const s = report?.summary;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageSquareText className="w-6 h-6" /> RFI Turnaround
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Open RFI log and response turnaround — the early-warning signal for stalling jobs
        </p>
      </div>

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold" data-testid="rfi-open-count">{s.openCount}</div>
              <div className="text-sm text-muted-foreground">Open RFIs</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-red-600" data-testid="rfi-overdue-count">{s.overdueCount}</div>
              <div className="text-sm text-muted-foreground">Overdue</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{s.answeredCount}</div>
              <div className="text-sm text-muted-foreground">Answered</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold" data-testid="rfi-avg-turnaround">
                {s.avgTurnaroundDays == null ? "—" : `${num(s.avgTurnaroundDays, 1)} d`}
              </div>
              <div className="text-sm text-muted-foreground">Avg turnaround</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All RFIs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>RFI #</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Question</TableHead>
                <TableHead>Directed to</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Turnaround</TableHead>
                <TableHead className="text-right">Days open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(report?.rfis ?? []).map((r) => (
                <TableRow key={r.id} data-testid={`rfi-row-${r.number}`}>
                  <TableCell>{r.number}</TableCell>
                  <TableCell>
                    {r.jobNumber} <span className="text-muted-foreground">— {r.jobName}</span>
                  </TableCell>
                  <TableCell className="max-w-md truncate">{r.question}</TableCell>
                  <TableCell>{r.directedTo ?? "—"}</TableCell>
                  <TableCell>{statusBadge(r.status, r.overdue)}</TableCell>
                  <TableCell>{r.createdDate}</TableCell>
                  <TableCell>{r.dueDate ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {r.turnaroundDays == null ? "—" : `${r.turnaroundDays} d`}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.daysOpen == null ? "—" : `${r.daysOpen} d`}
                  </TableCell>
                </TableRow>
              ))}
              {(report?.rfis ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-6">
                    {isLoading ? "Loading…" : "No RFIs yet."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
