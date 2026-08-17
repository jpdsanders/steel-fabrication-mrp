import { useGetJobCostingReport } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
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
import { DollarSign, Download } from "lucide-react";
import { money, num, csv, downloadCsv } from "./reportUtils";

export default function CostingReport() {
  const { data: report, isLoading } = useGetJobCostingReport();

  const exportReport = () => {
    if (!report) return;
    const lines: string[] = [];
    lines.push("Job Costing / WIP Report");
    lines.push("Job Number,Job Name,Customer,Status,Contract Value,Labor Hours,Labor Cost,Material Consumed,PO Value,Total Cost,WIP");
    for (const j of report.jobs) {
      lines.push([
        csv(j.jobNumber), csv(j.jobName), csv(j.customer), j.status,
        j.contractValue ?? "", j.laborHours, j.laborCost, j.materialConsumedCost,
        j.poValue, j.totalCost, j.wip ?? "",
      ].join(","));
    }
    lines.push(["TOTAL", "", "", "", "", "", report.totals.laborCost, report.totals.materialConsumedCost, report.totals.poValue, report.totals.totalCost, ""].join(","));
    downloadCsv("job-costing-wip.csv", lines);
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <DollarSign className="w-6 h-6" /> Job Costing / WIP
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Labor, consumed material, and committed PO value per job. Labor is costed from the
            company labor-rate table.
          </p>
        </div>
        <Button variant="outline" onClick={exportReport} disabled={!report} data-testid="button-export-costing-csv">
          <Download className="w-4 h-4 mr-1" /> Export CSV
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Contract</TableHead>
                <TableHead className="text-right">Labor h</TableHead>
                <TableHead className="text-right">Labor $</TableHead>
                <TableHead className="text-right">Material $</TableHead>
                <TableHead className="text-right">PO value</TableHead>
                <TableHead className="text-right">Total cost</TableHead>
                <TableHead className="text-right">WIP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(report?.jobs ?? []).map((j) => (
                <TableRow key={j.jobId} data-testid={`costing-${j.jobNumber}`}>
                  <TableCell>
                    {j.jobNumber} <span className="text-muted-foreground">— {j.jobName}</span>
                  </TableCell>
                  <TableCell>{j.customer}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{j.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{money(j.contractValue)}</TableCell>
                  <TableCell className="text-right">{num(j.laborHours)}</TableCell>
                  <TableCell className="text-right">{money(j.laborCost)}</TableCell>
                  <TableCell className="text-right">{money(j.materialConsumedCost)}</TableCell>
                  <TableCell className="text-right">{money(j.poValue)}</TableCell>
                  <TableCell className="text-right">{money(j.totalCost)}</TableCell>
                  <TableCell className="text-right">{money(j.wip)}</TableCell>
                </TableRow>
              ))}
              {(report?.jobs ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-6">
                    {isLoading ? "Loading…" : "No jobs yet."}
                  </TableCell>
                </TableRow>
              )}
              {report && report.jobs.length > 0 && (
                <TableRow className="font-semibold">
                  <TableCell colSpan={5}>Total</TableCell>
                  <TableCell className="text-right">{money(report.totals.laborCost)}</TableCell>
                  <TableCell className="text-right">{money(report.totals.materialConsumedCost)}</TableCell>
                  <TableCell className="text-right">{money(report.totals.poValue)}</TableCell>
                  <TableCell className="text-right" data-testid="costing-total-cost">
                    {money(report.totals.totalCost)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
