import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetJobBom,
  getGetJobBomQueryKey,
  getListJobDocumentsQueryKey,
  type BomView,
  type BomAssembly,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight, ClipboardList, Upload } from "lucide-react";
import { formatFeetInches } from "@/lib/units";

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

export async function parseBomFile(file: File): Promise<BomView> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/bom/parse`, {
    method: "POST",
    body: formData,
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error || "Could not parse the file.");
  }
  return body as BomView;
}

export async function uploadJobBom(jobId: number, file: File): Promise<BomView> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/jobs/${jobId}/bom`, {
    method: "POST",
    body: formData,
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error || "Could not import the BOM.");
  }
  return body as BomView;
}

function AssemblyRow({ assembly }: { assembly: BomAssembly }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
        data-testid={`bom-assembly-${assembly.mark}`}
      >
        <TableCell className="w-8 p-2">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="font-medium">{assembly.mark}</TableCell>
        <TableCell>{assembly.description ?? "—"}</TableCell>
        <TableCell>{assembly.finish ?? "—"}</TableCell>
        <TableCell className="text-right">{assembly.quantity}</TableCell>
        <TableCell className="text-right">{assembly.parts.length}</TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/30 p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-10">Part</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead className="text-right">Length</TableHead>
                  <TableHead className="text-right">Qty / asm</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assembly.parts.map((p, i) => (
                  <TableRow key={p.id ?? i}>
                    <TableCell className="pl-10 font-mono text-xs">
                      {p.partMark ?? p.description ?? "—"}
                    </TableCell>
                    <TableCell>{p.profileType ?? "—"}</TableCell>
                    <TableCell>{p.profileSize ?? "—"}</TableCell>
                    <TableCell>{p.grade ?? "—"}</TableCell>
                    <TableCell className="text-right">{formatFeetInches(p.lengthIn)}</TableCell>
                    <TableCell className="text-right">{p.quantity}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function BomSummary({ bom, compact = false }: { bom: BomView; compact?: boolean }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {bom.jobRef && <Badge variant="outline">Job ref {bom.jobRef}</Badge>}
        {bom.jobName && <Badge variant="outline">{bom.jobName}</Badge>}
        <Badge variant="secondary">{bom.assemblyCount} assemblies</Badge>
        <Badge variant="secondary">{bom.partCount} part lines</Badge>
        <Badge variant="secondary">{bom.totalPieces} total pieces</Badge>
      </div>

      {bom.totals.length > 0 && (
        <div>
          <div className="text-sm font-medium mb-2">Material totals</div>
          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead className="text-right">Pieces</TableHead>
                  <TableHead className="text-right">Total length</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bom.totals.map((t, i) => (
                  <TableRow key={i}>
                    <TableCell>{t.profileType ?? "—"}</TableCell>
                    <TableCell>{t.profileSize ?? "—"}</TableCell>
                    <TableCell>{t.grade ?? "—"}</TableCell>
                    <TableCell className="text-right">{t.pieces}</TableCell>
                    <TableCell className="text-right">{formatFeetInches(t.totalLengthIn)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {!compact && (
        <div>
          <div className="text-sm font-medium mb-2">Assemblies</div>
          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Mark</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Finish</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Part lines</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bom.assemblies.map((a, i) => (
                  <AssemblyRow key={a.id ?? i} assembly={a} />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BomCard({ jobId }: { jobId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BomView | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const { data: bom, isLoading } = useGetJobBom(jobId, {
    query: { enabled: !!jobId, queryKey: getGetJobBomQueryKey(jobId) },
  });

  const hasBom = !!bom && bom.assemblyCount > 0;

  const handleFileSelected = async (file: File) => {
    try {
      const parsed = await parseBomFile(file);
      setPendingFile(file);
      setPreview(parsed);
      setConfirmOpen(true);
    } catch (err) {
      toast({
        title: "Could not read KISS file",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const handleImport = async () => {
    if (!pendingFile) return;
    setIsImporting(true);
    try {
      await uploadJobBom(jobId, pendingFile);
      toast({ title: "Bill of materials imported" });
      queryClient.invalidateQueries({ queryKey: getGetJobBomQueryKey(jobId) });
      queryClient.invalidateQueries({ queryKey: getListJobDocumentsQueryKey(jobId) });
      setConfirmOpen(false);
      setPendingFile(null);
      setPreview(null);
    } catch (err) {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row justify-between items-center">
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5" /> Bill of Materials
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => fileInputRef.current?.click()}
          data-testid="button-bom-import"
        >
          <Upload className="w-4 h-4" /> {hasBom ? "Re-import" : "Import KISS file"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".kss"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelected(file);
            e.target.value = "";
          }}
        />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>
        ) : hasBom ? (
          <BomSummary bom={bom} />
        ) : (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No bill of materials imported yet. Import a KISS (.kss) file exported
            from your detailing software to see assemblies, parts, and material totals.
          </div>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!o) { setConfirmOpen(false); setPendingFile(null); setPreview(null); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {hasBom ? "Replace bill of materials?" : "Import bill of materials"}
            </DialogTitle>
          </DialogHeader>
          {hasBom && (
            <p className="text-sm text-destructive">
              This job already has a BOM. Importing will replace all existing
              assemblies and parts with the contents of this file.
            </p>
          )}
          {preview && <BomSummary bom={preview} compact />}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmOpen(false); setPendingFile(null); setPreview(null); }}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={isImporting} data-testid="button-bom-confirm">
              {isImporting ? "Importing..." : hasBom ? "Replace BOM" : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
