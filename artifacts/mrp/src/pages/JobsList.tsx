import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  useListJobs, 
  useCreateJob,
  getListJobsQueryKey,
  getGetDashboardJobsQueryKey,
  getGetDashboardSummaryQueryKey,
  ListJobsStatus
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, GripVertical, Trash2, ArrowUp, ArrowDown, Upload, X, Check, FileText } from "lucide-react";
import CustomerPicker from "@/components/CustomerPicker";
import EmployeeMultiSelect from "@/components/EmployeeMultiSelect";
import { BomSummary, parseBomFile, uploadJobBom } from "@/components/jobs/BomCard";
import type { BomView } from "@workspace/api-client-react";
import { useRef } from "react";

export default function JobsList() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("active");

  const queryParams: any = {};
  if (search) queryParams.search = search;
  if (status && status !== "all") queryParams.status = status as ListJobsStatus;

  const { data: jobs, isLoading } = useListJobs(queryParams);

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Jobs</h1>
          <p className="text-muted-foreground">Manage production jobs and routing</p>
        </div>
        <NewJobDialog />
      </div>

      <div className="flex gap-4 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by job number, name, or customer..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
            <SelectItem value="complete">Complete</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-md bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job Number</TableHead>
              <TableHead>Name / Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Due Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">Loading jobs...</TableCell>
              </TableRow>
            ) : jobs?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No jobs found.</TableCell>
              </TableRow>
            ) : (
              jobs?.map((job) => (
                <TableRow key={job.id} className="hover:bg-muted/50 transition-colors">
                  <TableCell className="font-medium">
                    <Link href={`/jobs/${job.id}`} className="hover:underline text-primary">
                      {job.jobNumber}
                    </Link>
                    {job.bidNumber && (
                      <div className="text-xs text-muted-foreground">Bid {job.bidNumber}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div>{job.name}</div>
                    <div className="text-xs text-muted-foreground">{job.customer}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 items-start">
                      <Badge variant={job.status === "active" ? "default" : "secondary"}>
                        {job.status}
                      </Badge>
                      {job.isPastDue && <Badge variant="destructive">Past Due</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="w-[200px]">
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span>{job.percentComplete}%</span>
                        <span>{job.actualHours.toFixed(1)} / {job.estimatedHours.toFixed(1)}h</span>
                      </div>
                      <Progress value={job.percentComplete} />
                    </div>
                  </TableCell>
                  <TableCell>
                    {job.dueDate ? new Date(job.dueDate).toLocaleDateString() : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

const DEFAULT_STAGES = [
  { name: "Estimating", estimatedHours: 2 },
  { name: "Fabrication", estimatedHours: 40 },
  { name: "Welding", estimatedHours: 24 },
  { name: "Paint", estimatedHours: 16 },
  { name: "Inspection", estimatedHours: 4 },
  { name: "Shipping", estimatedHours: 2 }
];

const UPLOAD_ACCEPT = ".kss,.pdf,.dwg,.dxf,.nc1,.nc,.jpg,.jpeg,.png,.xlsx,.csv,.xml";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function documentCategoryFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png"].includes(ext)) return "photo";
  if (["xlsx", "csv"].includes(ext)) return "spreadsheet";
  if (["nc1", "nc", "kss"].includes(ext)) return "nc_data";
  if (["pdf", "dwg", "dxf"].includes(ext)) return "drawing";
  return "other";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function uploadJobDocument(jobId: number, file: File): Promise<void> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("category", documentCategoryFor(file.name));
  const res = await fetch(
    `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/jobs/${jobId}/documents`,
    { method: "POST", body: formData },
  );
  if (!res.ok) {
    let message = "Upload failed";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // keep default
    }
    throw new Error(message);
  }
}

type WizardStep = 1 | 2 | 3;

function NewJobDialog() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>(1);

  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [bomPreview, setBomPreview] = useState<BomView | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [assignedEmployeeIds, setAssignedEmployeeIds] = useState<number[]>([]);
  const [stages, setStages] = useState(DEFAULT_STAGES.map((s, i) => ({ ...s, id: i })));
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const isKiss = !!uploadedFile && uploadedFile.name.toLowerCase().endsWith(".kss");

  const createJob = useCreateJob({
    mutation: {
      onSuccess: async (created) => {
        if (uploadedFile) {
          try {
            if (isKiss) {
              await uploadJobBom(created.id, uploadedFile);
              toast({ title: `Job ${created.jobNumber} created with bill of materials` });
            } else {
              await uploadJobDocument(created.id, uploadedFile);
              toast({ title: `Job ${created.jobNumber} created with document attached` });
            }
          } catch (err) {
            toast({
              title: isKiss
                ? `Job ${created.jobNumber} created, but the BOM import failed`
                : `Job ${created.jobNumber} created, but the document upload failed`,
              description: `${err instanceof Error ? err.message : "Unknown error"} You can retry from the job's detail page.`,
              variant: "destructive",
            });
          }
        } else {
          toast({ title: `Job ${created.jobNumber} created` });
        }
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardJobsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        setOpen(false);
        reset();
      },
      onError: () => {
        toast({ title: "Failed to create job", variant: "destructive" });
      }
    }
  });

  const reset = () => {
    setStep(1);
    setUploadedFile(null);
    setBomPreview(null);
    setUploadError(null);
    setDragOver(false);
    setName("");
    setCustomerId(null);
    setDueDate("");
    setNotes("");
    setAssignedEmployeeIds([]);
    setStages(DEFAULT_STAGES.map((s, i) => ({ ...s, id: i })));
  };

  const handleFileSelected = async (file: File) => {
    setUploadError(null);
    const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
    if (!UPLOAD_ACCEPT.split(",").includes(ext)) {
      setUploadError(`File type "${ext}" is not supported. Allowed types: KISS, PDF, DWG, DXF, NC1, NC, JPG, PNG, XLSX, CSV, XML.`);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError("File is too large. Maximum size is 50 MB.");
      return;
    }
    if (file.name.toLowerCase().endsWith(".kss")) {
      setIsParsing(true);
      try {
        const parsed = await parseBomFile(file);
        setUploadedFile(file);
        setBomPreview(parsed);
        if (parsed.jobName) setName(parsed.jobName);
        else if (parsed.jobRef) setName(parsed.jobRef);
        setStep(2);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Could not read the KISS file.");
      } finally {
        setIsParsing(false);
      }
    } else {
      setUploadedFile(file);
      setBomPreview(null);
      setStep(2);
    }
  };

  const removeFile = () => {
    setUploadedFile(null);
    setBomPreview(null);
    setUploadError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customerId === null) return;
    createJob.mutate({
      data: {
        name,
        customerId,
        dueDate: dueDate || null,
        notes: notes || null,
        assignedEmployeeIds,
        stages: stages.map(s => ({ name: s.name, estimatedHours: Number(s.estimatedHours) || 0 }))
      }
    });
  };

  const addStage = () => {
    setStages([...stages, { id: Math.random(), name: "", estimatedHours: 0 }]);
  };

  const updateStage = (index: number, field: string, value: string | number) => {
    const newStages = [...stages];
    newStages[index] = { ...newStages[index], [field]: value };
    setStages(newStages);
  };

  const removeStage = (index: number) => {
    setStages(stages.filter((_, i) => i !== index));
  };

  const moveStage = (from: number, to: number) => {
    if (to < 0 || to >= stages.length || from === to) return;
    const newStages = [...stages];
    const [moved] = newStages.splice(from, 1);
    newStages.splice(to, 0, moved);
    setStages(newStages);
  };

  const stepLabels = ["Upload", "Review", "Job Details"];

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="w-4 h-4" /> New Job</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Job</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2" aria-label={`Step ${step} of 3: ${stepLabels[step - 1]}`}>
          {stepLabels.map((label, i) => {
            const n = (i + 1) as WizardStep;
            const active = step === n;
            const done = step > n;
            return (
              <div key={label} className="flex items-center gap-2 flex-1">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${
                    active ? "bg-primary text-primary-foreground" : done ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {done ? <Check className="w-3.5 h-3.5" /> : n}
                </div>
                <span className={`text-xs ${active ? "font-medium" : "text-muted-foreground"}`}>{label}</span>
                {i < stepLabels.length - 1 && <div className="flex-1 h-px bg-border" />}
              </div>
            );
          })}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Start by uploading a file for this job. A KISS (.kss) export becomes the
              bill of materials; any other document is attached to the job.
            </p>
            <div
              className={`border-2 border-dashed rounded-md p-8 text-center cursor-pointer transition-colors ${
                dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleFileSelected(file);
              }}
              data-testid="dropzone-job-file"
            >
              <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
              <div className="text-sm font-medium">
                {isParsing ? "Reading file..." : "Drop a file here or click to browse"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                KISS (.kss), PDF, DWG, DXF, NC, XML, images, Excel/CSV — up to 50 MB
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleFileSelected(file);
                e.target.value = "";
              }}
            />
            {uploadError && (
              <p className="text-sm text-destructive" data-testid="text-upload-error">{uploadError}</p>
            )}
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep(3)}
                data-testid="button-skip-upload"
              >
                Skip — create job without a file
              </Button>
            </div>
          </div>
        )}

        {step === 2 && uploadedFile && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 border rounded-md px-3 py-2">
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{uploadedFile.name}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5 uppercase">
                    {uploadedFile.name.split(".").pop() ?? "file"}
                  </Badge>
                  <span>{formatFileSize(uploadedFile.size)}</span>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 text-destructive shrink-0"
                onClick={() => { removeFile(); setStep(1); }}
                data-testid="button-remove-file"
              >
                <X className="w-4 h-4" /> Remove
              </Button>
            </div>

            {bomPreview ? (
              <>
                <p className="text-sm text-muted-foreground">
                  This bill of materials will be imported when the job is created.
                  The original file will also be attached to the job's documents.
                </p>
                <BomSummary bom={bomPreview} compact />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                This file will be attached to the job's documents when the job is created.
              </p>
            )}

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button type="button" onClick={() => setStep(3)} data-testid="button-continue-details">
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <form onSubmit={handleSubmit} className="space-y-6">
            <p className="text-sm text-muted-foreground">A job number will be assigned automatically.</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Customer</Label>
                <CustomerPicker value={customerId} onChange={setCustomerId} />
              </div>
              <div className="space-y-2">
                <Label>Job Name</Label>
                <Input required value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Assigned To</Label>
                <EmployeeMultiSelect value={assignedEmployeeIds} onChange={setAssignedEmployeeIds} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Label>Production Routing</Label>
                <Button type="button" variant="outline" size="sm" onClick={addStage}>
                  <Plus className="w-4 h-4 mr-1" /> Add Stage
                </Button>
              </div>
              <div className="space-y-2 border rounded-md p-2 bg-muted/30">
                {stages.map((stage, idx) => (
                  <div
                    key={stage.id}
                    className={`flex gap-2 items-center bg-background p-2 rounded border ${dragIndex === idx ? "opacity-50 border-dashed" : ""}`}
                    onDragOver={e => {
                      e.preventDefault();
                      if (dragIndex !== null && dragIndex !== idx) {
                        moveStage(dragIndex, idx);
                        setDragIndex(idx);
                      }
                    }}
                    onDrop={e => e.preventDefault()}
                  >
                    <span
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.effectAllowed = "move";
                        setDragIndex(idx);
                      }}
                      onDragEnd={() => setDragIndex(null)}
                      className="shrink-0 cursor-grab active:cursor-grabbing touch-none"
                      aria-label={`Drag to reorder ${stage.name || "stage"}`}
                    >
                      <GripVertical className="w-4 h-4 text-muted-foreground" />
                    </span>
                    <div className="flex flex-col shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        disabled={idx === 0}
                        onClick={() => moveStage(idx, idx - 1)}
                        aria-label="Move stage up"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        disabled={idx === stages.length - 1}
                        onClick={() => moveStage(idx, idx + 1)}
                        aria-label="Move stage down"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </Button>
                    </div>
                    <Input 
                      value={stage.name} 
                      onChange={e => updateStage(idx, "name", e.target.value)}
                      placeholder="Stage Name"
                      className="flex-1"
                      required
                    />
                    <Input 
                      type="number" 
                      value={stage.estimatedHours} 
                      onChange={e => updateStage(idx, "estimatedHours", e.target.value)}
                      placeholder="Est. Hrs"
                      className="w-24"
                    />
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeStage(idx)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {uploadedFile && (
              <p className="text-xs text-muted-foreground">
                {isKiss
                  ? `"${uploadedFile.name}" will be imported as the bill of materials.`
                  : `"${uploadedFile.name}" will be attached to the job's documents.`}
              </p>
            )}

            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(uploadedFile ? 2 : 1)}
              >
                Back
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createJob.isPending || customerId === null} data-testid="button-create-job">
                  {createJob.isPending ? "Creating..." : "Create Job"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
