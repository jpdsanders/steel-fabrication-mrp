import { useState } from "react";
import {
  useGetLaborDetailReport,
  getGetLaborDetailReportQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Clock, Download } from "lucide-react";
import { num, csv, downloadCsv } from "./reportUtils";

function firstOfMonth(): string {
  const d = new Date();
  return `${d.toISOString().slice(0, 8)}01`;
}

export default function LaborReport() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const params = { from, to };
  const { data: report, isLoading } = useGetLaborDetailReport(params, {
    query: { queryKey: getGetLaborDetailReportQueryKey(params) },
  });

  const exportReport = () => {
    if (!report) return;
    const lines: string[] = [];
    lines.push(`Labor Detail Report,${from} to ${to}`);
    lines.push("");
    lines.push("Date,Employee,Job,Stage,Clock In,Clock Out,Hours");
    for (const e of report.entries) {
      lines.push(
        [e.date, csv(e.employeeName), csv(`${e.jobNumber} ${e.jobName}`), csv(e.stageName), e.clockIn, e.clockOut, e.hours].join(","),
      );
    }
    lines.push(["TOTAL", "", "", "", "", "", report.totalHours].join(","));
    downloadCsv(`labor-detail-${from}-to-${to}.csv`, lines);
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Clock className="w-6 h-6" /> Labor Detail
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Completed time entries by employee, job, and stage
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="input-labor-from" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} data-testid="input-labor-to" />
          </div>
          <Button variant="outline" onClick={exportReport} disabled={!report} data-testid="button-export-labor-csv">
            <Download className="w-4 h-4 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Hours by employee</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(report?.employeeTotals ?? []).map((t) => (
                  <TableRow key={t.employeeId} data-testid={`labor-employee-${t.employeeId}`}>
                    <TableCell>{t.employeeName}</TableCell>
                    <TableCell className="text-right">{num(t.hours)}</TableCell>
                  </TableRow>
                ))}
                {(report?.employeeTotals ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground py-6">
                      {isLoading ? "Loading…" : "No completed time entries in range."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hours by job</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(report?.jobTotals ?? []).map((t) => (
                  <TableRow key={t.jobId}>
                    <TableCell>
                      {t.jobNumber} <span className="text-muted-foreground">— {t.jobName}</span>
                    </TableCell>
                    <TableCell className="text-right">{num(t.hours)}</TableCell>
                  </TableRow>
                ))}
                {(report?.jobTotals ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground py-6">
                      {isLoading ? "Loading…" : "No completed time entries in range."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Detail</CardTitle>
          <div className="text-sm text-muted-foreground" data-testid="labor-total-hours">
            Total: <span className="font-semibold text-foreground">{num(report?.totalHours)} h</span>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Hours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(report?.entries ?? []).map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.date}</TableCell>
                  <TableCell>{e.employeeName}</TableCell>
                  <TableCell>
                    {e.jobNumber} <span className="text-muted-foreground">— {e.jobName}</span>
                  </TableCell>
                  <TableCell>{e.stageName ?? "—"}</TableCell>
                  <TableCell className="text-right">{num(e.hours)}</TableCell>
                </TableRow>
              ))}
              {(report?.entries ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                    {isLoading ? "Loading…" : "No completed time entries in range."}
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
