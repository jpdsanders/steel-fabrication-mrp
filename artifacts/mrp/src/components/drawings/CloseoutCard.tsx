import {
  useGetJobCloseoutPackage,
  getGetJobCloseoutPackageQueryKey,
  getDownloadDrawingRevisionFileUrl,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PackageCheck, Download, AlertTriangle } from "lucide-react";
import { RevisionStatusBadge } from "./RevisionStatusBadge";
import { apiFileUrl } from "./constants";
import { getApiUrl } from "@/lib/api";
import { FileText } from "lucide-react";

export default function CloseoutCard({ jobId }: { jobId: number }) {
  const closeoutQuery = useGetJobCloseoutPackage(jobId, {
    query: {
      enabled: !!jobId,
      queryKey: getGetJobCloseoutPackageQueryKey(jobId),
    },
  });

  const data = closeoutQuery.data;
  const asBuiltCount = data?.asBuiltCount ?? 0;
  const totalDrawings = data?.totalDrawings ?? 0;
  const empty = asBuiltCount === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PackageCheck className="w-5 h-5" /> Closeout Package
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className={`flex items-center gap-2 text-sm font-medium ${
            empty ? "text-amber-600" : ""
          }`}
          data-testid="closeout-summary"
        >
          {empty && <AlertTriangle className="w-4 h-4" />}
          {asBuiltCount} of {totalDrawings} drawings As-Built/Final
        </div>

        <Button variant="outline" size="sm" asChild>
          <a
            href={getApiUrl(`jobs/${jobId}/closeout-report.pdf`)}
            target="_blank"
            rel="noreferrer"
            data-testid="link-closeout-report"
          >
            <FileText className="w-4 h-4 mr-1" /> Closeout Report (PDF)
          </a>
        </Button>

        {data && data.asBuiltDrawings.length > 0 ? (
          <div className="space-y-2">
            {data.asBuiltDrawings.map((d) => (
              <div
                key={d.drawingId}
                className="flex items-center gap-3 border rounded-md px-3 py-2"
                data-testid={`closeout-drawing-${d.drawingId}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                    {d.drawingNumber}
                    <span className="text-xs text-muted-foreground">
                      Rev {d.revision.revisionLabel}
                    </span>
                    <RevisionStatusBadge revision={d.revision} />
                  </div>
                  {d.description && (
                    <div
                      className="text-xs text-muted-foreground truncate"
                      title={d.description}
                    >
                      {d.description}
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  asChild
                  aria-label={`Download ${d.drawingNumber}`}
                >
                  <a
                    href={apiFileUrl(
                      getDownloadDrawingRevisionFileUrl(d.revision.id),
                    )}
                    download={d.revision.documentFilename}
                    data-testid={`link-closeout-download-${d.drawingId}`}
                  >
                    <Download className="w-4 h-4" />
                  </a>
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-4 flex items-center justify-center gap-2">
            <Badge variant="outline" className="text-amber-600 border-amber-300">
              None As-Built
            </Badge>
            No drawings marked As-Built / Final yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
