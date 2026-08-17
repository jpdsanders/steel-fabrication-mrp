import {
  useGetJobHeatSheet,
  getGetJobHeatSheetQueryKey,
} from "@workspace/api-client-react";
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
import { Flame, FileText } from "lucide-react";
import { formatFeetInches } from "@/lib/units";
import { getApiUrl } from "@/lib/api";

/**
 * Job Heat Sheet — the traceability bridge: assembly → part → heat # →
 * vendor/PO → CMTR, per consumption charged to this job. Cross-job remnants
 * show the job they were originally received against.
 */
export default function HeatSheetCard({ jobId }: { jobId: number }) {
  const { data: sheet } = useGetJobHeatSheet(jobId, {
    query: { enabled: !!jobId, queryKey: getGetJobHeatSheetQueryKey(jobId) },
  });

  const entries = sheet?.entries ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Flame className="w-5 h-5" /> Job Heat Sheet
        </CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No material consumed yet. Entries appear here when inventory is consumed on this job.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Assembly</TableHead>
                <TableHead>Part</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Pcs</TableHead>
                <TableHead>Heat #</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>PO #</TableHead>
                <TableHead>CMTR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.movementId} data-testid={`heat-sheet-entry-${e.movementId}`}>
                  <TableCell>{e.assemblyMark ?? "—"}</TableCell>
                  <TableCell>{e.partMark ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {[e.profileType, e.profileSize, e.grade].filter(Boolean).join(" ") || "—"}
                    {e.lengthIn != null && (
                      <span className="text-muted-foreground"> · {formatFeetInches(e.lengthIn)}</span>
                    )}
                  </TableCell>
                  <TableCell>{e.pieces}</TableCell>
                  <TableCell>
                    {e.heatNumber ? <Badge variant="secondary">{e.heatNumber}</Badge> : "—"}
                    {e.originalJobNumber && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {e.isRemnant ? "Remnant from" : "Received on"} job {e.originalJobNumber}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{e.vendorName ?? "—"}</TableCell>
                  <TableCell>{e.poNumber ?? "—"}</TableCell>
                  <TableCell>
                    {e.cmtrDocumentId != null ? (
                      <a
                        href={getApiUrl(`documents/${e.cmtrDocumentId}/download`)}
                        className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                        download={e.cmtrFilename ?? undefined}
                      >
                        <FileText className="w-3.5 h-3.5" /> {e.cmtrFilename ?? "CMTR"}
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
