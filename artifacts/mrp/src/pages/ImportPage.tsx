import { useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListEstimates,
  getListEstimatesQueryKey,
  useListJobs,
  getListJobsQueryKey,
  useGetEstimateBom,
  getGetEstimateBomQueryKey,
  useGetJobBom,
  getGetJobBomQueryKey,
  getListJobDocumentsQueryKey,
  type EstimateBomImportPreview,
  type BomView,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { AlertTriangle, ArrowRight, Briefcase, FileText, FileUp, Search, Upload } from "lucide-react";
import {
  EstimateBomImportWizard,
  parseEstimateBomFile,
} from "@/components/estimates/EstimateBomImportWizard";
import { BomSummary, parseBomFile, uploadJobBom } from "@/components/jobs/BomCard";

type DestinationKind = "estimate" | "job";

interface Destination {
  kind: DestinationKind;
  id: number;
  label: string;
  sublabel: string | null;
}

function DestinationPicker({
  kind,
  selected,
  onSelect,
}: {
  kind: DestinationKind;
  selected: Destination | null;
  onSelect: (d: Destination) => void;
}) {
  const [search, setSearch] = useState("");

  const estimateParams: { search?: string } = {};
  if (search && kind === "estimate") estimateParams.search = search;
  const jobParams: { search?: string } = {};
  if (search && kind === "job") jobParams.search = search;

  const { data: estimates, isLoading: estimatesLoading } = useListEstimates(estimateParams, {
    query: { enabled: kind === "estimate", queryKey: getListEstimatesQueryKey(estimateParams) },
  });
  const { data: jobs, isLoading: jobsLoading } = useListJobs(jobParams, {
    query: { enabled: kind === "job", queryKey: getListJobsQueryKey(jobParams) },
  });

  const isLoading = kind === "estimate" ? estimatesLoading : jobsLoading;
  const options: Destination[] =
    kind === "estimate"
      ? (estimates ?? []).map((e: any) => ({
          kind: "estimate" as const,
          id: e.id,
          label: `${e.estimateNumber ?? `#${e.id}`} — ${e.name ?? e.projectName ?? ""}`.trim(),
          sublabel: e.customerName ?? null,
        }))
      : (jobs ?? []).map((j: any) => ({
          kind: "job" as const,
          id: j.id,
          label: `${j.jobNumber ?? `#${j.id}`} — ${j.name ?? ""}`.trim(),
          sublabel: j.customerName ?? null,
        }));

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={kind === "estimate" ? "Search estimates..." : "Search jobs..."}
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-import-destination-search"
        />
      </div>
      <div className="border rounded-md divide-y max-h-72 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground text-center">Loading...</div>
        ) : options.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">
            No {kind === "estimate" ? "estimates" : "jobs"} found.
          </div>
        ) : (
          options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onSelect(o)}
              className={`w-full text-left px-4 py-2.5 text-sm hover:bg-muted/50 flex items-center justify-between gap-2 ${
                selected?.id === o.id && selected.kind === o.kind ? "bg-muted" : ""
              }`}
              data-testid={`option-import-${o.kind}-${o.id}`}
            >
              <span className="truncate">{o.label}</span>
              {o.sublabel && <span className="text-xs text-muted-foreground shrink-0">{o.sublabel}</span>}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export default function ImportPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<DestinationKind>("estimate");
  const [destination, setDestination] = useState<Destination | null>(null);
  const [parsing, setParsing] = useState(false);

  // Estimate flow
  const [estimatePreview, setEstimatePreview] = useState<EstimateBomImportPreview | null>(null);
  const [estimateWizardOpen, setEstimateWizardOpen] = useState(false);

  // Job flow
  const [jobPreview, setJobPreview] = useState<BomView | null>(null);
  const [pendingJobFile, setPendingJobFile] = useState<File | null>(null);
  const [jobConfirmOpen, setJobConfirmOpen] = useState(false);
  const [jobImporting, setJobImporting] = useState(false);
  const [imported, setImported] = useState<Destination | null>(null);

  // The destination a parse/preview was started for. Guards against a parse
  // resolving (or a dialog committing) after the user switched destinations.
  const flowDestinationRef = useRef<Destination | null>(null);

  const resetFlowState = () => {
    flowDestinationRef.current = null;
    setEstimatePreview(null);
    setEstimateWizardOpen(false);
    setJobPreview(null);
    setPendingJobFile(null);
    setJobConfirmOpen(false);
    setImported(null);
  };

  const changeDestination = (d: Destination | null) => {
    resetFlowState();
    setDestination(d);
  };

  const estimateId = destination?.kind === "estimate" ? destination.id : 0;
  const jobId = destination?.kind === "job" ? destination.id : 0;

  const { data: estimateBom } = useGetEstimateBom(estimateId, {
    query: { enabled: estimateId > 0, queryKey: getGetEstimateBomQueryKey(estimateId) },
  });
  const { data: jobBom } = useGetJobBom(jobId, {
    query: { enabled: jobId > 0, queryKey: getGetJobBomQueryKey(jobId) },
  });

  const destinationHasBom =
    destination?.kind === "estimate"
      ? !!estimateBom && estimateBom.assemblyCount > 0
      : !!jobBom && jobBom.assemblyCount > 0;

  const isSameDestination = (a: Destination | null, b: Destination | null) =>
    !!a && !!b && a.kind === b.kind && a.id === b.id;

  const handleFileSelected = async (file: File) => {
    if (!destination) return;
    const startedFor = destination;
    flowDestinationRef.current = startedFor;
    setImported(null);
    setParsing(true);
    try {
      if (startedFor.kind === "estimate") {
        const preview = await parseEstimateBomFile(startedFor.id, file);
        // Ignore results that arrive after the user switched destinations.
        if (!isSameDestination(flowDestinationRef.current, startedFor)) return;
        setEstimatePreview(preview);
        setEstimateWizardOpen(true);
      } else {
        const preview = await parseBomFile(file);
        if (!isSameDestination(flowDestinationRef.current, startedFor)) return;
        setJobPreview(preview);
        setPendingJobFile(file);
        setJobConfirmOpen(true);
      }
    } catch (err) {
      toast({
        title: "Could not read BOM file",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setParsing(false);
    }
  };

  const handleJobImport = async () => {
    if (!pendingJobFile || destination?.kind !== "job") return;
    setJobImporting(true);
    try {
      await uploadJobBom(destination.id, pendingJobFile);
      toast({ title: "BOM imported successfully" });
      queryClient.invalidateQueries({ queryKey: getGetJobBomQueryKey(destination.id) });
      queryClient.invalidateQueries({ queryKey: getListJobDocumentsQueryKey(destination.id) });
      setJobConfirmOpen(false);
      setJobPreview(null);
      setPendingJobFile(null);
      setImported(destination);
    } catch (err) {
      toast({
        title: "Failed to import BOM",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setJobImporting(false);
    }
  };

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Import</h1>
        <p className="text-muted-foreground">
          Bring a bill of materials from your detailing software into an estimate or a job. Supports KISS (.kss) and
          Tekla PowerFab XML (.xml) exports.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Choose a destination</CardTitle>
          <CardDescription>Where should the imported BOM go?</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button
              variant={kind === "estimate" ? "default" : "outline"}
              className="gap-2"
              onClick={() => {
                setKind("estimate");
                changeDestination(null);
              }}
              data-testid="button-import-kind-estimate"
            >
              <FileText className="w-4 h-4" /> Estimate
            </Button>
            <Button
              variant={kind === "job" ? "default" : "outline"}
              className="gap-2"
              onClick={() => {
                setKind("job");
                changeDestination(null);
              }}
              data-testid="button-import-kind-job"
            >
              <Briefcase className="w-4 h-4" /> Job
            </Button>
          </div>
          <DestinationPicker kind={kind} selected={destination} onSelect={(d) => changeDestination(d)} />
          {destination && (
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="secondary" className="gap-1">
                {destination.kind === "estimate" ? <FileText className="w-3 h-3" /> : <Briefcase className="w-3 h-3" />}
                {destination.label}
              </Badge>
              {destinationHasBom && (
                <span className="text-amber-600 flex items-center gap-1 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5" /> Already has a BOM — importing replaces it
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Upload the BOM file</CardTitle>
          <CardDescription>
            KISS (.kss) or Tekla PowerFab XML (.xml). You'll review parsed assemblies and unmatched materials before
            anything is saved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 border-2 border-dashed rounded-md py-10">
            <FileUp className="w-10 h-10 text-muted-foreground/40" />
            <Button
              disabled={!destination || parsing}
              onClick={() => fileInputRef.current?.click()}
              className="gap-2"
              data-testid="button-import-upload"
            >
              <Upload className="w-4 h-4" /> {parsing ? "Parsing..." : "Choose file"}
            </Button>
            {!destination && (
              <p className="text-xs text-muted-foreground">Select a destination above first.</p>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".kss,.xml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelected(file);
              e.target.value = "";
            }}
          />
        </CardContent>
      </Card>

      {imported && (
        <Card className="border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/30">
          <CardContent className="py-4 flex items-center justify-between">
            <div className="text-sm text-green-700 dark:text-green-300">
              BOM imported into {imported.kind === "estimate" ? "estimate" : "job"} {imported.label}.
            </div>
            <Link href={imported.kind === "estimate" ? `/estimates/${imported.id}` : `/jobs/${imported.id}`}>
              <Button variant="outline" size="sm" className="gap-2">
                Open {imported.kind} <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {estimateId > 0 && (
        <EstimateBomImportWizard
          estimateId={estimateId}
          preview={estimatePreview}
          open={estimateWizardOpen}
          replacingExisting={destinationHasBom}
          onClose={() => {
            setEstimateWizardOpen(false);
            setEstimatePreview(null);
          }}
          onImported={() => setImported(destination)}
        />
      )}

      <Dialog
        open={jobConfirmOpen}
        onOpenChange={(o) => {
          if (!o) {
            setJobConfirmOpen(false);
            setJobPreview(null);
            setPendingJobFile(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review parsed BOM</DialogTitle>
          </DialogHeader>
          {destinationHasBom && (
            <div className="bg-destructive/10 text-destructive p-3 rounded-md flex gap-2 text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <div>This job already has a BOM. Importing will replace all existing assemblies and parts.</div>
            </div>
          )}
          {jobPreview && <BomSummary bom={jobPreview} />}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setJobConfirmOpen(false);
                setJobPreview(null);
                setPendingJobFile(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleJobImport} disabled={jobImporting} data-testid="button-import-job-confirm">
              {jobImporting ? "Importing..." : "Import BOM"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
