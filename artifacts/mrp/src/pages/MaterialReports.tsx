import { useState } from "react";
import {
  useGetMaterialMovementsReport,
  getGetMaterialMovementsReportQueryKey,
  useGetInventoryTrendReport,
  getGetInventoryTrendReportQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { TrendingUp, Download, BarChart3 } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function movementBadge(type: string) {
  const map: Record<string, string> = {
    purchased: "bg-blue-600 hover:bg-blue-600",
    received: "bg-green-600 hover:bg-green-600",
    consumed: "bg-orange-600 hover:bg-orange-600",
    transferred: "bg-slate-500 hover:bg-slate-500",
  };
  return <Badge className={map[type] ?? ""}>{type}</Badge>;
}

/** Escape a CSV cell. */
const csv = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default function MaterialReports() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const { data: report } = useGetMaterialMovementsReport(
    { month },
    { query: { enabled: /^\d{4}-\d{2}$/.test(month), queryKey: getGetMaterialMovementsReportQueryKey({ month }) } },
  );
  const { data: trend } = useGetInventoryTrendReport(
    { months: 12 },
    { query: { queryKey: getGetInventoryTrendReportQueryKey({ months: 12 }) } },
  );

  const exportCsv = () => {
    if (!report) return;
    const lines: string[] = [];
    lines.push(`Material Movement Report,${report.month}`);
    lines.push("");
    lines.push("Job Totals");
    lines.push("Job Number,Job Name,Received Cost,Consumed Cost,Movements");
    for (const t of report.jobTotals) {
      lines.push([csv(t.jobNumber ?? "General"), csv(t.jobName), t.receivedCost, t.consumedCost, t.movementCount].join(","));
    }
    lines.push(["TOTAL", "", report.totalReceivedCost, report.totalConsumedCost, ""].join(","));
    lines.push("");
    lines.push("Movements");
    lines.push("Date,Type,Job,PO,Material,Heat #,Pieces,Cost,Notes");
    for (const m of report.movements) {
      lines.push([
        String(m.occurredAt).slice(0, 10),
        m.movementType,
        csv(m.jobNumber),
        csv(m.poNumber),
        csv([m.profileType, m.profileSize, m.grade].filter(Boolean).join(" ")),
        csv(m.heatNumber),
        m.quantity,
        m.totalCost ?? "",
        csv(m.notes),
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `material-movements-${report.month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="w-6 h-6" /> Inventory Reports
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Monthly material movement per job and inventory cost/usage trend
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Monthly material movement</CardTitle>
          <div className="flex items-center gap-3">
            <Label className="text-sm text-muted-foreground">Month</Label>
            <Input type="month" className="w-44" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="input-report-month" />
            <Button variant="outline" onClick={exportCsv} disabled={!report} data-testid="button-export-csv">
              <Download className="w-4 h-4 mr-1" /> Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold mb-2">Cost per job</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Received cost</TableHead>
                  <TableHead>Consumed cost</TableHead>
                  <TableHead>Movements</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(report?.jobTotals ?? []).map((t, i) => (
                  <TableRow key={i} data-testid={`job-total-${t.jobNumber ?? "general"}`}>
                    <TableCell>
                      {t.jobNumber ?? <span className="text-muted-foreground">General stock</span>}
                      {t.jobName && <span className="text-muted-foreground"> — {t.jobName}</span>}
                    </TableCell>
                    <TableCell>{money(t.receivedCost)}</TableCell>
                    <TableCell>{money(t.consumedCost)}</TableCell>
                    <TableCell>{t.movementCount}</TableCell>
                  </TableRow>
                ))}
                {(report?.jobTotals ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      No material movements in {month}.
                    </TableCell>
                  </TableRow>
                )}
                {report && report.jobTotals.length > 0 && (
                  <TableRow className="font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell data-testid="total-received-cost">{money(report.totalReceivedCost)}</TableCell>
                    <TableCell data-testid="total-consumed-cost">{money(report.totalConsumedCost)}</TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {(report?.movements ?? []).length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">All movements</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>PO</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Heat #</TableHead>
                    <TableHead>Pcs</TableHead>
                    <TableHead>Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(report?.movements ?? []).map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>{String(m.occurredAt).slice(0, 10)}</TableCell>
                      <TableCell>{movementBadge(m.movementType)}</TableCell>
                      <TableCell>{m.jobNumber ?? "—"}</TableCell>
                      <TableCell>{m.poNumber ?? "—"}</TableCell>
                      <TableCell>{[m.profileType, m.profileSize, m.grade].filter(Boolean).join(" ") || "—"}</TableCell>
                      <TableCell>{m.heatNumber ?? "—"}</TableCell>
                      <TableCell>{m.quantity}</TableCell>
                      <TableCell>{money(m.totalCost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" /> Inventory cost / usage trend (12 months)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trend ?? []}>
                <XAxis dataKey="month" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
                <Tooltip formatter={(v: number) => money(v)} />
                <Legend />
                <Bar dataKey="receivedCost" name="Received $" fill="#16a34a" />
                <Bar dataKey="consumedCost" name="Consumed $" fill="#ea580c" />
                <Line dataKey="inventoryValue" name="Inventory value $" stroke="#2563eb" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>Received $</TableHead>
                <TableHead>Consumed $</TableHead>
                <TableHead>Received pcs</TableHead>
                <TableHead>Consumed pcs</TableHead>
                <TableHead>Inventory value</TableHead>
                <TableHead>On-hand pcs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(trend ?? []).map((p) => (
                <TableRow key={p.month} data-testid={`trend-${p.month}`}>
                  <TableCell>{p.month}</TableCell>
                  <TableCell>{money(p.receivedCost)}</TableCell>
                  <TableCell>{money(p.consumedCost)}</TableCell>
                  <TableCell>{p.receivedPieces}</TableCell>
                  <TableCell>{p.consumedPieces}</TableCell>
                  <TableCell>{money(p.inventoryValue)}</TableCell>
                  <TableCell>{p.availablePieces}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
