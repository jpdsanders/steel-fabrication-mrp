import { Link } from "wouter";
import {
  useListDueInLines,
  getListDueInLinesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CalendarClock, PackageMinus, PackageX } from "lucide-react";
import { dueStatusBadge } from "@/components/purchasing/vendorStatus";

function receiptBadge(status: string, remainingPieces: number) {
  if (status === "over") {
    return (
      <Badge variant="destructive" className="gap-1 text-xs">
        <PackageX className="w-3 h-3" /> Over ({Math.abs(remainingPieces)} extra)
      </Badge>
    );
  }
  if (status === "partial") {
    return (
      <Badge variant="outline" className="gap-1 border-amber-500 text-amber-700 dark:text-amber-400 text-xs">
        <PackageMinus className="w-3 h-3" /> Partial
      </Badge>
    );
  }
  return null;
}

export default function DueInCard() {
  const { data: lines, isLoading } = useListDueInLines({
    query: { queryKey: getListDueInLinesQueryKey() },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="w-5 h-5" /> Due In
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : lines && lines.length > 0 ? (
          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO #</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead>Promise date</TableHead>
                  <TableHead>Due status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.lineId} data-testid={`due-in-row-${line.lineId}`}>
                    <TableCell>
                      <Link
                        href={`/purchasing/${line.poId}`}
                        className="font-medium text-primary hover:underline"
                        data-testid={`due-in-po-link-${line.lineId}`}
                      >
                        {line.poNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{line.vendorName ?? "—"}</TableCell>
                    <TableCell>
                      <div className="font-medium">{line.jobNumber}</div>
                      {line.jobName && (
                        <div className="text-xs text-muted-foreground">
                          {line.jobName}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{line.description ?? "—"}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{line.pieces}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className={`font-medium ${(line.remainingPieces ?? line.pieces) < 0 ? "text-destructive" : ""}`}>
                          {line.remainingPieces ?? line.pieces}
                        </span>
                        {receiptBadge(line.receiptStatus ?? "not_received", line.remainingPieces ?? line.pieces)}
                      </div>
                    </TableCell>
                    <TableCell>{line.promiseDate ?? "—"}</TableCell>
                    <TableCell>{dueStatusBadge(line.dueStatus)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No open purchase order lines to track.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
