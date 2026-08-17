import { Link } from "wouter";
import {
  useGetOutstandingPosReport,
  useGetVendorPerformanceReport,
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
import { ShoppingCart } from "lucide-react";
import { money, num } from "./reportUtils";

function dueBadge(status: string) {
  switch (status) {
    case "overdue":
      return <Badge className="bg-red-600 hover:bg-red-600">Overdue</Badge>;
    case "due_soon":
      return <Badge className="bg-amber-500 hover:bg-amber-500">Due soon</Badge>;
    case "ok":
      return <Badge className="bg-green-600 hover:bg-green-600">OK</Badge>;
    default:
      return <Badge variant="secondary">No date</Badge>;
  }
}

export default function PurchasingReports() {
  const { data: poReport, isLoading: posLoading } = useGetOutstandingPosReport();
  const { data: vendors, isLoading: vendorsLoading } = useGetVendorPerformanceReport();

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShoppingCart className="w-6 h-6" /> Purchasing Reports
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Outstanding POs with due-in status, and vendor delivery performance
        </p>
      </div>

      <Tabs defaultValue="outstanding">
        <TabsList>
          <TabsTrigger value="outstanding" data-testid="tab-outstanding-pos">Outstanding POs</TabsTrigger>
          <TabsTrigger value="vendors" data-testid="tab-vendor-performance">Vendor performance</TabsTrigger>
        </TabsList>

        <TabsContent value="outstanding">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Open purchase orders</CardTitle>
              <div className="text-sm text-muted-foreground">
                {poReport && (
                  <>
                    <span className="font-semibold text-red-600" data-testid="overdue-po-count">
                      {poReport.overdueCount} overdue
                    </span>
                    {" · "}
                    Total open value:{" "}
                    <span className="font-semibold text-foreground">{money(poReport.totalValue)}</span>
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO #</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Promise date</TableHead>
                    <TableHead>Due-in</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(poReport?.pos ?? []).map((p) => (
                    <TableRow key={p.id} data-testid={`outstanding-po-${p.poNumber}`}>
                      <TableCell>
                        <Link href={`/purchasing/${p.id}`} className="text-primary hover:underline">
                          {p.poNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{p.vendorName ?? "—"}</TableCell>
                      <TableCell>
                        {p.jobNumber} <span className="text-muted-foreground">— {p.jobName}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{p.status.replace(/_/g, " ")}</Badge>
                      </TableCell>
                      <TableCell>{p.earliestPromiseDate ?? "—"}</TableCell>
                      <TableCell>{dueBadge(p.dueStatus)}</TableCell>
                      <TableCell className="text-right">{money(p.value)}</TableCell>
                    </TableRow>
                  ))}
                  {(poReport?.pos ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                        {posLoading ? "Loading…" : "No open purchase orders."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vendors">
          <Card>
            <CardHeader>
              <CardTitle>Vendor performance</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                On-time = first receipt on or before the PO's earliest promise date. Vendors with no
                dated, received POs show no on-time rate.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">POs</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">On-time %</TableHead>
                    <TableHead className="text-right">Avg days late</TableHead>
                    <TableHead className="text-right">Total spend</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(vendors ?? []).map((v) => (
                    <TableRow key={v.vendorId} data-testid={`vendor-perf-${v.vendorId}`}>
                      <TableCell>{v.vendorName}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{v.vendorStatus}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{v.poCount}</TableCell>
                      <TableCell className="text-right">{v.receivedPoCount}</TableCell>
                      <TableCell className="text-right">
                        {v.onTimePercent == null ? "—" : `${num(v.onTimePercent, 1)}%`}
                      </TableCell>
                      <TableCell className="text-right">{num(v.avgDaysLate, 1)}</TableCell>
                      <TableCell className="text-right">{money(v.totalSpend)}</TableCell>
                    </TableRow>
                  ))}
                  {(vendors ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                        {vendorsLoading ? "Loading…" : "No vendors yet."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
