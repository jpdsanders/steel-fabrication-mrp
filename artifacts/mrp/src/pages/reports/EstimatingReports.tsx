import { useState } from "react";
import {
  getGetEstimateRecapReportQueryKey,
  useGetEstimateVsActualReport,
  useGetJobMarginReport,
  useGetBidWinLossReport,
  useGetBacklogReport,
  useGetEstimateRecapReport,
  useListEstimates,
} from "@workspace/api-client-react";
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
import { Calculator } from "lucide-react";
import { money, num } from "./reportUtils";

function VarianceCell({ value, invert = false }: { value: number | null | undefined; invert?: boolean }) {
  if (value == null) return <TableCell className="text-right">—</TableCell>;
  const bad = invert ? value < 0 : value > 0;
  return (
    <TableCell className={`text-right ${bad ? "text-red-600" : "text-green-700"}`}>
      {value > 0 ? "+" : ""}
      {num(value)}
    </TableCell>
  );
}

function EstimateVsActualTab() {
  const { data: rows, isLoading } = useGetEstimateVsActualReport();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Estimate vs actual</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Actual cost = labor (company rate table) + consumed material. Cost variance compares
          against the estimate's cost budget (estimated labor + material, before margin); the
          quoted amount is shown separately for reference.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Bid</TableHead>
              <TableHead className="text-right">Est. hours</TableHead>
              <TableHead className="text-right">Actual hours</TableHead>
              <TableHead className="text-right">Hours ±</TableHead>
              <TableHead className="text-right">Est. cost</TableHead>
              <TableHead className="text-right">Actual cost</TableHead>
              <TableHead className="text-right">Cost ±</TableHead>
              <TableHead className="text-right">Quoted $</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((r) => (
              <TableRow key={r.jobId} data-testid={`eva-${r.jobNumber}`}>
                <TableCell>
                  {r.jobNumber} <span className="text-muted-foreground">— {r.jobName}</span>
                </TableCell>
                <TableCell>{r.bidNumber}</TableCell>
                <TableCell className="text-right">{num(r.estimatedHours)}</TableCell>
                <TableCell className="text-right">{num(r.actualHours)}</TableCell>
                <VarianceCell value={r.hoursVariance} />
                <TableCell className="text-right">{money(r.estimatedTotalCost)}</TableCell>
                <TableCell className="text-right">{money(r.actualCost)}</TableCell>
                <VarianceCell value={r.costVariance} />
                <TableCell className="text-right">{money(r.estimateAmount)}</TableCell>
              </TableRow>
            ))}
            {(rows ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-6">
                  {isLoading ? "Loading…" : "No jobs linked to estimates yet."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function JobMarginTab() {
  const { data: rows, isLoading } = useGetJobMarginReport();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Job margin</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Contract</TableHead>
              <TableHead className="text-right">Labor</TableHead>
              <TableHead className="text-right">Material</TableHead>
              <TableHead className="text-right">Margin</TableHead>
              <TableHead className="text-right">Margin %</TableHead>
              <TableHead className="text-right">Est. margin %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((r) => (
              <TableRow key={r.jobId} data-testid={`margin-${r.jobNumber}`}>
                <TableCell>
                  {r.jobNumber} <span className="text-muted-foreground">— {r.jobName}</span>
                </TableCell>
                <TableCell>{r.customer}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{r.jobStatus}</Badge>
                </TableCell>
                <TableCell className="text-right">{money(r.contractValue)}</TableCell>
                <TableCell className="text-right">{money(r.actualLaborCost)}</TableCell>
                <TableCell className="text-right">{money(r.materialCost)}</TableCell>
                <TableCell className={`text-right ${r.margin < 0 ? "text-red-600" : "text-green-700"}`}>
                  {money(r.margin)}
                </TableCell>
                <TableCell className="text-right">
                  {r.marginPercent == null ? "—" : `${num(r.marginPercent, 1)}%`}
                </TableCell>
                <TableCell className="text-right">
                  {r.estimatedMarginPercent == null ? "—" : `${num(r.estimatedMarginPercent, 1)}%`}
                </TableCell>
              </TableRow>
            ))}
            {(rows ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-6">
                  {isLoading ? "Loading…" : "No jobs with contract values yet."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function BidWinLossTab() {
  const { data: report, isLoading } = useGetBidWinLossReport();
  const t = report?.totals;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Bid win/loss</CardTitle>
        {t && (
          <div className="text-sm text-muted-foreground" data-testid="win-rate">
            Win rate:{" "}
            <span className="font-semibold text-foreground">
              {t.winRatePercent == null ? "—" : `${num(t.winRatePercent, 1)}%`}
            </span>
            {" · "}Won {t.wonCount} ({money(t.wonAmount)}) · Lost {t.lostCount} ({money(t.lostAmount)}) ·
            Open {t.openCount} ({money(t.openAmount)})
          </div>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Won</TableHead>
              <TableHead className="text-right">Won $</TableHead>
              <TableHead className="text-right">Lost</TableHead>
              <TableHead className="text-right">Lost $</TableHead>
              <TableHead className="text-right">Open</TableHead>
              <TableHead className="text-right">Open $</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(report?.months ?? []).map((m) => (
              <TableRow key={m.month} data-testid={`winloss-${m.month}`}>
                <TableCell>{m.month}</TableCell>
                <TableCell className="text-right">{m.wonCount}</TableCell>
                <TableCell className="text-right">{money(m.wonAmount)}</TableCell>
                <TableCell className="text-right">{m.lostCount}</TableCell>
                <TableCell className="text-right">{money(m.lostAmount)}</TableCell>
                <TableCell className="text-right">{m.openCount}</TableCell>
                <TableCell className="text-right">{money(m.openAmount)}</TableCell>
              </TableRow>
            ))}
            {(report?.months ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                  {isLoading ? "Loading…" : "No estimates yet."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function BacklogTab() {
  const { data: report, isLoading } = useGetBacklogReport();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Backlog</CardTitle>
        {report && (
          <div className="text-sm text-muted-foreground">
            {report.jobCount} active jobs · Contracted value:{" "}
            <span className="font-semibold text-foreground" data-testid="backlog-total">
              {money(report.totalContractValue)}
            </span>
            {report.unvaluedJobCount > 0 && ` (${report.unvaluedJobCount} without a contract value)`}
          </div>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead>Bid</TableHead>
              <TableHead>Shipping</TableHead>
              <TableHead className="text-right">Contract value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(report?.jobs ?? []).map((j) => (
              <TableRow key={j.jobId} data-testid={`backlog-${j.jobNumber}`}>
                <TableCell>
                  {j.jobNumber} <span className="text-muted-foreground">— {j.jobName}</span>
                </TableCell>
                <TableCell>{j.customer}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{j.status}</Badge>
                </TableCell>
                <TableCell>{j.dueDate ?? "—"}</TableCell>
                <TableCell>{j.bidNumber ?? "—"}</TableCell>
                <TableCell>
                  {j.hasDepartedShipments ? (
                    <Badge className="bg-blue-600 hover:bg-blue-600">Partially shipped</Badge>
                  ) : (
                    <span className="text-muted-foreground">Unshipped</span>
                  )}
                </TableCell>
                <TableCell className="text-right">{money(j.contractValue)}</TableCell>
              </TableRow>
            ))}
            {(report?.jobs ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                  {isLoading ? "Loading…" : "No active jobs."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function EstimateRecapTab() {
  const { data: estimates } = useListEstimates();
  const [estimateId, setEstimateId] = useState<number | null>(null);
  const { data: recap, isLoading } = useGetEstimateRecapReport(estimateId ?? 0, {
    query: { enabled: estimateId !== null, queryKey: getGetEstimateRecapReportQueryKey(estimateId ?? 0) },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Estimate recap</CardTitle>
        <select
          className="border rounded-md px-3 py-2 text-sm bg-background"
          value={estimateId ?? ""}
          onChange={(e) => setEstimateId(e.target.value ? Number(e.target.value) : null)}
          data-testid="select-recap-estimate"
        >
          <option value="">Select an estimate…</option>
          {(estimates ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.bidNumber} — {e.name}
            </option>
          ))}
        </select>
      </CardHeader>
      <CardContent>
        {!recap && (
          <p className="text-center text-muted-foreground py-6">
            {estimateId !== null && isLoading ? "Loading…" : "Choose an estimate to see its recap."}
          </p>
        )}
        {recap && (
          <div className="space-y-6">
            <div className="text-sm text-muted-foreground">
              {recap.bidNumber} — {recap.name} · {recap.customer} ·{" "}
              <Badge variant="secondary">{recap.status}</Badge>
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-2">Material by category</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Line items</TableHead>
                    <TableHead className="text-right">Pieces</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recap.materialCategories.map((c) => (
                    <TableRow key={c.category}>
                      <TableCell>{c.category}</TableCell>
                      <TableCell className="text-right">{c.partCount}</TableCell>
                      <TableCell className="text-right">{c.pieceCount}</TableCell>
                      <TableCell className="text-right">{money(c.cost)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold">
                    <TableCell>Material total</TableCell>
                    <TableCell colSpan={2} />
                    <TableCell className="text-right">{money(recap.materialTotal)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-2">Labor</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trade</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recap.laborLines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell>{l.trade}</TableCell>
                      <TableCell className="text-right">{num(l.hours)}</TableCell>
                      <TableCell className="text-right">{money(l.hourlyRate)}</TableCell>
                      <TableCell className="text-right">{money(l.cost)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold">
                    <TableCell>Labor total</TableCell>
                    <TableCell colSpan={2} />
                    <TableCell className="text-right">{money(recap.laborTotal)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <div className="border-t pt-4 space-y-1 text-sm max-w-sm ml-auto">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{money(recap.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Margin ({num(recap.marginPercent, 1)}%)</span>
                <span>{money(recap.marginAmount)}</span>
              </div>
              <div className="flex justify-between font-semibold text-base">
                <span>Total</span>
                <span data-testid="recap-total">{money(recap.total)}</span>
              </div>
              {recap.quotedAmount != null && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Quoted amount</span>
                  <span>{money(recap.quotedAmount)}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function EstimatingReports() {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Calculator className="w-6 h-6" /> Estimating Reports
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Estimate accuracy, margins, win rate, backlog, and estimate recaps
        </p>
      </div>
      <Tabs defaultValue="eva">
        <TabsList>
          <TabsTrigger value="eva" data-testid="tab-estimate-vs-actual">Estimate vs actual</TabsTrigger>
          <TabsTrigger value="margin" data-testid="tab-job-margin">Job margin</TabsTrigger>
          <TabsTrigger value="winloss" data-testid="tab-bid-win-loss">Bid win/loss</TabsTrigger>
          <TabsTrigger value="backlog" data-testid="tab-backlog">Backlog</TabsTrigger>
          <TabsTrigger value="recap" data-testid="tab-estimate-recap">Estimate recap</TabsTrigger>
        </TabsList>
        <TabsContent value="eva"><EstimateVsActualTab /></TabsContent>
        <TabsContent value="margin"><JobMarginTab /></TabsContent>
        <TabsContent value="winloss"><BidWinLossTab /></TabsContent>
        <TabsContent value="backlog"><BacklogTab /></TabsContent>
        <TabsContent value="recap"><EstimateRecapTab /></TabsContent>
      </Tabs>
    </div>
  );
}
