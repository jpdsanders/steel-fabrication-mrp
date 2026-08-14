import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListPurchaseOrders,
  getListPurchaseOrdersQueryKey,
  type ListPurchaseOrdersStatus,
} from "@workspace/api-client-react";
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
import { Search } from "lucide-react";
import { poStatusBadge } from "@/components/purchasing/status";

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
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Purchasing</h1>
        <p className="text-muted-foreground mt-1">
          Materials purchase orders and PM review
        </p>
      </div>

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
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">Pieces</TableHead>
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
                  <TableCell className="font-medium">{po.poNumber}</TableCell>
                  <TableCell>
                    <div className="font-medium">{po.jobNumber}</div>
                    <div className="text-xs text-muted-foreground">{po.jobName}</div>
                  </TableCell>
                  <TableCell>{po.customer}</TableCell>
                  <TableCell className="text-right">{po.lineCount}</TableCell>
                  <TableCell className="text-right">{po.totalPieces}</TableCell>
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
