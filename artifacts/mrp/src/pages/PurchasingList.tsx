import { useState } from "react";
import { useLocation, Link } from "wouter";
import {
  useListPurchaseOrders,
  getListPurchaseOrdersQueryKey,
  type ListPurchaseOrdersStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Settings } from "lucide-react";
import { poStatusBadge } from "@/components/purchasing/status";
import { formatCurrency } from "@/components/purchasing/vendorStatus";
import DueInCard from "@/components/purchasing/DueInCard";

export default function PurchasingList() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");

  const params = {
    ...(status !== "all" ? { status: status as ListPurchaseOrdersStatus } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  };
  const { data: pos, isLoading } = useListPurchaseOrders(params, {
    query: { queryKey: getListPurchaseOrdersQueryKey(params) },
  });

  return (
    <div className="p-8 space-y-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Purchasing</h1>
          <p className="text-muted-foreground mt-1">
            Materials purchase orders and PM review
          </p>
        </div>
        <Link href="/purchasing/settings">
          <Button variant="outline" className="gap-2" data-testid="button-purchasing-settings">
            <Settings className="w-4 h-4" /> Settings
          </Button>
        </Link>
      </div>

      <DueInCard />

      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search PO, job, or customer..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-po-search"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px]" data-testid="select-po-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent for review</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : pos && pos.length > 0 ? (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO #</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">Pieces</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pos.map((po) => (
                <TableRow
                  key={po.id}
                  className="cursor-pointer"
                  onClick={() => setLocation(`/purchasing/${po.id}`)}
                  data-testid={`po-list-row-${po.id}`}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {po.poNumber}
                      {(po.revision ?? 0) > 0 && (
                        <Badge variant="outline" data-testid={`po-revision-${po.id}`}>
                          Rev {po.revision}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{po.jobNumber}</div>
                    <div className="text-xs text-muted-foreground">{po.jobName}</div>
                  </TableCell>
                  <TableCell>{po.vendorName ?? "—"}</TableCell>
                  <TableCell>{po.customer}</TableCell>
                  <TableCell className="text-right">{po.lineCount}</TableCell>
                  <TableCell className="text-right">{po.totalPieces}</TableCell>
                  <TableCell className="text-right">{formatCurrency(po.totalAmount)}</TableCell>
                  <TableCell>{poStatusBadge(po.status)}</TableCell>
                  <TableCell>{new Date(po.createdAt).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="text-center text-muted-foreground py-16 border rounded-md">
          No purchase orders found. Create one from a job's detail page.
        </div>
      )}
    </div>
  );
}
