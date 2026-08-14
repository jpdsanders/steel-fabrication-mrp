import { useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEstimate,
  useUpdateEstimate,
  useDeleteEstimate,
  useConvertEstimateToJob,
  getGetEstimateQueryKey,
  getListEstimatesQueryKey,
  getListJobsQueryKey,
  getGetDashboardJobsQueryKey,
  getGetDashboardSummaryQueryKey,
  EstimateUpdateStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ChevronLeft, Trash2, Plus, ArrowUp, ArrowDown, Hammer, XCircle, Pencil } from "lucide-react";
import { estimateStatusBadge } from "./EstimatesList";
import DocumentsCard from "@/components/jobs/DocumentsCard";

const DEFAULT_STAGES = [
  { name: "Estimating", estimatedHours: 2 },
  { name: "Fabrication", estimatedHours: 40 },
  { name: "Welding", estimatedHours: 24 },
  { name: "Paint", estimatedHours: 16 },
  { name: "Inspection", estimatedHours: 4 },
  { name: "Shipping", estimatedHours: 2 },
];

export default function EstimateDetail() {
  const [, params] = useRoute("/estimates/:id");
  const [, setLocation] = useLocation();
  const estimateId = Number(params?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: estimate, isLoading } = useGetEstimate(estimateId, {
    query: { enabled: !!estimateId, queryKey: getGetEstimateQueryKey(estimateId) },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetEstimateQueryKey(estimateId) });
    queryClient.invalidateQueries({ queryKey: getListEstimatesQueryKey() });
  };

  const updateEstimate = useUpdateEstimate({
    mutation: {
      onSuccess: () => {
        toast({ title: "Estimate updated" });
        invalidate();
      },
      onError: () => toast({ title: "Failed to update estimate", variant: "destructive" }),
    },
  });

  const deleteEstimate = useDeleteEstimate({
    mutation: {
      onSuccess: () => {
        toast({ title: "Estimate deleted" });
        queryClient.invalidateQueries({ queryKey: getListEstimatesQueryKey() });
        setLocation("/estimates");
      },
      onError: () => toast({ title: "Failed to delete estimate", variant: "destructive" }),
    },
  });

  if (isLoading) {
    return <div className="p-8 space-y-4"><Skeleton className="h-12 w-1/3" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (!estimate) return <div className="p-8">Estimate not found.</div>;

  const isFinal = estimate.status === "won";

  return (
    <div className="p-8 space-y-6 max-w-4xl mx-auto">
      <Button variant="ghost" onClick={() => setLocation("/estimates")} className="gap-2 -ml-4">
        <ChevronLeft className="w-4 h-4" /> Back to Estimates
      </Button>

      <div className="flex justify-between items-start">
        <div>
          <div className="flex gap-3 items-center mb-2">
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-bid-number">{estimate.bidNumber}</h1>
            {estimateStatusBadge(estimate.status)}
          </div>
          <h2 className="text-xl text-muted-foreground">{estimate.name}</h2>
          <p className="text-sm font-medium mt-1">{estimate.customer}</p>
          {estimate.jobId && (
            <p className="text-sm mt-2">
              Converted to job{" "}
              <Link href={`/jobs/${estimate.jobId}`} className="text-primary hover:underline font-medium" data-testid="link-converted-job">
                {estimate.jobNumber}
              </Link>
            </p>
          )}
        </div>

        <div className="flex gap-2">
          {!isFinal && estimate.status !== "lost" && (
            <ConvertDialog estimateId={estimateId} defaultHours={estimate.estimatedHours} />
          )}
          {!isFinal && estimate.status !== "lost" && (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => updateEstimate.mutate({ estimateId, data: { status: EstimateUpdateStatus.lost } })}
              disabled={updateEstimate.isPending}
              data-testid="button-mark-lost"
            >
              <XCircle className="w-4 h-4" /> Mark Lost
            </Button>
          )}
          {!isFinal && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this estimate?</AlertDialogTitle>
                  <AlertDialogDescription>This will permanently delete estimate {estimate.bidNumber}.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => deleteEstimate.mutate({ estimateId })}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Bid Details</CardTitle>
            {!isFinal && <EditEstimateDialog estimate={estimate} onSaved={invalidate} />}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Status</Label>
                <div className="font-medium capitalize">{estimate.status}</div>
              </div>
              <div>
                <Label className="text-muted-foreground">Estimated Hours</Label>
                <div className="font-medium">{estimate.estimatedHours.toFixed(1)}h</div>
              </div>
              <div>
                <Label className="text-muted-foreground">Amount</Label>
                <div className="font-medium">{estimate.amount != null ? `$${estimate.amount.toLocaleString()}` : "—"}</div>
              </div>
              <div>
                <Label className="text-muted-foreground">Bid Date</Label>
                <div className="font-medium">{estimate.bidDate ? new Date(estimate.bidDate).toLocaleDateString() : "—"}</div>
              </div>
              <div>
                <Label className="text-muted-foreground">Target Due Date</Label>
                <div className="font-medium">{estimate.dueDate ? new Date(estimate.dueDate).toLocaleDateString() : "—"}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm whitespace-pre-wrap">{estimate.notes || "No notes"}</div>
          </CardContent>
        </Card>
      </div>

      <DocumentsCard owner={{ type: "estimate", id: estimateId }} />

      {estimate.status === "draft" && (
        <Button
          variant="secondary"
          onClick={() => updateEstimate.mutate({ estimateId, data: { status: EstimateUpdateStatus.submitted } })}
          disabled={updateEstimate.isPending}
          data-testid="button-mark-submitted"
        >
          Mark Submitted
        </Button>
      )}
    </div>
  );
}

function EditEstimateDialog({ estimate, onSaved }: { estimate: { id: number; name: string; customer: string; estimatedHours: number; amount?: number | null; bidDate?: string | null; dueDate?: string | null; notes?: string | null }; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(estimate.name);
  const [customer, setCustomer] = useState(estimate.customer);
  const [estimatedHours, setEstimatedHours] = useState(String(estimate.estimatedHours));
  const [amount, setAmount] = useState(estimate.amount != null ? String(estimate.amount) : "");
  const [bidDate, setBidDate] = useState(estimate.bidDate ?? "");
  const [dueDate, setDueDate] = useState(estimate.dueDate ?? "");
  const [notes, setNotes] = useState(estimate.notes ?? "");
  const { toast } = useToast();

  const updateEstimate = useUpdateEstimate({
    mutation: {
      onSuccess: () => {
        toast({ title: "Estimate updated" });
        onSaved();
        setOpen(false);
      },
      onError: () => toast({ title: "Failed to update estimate", variant: "destructive" }),
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="sm" className="gap-1" onClick={() => setOpen(true)} data-testid="button-edit-estimate">
        <Pencil className="w-3.5 h-3.5" /> Edit
      </Button>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Estimate</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Customer</Label>
            <Input value={customer} onChange={(e) => setCustomer(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Estimated Hours</Label>
            <Input type="number" min="0" step="0.5" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Amount ($)</Label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Bid Date</Label>
            <Input type="date" value={bidDate} onChange={(e) => setBidDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Target Due Date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={() =>
              updateEstimate.mutate({
                estimateId: estimate.id,
                data: {
                  name,
                  customer,
                  estimatedHours: Number(estimatedHours) || 0,
                  amount: amount ? Number(amount) : null,
                  bidDate: bidDate || null,
                  dueDate: dueDate || null,
                  notes: notes || null,
                },
              })
            }
            disabled={updateEstimate.isPending || !name || !customer}
          >
            {updateEstimate.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConvertDialog({ estimateId, defaultHours }: { estimateId: number; defaultHours: number }) {
  const [open, setOpen] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [stages, setStages] = useState(DEFAULT_STAGES.map((s, i) => ({ ...s, id: i })));
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const convert = useConvertEstimateToJob({
    mutation: {
      onSuccess: (job) => {
        toast({ title: `Job ${job.jobNumber} created from estimate` });
        queryClient.invalidateQueries({ queryKey: getGetEstimateQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getListEstimatesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardJobsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        setOpen(false);
        setLocation(`/jobs/${job.id}`);
      },
      onError: () => toast({ title: "Failed to convert estimate", variant: "destructive" }),
    },
  });

  const updateStage = (index: number, field: string, value: string | number) => {
    const next = [...stages];
    next[index] = { ...next[index], [field]: value };
    setStages(next);
  };
  const moveStage = (from: number, to: number) => {
    if (to < 0 || to >= stages.length || from === to) return;
    const next = [...stages];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setStages(next);
  };
  const removeStage = (index: number) => setStages(stages.filter((_, i) => i !== index));
  const addStage = () => setStages([...stages, { id: Math.random(), name: "", estimatedHours: 0 }]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button className="gap-2" onClick={() => setOpen(true)} data-testid="button-convert-to-job">
        <Hammer className="w-4 h-4" /> Mark Won / Convert to Job
      </Button>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Convert Estimate to Job</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            A job number will be assigned automatically. Estimated hours on the bid: {defaultHours.toFixed(1)}h.
          </p>
          <div className="space-y-2 max-w-xs">
            <Label>Due Date (optional, defaults to bid target)</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
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
                <div key={stage.id} className="flex gap-2 items-center bg-background p-2 rounded border">
                  <div className="flex flex-col shrink-0">
                    <Button type="button" variant="ghost" size="icon" className="h-5 w-5" disabled={idx === 0} onClick={() => moveStage(idx, idx - 1)} aria-label="Move stage up">
                      <ArrowUp className="w-3 h-3" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-5 w-5" disabled={idx === stages.length - 1} onClick={() => moveStage(idx, idx + 1)} aria-label="Move stage down">
                      <ArrowDown className="w-3 h-3" />
                    </Button>
                  </div>
                  <Input value={stage.name} onChange={(e) => updateStage(idx, "name", e.target.value)} placeholder="Stage Name" className="flex-1" />
                  <Input type="number" value={stage.estimatedHours} onChange={(e) => updateStage(idx, "estimatedHours", e.target.value)} placeholder="Est. Hrs" className="w-24" />
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeStage(idx)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={() =>
              convert.mutate({
                estimateId,
                data: {
                  dueDate: dueDate || null,
                  stages: stages
                    .filter((s) => s.name.trim())
                    .map((s) => ({ name: s.name, estimatedHours: Number(s.estimatedHours) || 0 })),
                },
              })
            }
            disabled={convert.isPending}
            data-testid="button-confirm-convert"
          >
            {convert.isPending ? "Converting..." : "Convert to Job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
