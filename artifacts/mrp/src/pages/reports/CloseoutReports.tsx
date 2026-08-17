import { Link } from "wouter";
import { useListJobs } from "@workspace/api-client-react";
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
import { FileCheck2, Download } from "lucide-react";
import { getApiUrl } from "@/lib/api";

export default function CloseoutReports() {
  const { data: jobs, isLoading } = useListJobs();

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileCheck2 className="w-6 h-6" /> Traceability / Closeout Packages
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Per-job closeout report: As-Built drawings, heat traceability, and shipment history in one
          PDF. Heat-sheet detail lives on each job's page.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due date</TableHead>
                <TableHead className="text-right">Closeout package</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(jobs ?? []).map((j) => (
                <TableRow key={j.id} data-testid={`closeout-job-${j.jobNumber}`}>
                  <TableCell>
                    <Link href={`/jobs/${j.id}`} className="text-primary hover:underline">
                      {j.jobNumber}
                    </Link>{" "}
                    <span className="text-muted-foreground">— {j.name}</span>
                  </TableCell>
                  <TableCell>{j.customer}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{j.status}</Badge>
                  </TableCell>
                  <TableCell>{j.dueDate ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="outline" size="sm">
                      <a
                        href={getApiUrl(`jobs/${j.id}/closeout-report.pdf`)}
                        target="_blank"
                        rel="noreferrer"
                        data-testid={`button-closeout-pdf-${j.jobNumber}`}
                      >
                        <Download className="w-4 h-4 mr-1" /> PDF
                      </a>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {(jobs ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                    {isLoading ? "Loading…" : "No jobs yet."}
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
