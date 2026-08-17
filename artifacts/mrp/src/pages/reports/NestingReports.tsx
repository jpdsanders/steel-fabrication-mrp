import { useState } from "react";
import {
  useGetMaterialYieldReport,
  useGetCutListsReport,
  getGetCutListsReportQueryKey,
  useListJobs,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Scissors, Printer } from "lucide-react";
import { money, num, feetIn } from "./reportUtils";

function YieldTab() {
  const { data: report, isLoading } = useGetMaterialYieldReport();
  const t = report?.totals;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Material yield / scrap</CardTitle>
        {t && t.stockLengthIn > 0 && (
          <div className="text-sm text-muted-foreground">
            Overall yield:{" "}
            <span className="font-semibold text-green-700" data-testid="overall-yield">
              {num(t.yieldPercent, 1)}%
            </span>
            {" · "}Scrap: <span className="font-semibold text-red-600">{num(t.scrapPercent, 1)}%</span>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          From accepted nesting plans: stock length vs waste per job and shape.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Shape</TableHead>
              <TableHead className="text-right">Bars</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead className="text-right">Used</TableHead>
              <TableHead className="text-right">Waste</TableHead>
              <TableHead className="text-right">Yield %</TableHead>
              <TableHead className="text-right">Scrap %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(report?.rows ?? []).map((r, i) => (
              <TableRow key={i} data-testid={`yield-${r.jobNumber}-${i}`}>
                <TableCell>
                  {r.jobNumber} <span className="text-muted-foreground">— {r.jobName}</span>
                </TableCell>
                <TableCell>{[r.profileType, r.profileSize, r.grade].join(" ")}</TableCell>
                <TableCell className="text-right">{r.barCount}</TableCell>
                <TableCell className="text-right">{feetIn(r.stockLengthIn)}</TableCell>
                <TableCell className="text-right">{feetIn(r.usedLengthIn)}</TableCell>
                <TableCell className="text-right">{feetIn(r.wasteIn)}</TableCell>
                <TableCell className="text-right text-green-700">{num(r.yieldPercent, 1)}%</TableCell>
                <TableCell className="text-right text-red-600">{num(r.scrapPercent, 1)}%</TableCell>
              </TableRow>
            ))}
            {(report?.rows ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                  {isLoading ? "Loading…" : "No accepted nesting plans yet."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CutListsTab() {
  const { data: jobs } = useListJobs();
  const [jobId, setJobId] = useState<number | null>(null);
  const params = jobId !== null ? { jobId } : undefined;
  const { data: plans, isLoading } = useGetCutListsReport(params, {
    query: { queryKey: getGetCutListsReportQueryKey(params) },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Cut lists</CardTitle>
        <div className="flex items-center gap-3 print:hidden">
          <select
            className="border rounded-md px-3 py-2 text-sm bg-background"
            value={jobId ?? ""}
            onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : null)}
            data-testid="select-cutlist-job"
          >
            <option value="">All jobs</option>
            {(jobs ?? []).map((j) => (
              <option key={j.id} value={j.id}>
                {j.jobNumber} — {j.name}
              </option>
            ))}
          </select>
          <Button variant="outline" onClick={() => window.print()} disabled={(plans ?? []).length === 0} data-testid="button-print-cutlists">
            <Printer className="w-4 h-4 mr-1" /> Print
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-8">
        {(plans ?? []).length === 0 && (
          <p className="text-center text-muted-foreground py-6">
            {isLoading ? "Loading…" : "No accepted nesting plans."}
          </p>
        )}
        {(plans ?? []).map((plan) => (
          <div key={plan.planId} className="space-y-3" data-testid={`cutlist-plan-${plan.planId}`}>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">
                {plan.jobNumber} — {plan.jobName}
              </h3>
              <Badge variant="secondary">Plan #{plan.planId}</Badge>
              {plan.acceptedAt && (
                <span className="text-xs text-muted-foreground">
                  accepted {String(plan.acceptedAt).slice(0, 10)}
                </span>
              )}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bar</TableHead>
                  <TableHead>Shape</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Stock length</TableHead>
                  <TableHead>Cuts</TableHead>
                  <TableHead className="text-right">Drop</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.bars.map((b) => (
                  <TableRow key={b.barNumber}>
                    <TableCell>#{b.barNumber}</TableCell>
                    <TableCell>{[b.profileType, b.profileSize, b.grade].join(" ")}</TableCell>
                    <TableCell>
                      {b.source === "remnant" ? (
                        <Badge className="bg-purple-600 hover:bg-purple-600">Remnant</Badge>
                      ) : (
                        <span>{b.vendorName ?? "Stock"}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{feetIn(b.stockLengthIn)}</TableCell>
                    <TableCell>
                      {b.cuts
                        .map((c) => `${c.quantity}× ${feetIn(c.lengthIn)}${c.label ? ` (${c.label})` : ""}`)
                        .join(", ") || "—"}
                    </TableCell>
                    <TableCell className="text-right">{feetIn(b.wasteIn)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function NestingReports() {
  return (
    <div className="p-8 space-y-6">
      <div className="print:hidden">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Scissors className="w-6 h-6" /> Yield &amp; Cut Lists
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Material yield/scrap tracking and printable cut lists from accepted nesting plans
        </p>
      </div>
      <Tabs defaultValue="yield">
        <TabsList className="print:hidden">
          <TabsTrigger value="yield" data-testid="tab-material-yield">Material yield</TabsTrigger>
          <TabsTrigger value="cutlists" data-testid="tab-cut-lists">Cut lists</TabsTrigger>
        </TabsList>
        <TabsContent value="yield"><YieldTab /></TabsContent>
        <TabsContent value="cutlists"><CutListsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
