import { useRoute, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetJob,
  useUpdateJob,
  useDeleteJob,
  useListTimeEntries,
  getListTimeEntriesQueryKey,
  getGetJobQueryKey,
  getListJobsQueryKey,
  JobUpdateStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, Clock, Pencil, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import DocumentsCard from "@/components/jobs/DocumentsCard";
import DocumentControl from "@/components/drawings/DocumentControl";
import AssemblyTracking, { AssemblyStatusBadge } from "@/components/jobs/AssemblyTracking";
import BomCard from "@/components/jobs/BomCard";
import PurchaseOrdersCard from "@/components/jobs/PurchaseOrdersCard";
import HeatSheetCard from "@/components/jobs/HeatSheetCard";
import CustomerPicker from "@/components/CustomerPicker";
import EmployeeMultiSelect from "@/components/EmployeeMultiSelect";
import NestingCard from "@/components/jobs/NestingCard";
import ShippingCard from "@/components/jobs/ShippingCard";
import QcCard from "@/components/jobs/QcCard";

/**
 * Click-to-edit text: shows the value (with a pencil affordance on hover),
 * switches to an input on click, saves on blur/Enter, cancels on Escape.
 */
function InlineEditableText({
  value,
  onSave,
  placeholder,
  allowEmpty = false,
  className = "",
  inputClassName = "",
  testId,
}: {
  value: string;
  onSave: (next: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  className?: string;
  inputClassName?: string;
  testId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (!allowEmpty && !next) return;
    if (next === value.trim()) return;
    onSave(next);
  };

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder={placeholder}
        className={inputClassName}
        data-testid={`input-${testId}`}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className={`group inline-flex items-center gap-2 text-left rounded-sm hover:bg-muted/60 px-1 -mx-1 ${className}`}
      data-testid={`button-edit-${testId}`}
    >
      <span className={value ? "" : "text-muted-foreground"}>
        {value || placeholder}
      </span>
      <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
    </button>
  );
}

export default function JobDetail() {
  const [, params] = useRoute("/jobs/:id");
  const [, setLocation] = useLocation();
  const jobId = Number(params?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingCustomer, setEditingCustomer] = useState(false);

  const { data: job, isLoading } = useGetJob(jobId, {
    query: { enabled: !!jobId, queryKey: getGetJobQueryKey(jobId) }
  });

  const { data: timeEntries } = useListTimeEntries({ jobId }, {
    query: { enabled: !!jobId, queryKey: getListTimeEntriesQueryKey({ jobId }) }
  });

  const updateJob = useUpdateJob({
    mutation: {
      onSuccess: () => {
        toast({ title: "Job updated" });
        queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
      },
      onError: (error) => {
        const detail =
          (error as { response?: { data?: { error?: string } } })?.response
            ?.data?.error;
        toast({
          title: "Failed to update job",
          description: detail,
          variant: "destructive",
        });
      },
    }
  });

  const deleteJob = useDeleteJob({
    mutation: {
      onSuccess: () => {
        toast({ title: "Job deleted" });
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        setLocation("/jobs");
      }
    }
  });

  if (isLoading) {
    return <div className="p-8 space-y-4"><Skeleton className="h-12 w-1/3" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (!job) return <div className="p-8">Job not found.</div>;

  const hasAssemblies = !!job.bomAssemblies && job.bomAssemblies.length > 0;

  return (
    <div className="p-8 space-y-6 max-w-6xl mx-auto">
      <Button variant="ghost" onClick={() => setLocation("/jobs")} className="gap-2 -ml-4">
        <ChevronLeft className="w-4 h-4" /> Back to Jobs
      </Button>

      <div className="flex justify-between items-start">
        <div>
          <div className="flex gap-3 items-center mb-2">
            <h1 className="text-3xl font-bold tracking-tight">
              <InlineEditableText
                value={job.jobNumber}
                onSave={(jobNumber) => updateJob.mutate({ jobId, data: { jobNumber } })}
                inputClassName="text-3xl font-bold tracking-tight h-11 w-48"
                testId="job-number"
              />
            </h1>
            <Select 
              value={job.status} 
              onValueChange={(val) => updateJob.mutate({ jobId, data: { status: val as JobUpdateStatus } })}
            >
              <SelectTrigger className="w-[140px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            {job.isPastDue && <Badge variant="destructive">Past Due</Badge>}
            {job.assemblyStatus && (
              <AssemblyStatusBadge status={job.assemblyStatus} />
            )}
          </div>
          <h2 className="text-xl text-muted-foreground">
            <InlineEditableText
              value={job.name}
              onSave={(name) => updateJob.mutate({ jobId, data: { name } })}
              inputClassName="text-xl h-9 w-80"
              testId="job-name"
            />
          </h2>
          <div className="flex items-center gap-3 mt-1 text-sm font-medium">
            {editingCustomer ? (
              <div className="flex items-center gap-1 w-72">
                <CustomerPicker
                  value={job.customerId ?? null}
                  onChange={(customerId) => {
                    setEditingCustomer(false);
                    updateJob.mutate({ jobId, data: { customerId } });
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label="Cancel changing customer"
                  onClick={() => setEditingCustomer(false)}
                  data-testid="button-cancel-edit-customer"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <span className="group inline-flex items-center gap-2">
                {job.customerId ? (
                  <Link href={`/customers/${job.customerId}`} className="text-primary hover:underline" data-testid="job-customer-link">
                    {job.customer}
                  </Link>
                ) : (
                  <span>{job.customer}</span>
                )}
                <button
                  type="button"
                  aria-label="Change customer"
                  onClick={() => setEditingCustomer(true)}
                  data-testid="button-edit-job-customer"
                >
                  <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                </button>
              </span>
            )}
            <span className="text-muted-foreground font-normal">
              <InlineEditableText
                value={job.customerPo ?? ""}
                onSave={(customerPo) =>
                  updateJob.mutate({ jobId, data: { customerPo: customerPo || null } })
                }
                allowEmpty
                placeholder="Customer PO #"
                inputClassName="h-7 w-40 text-sm"
                testId="customer-po"
              />
            </span>
          </div>
          {job.bidNumber && job.estimateId && (
            <p className="text-sm mt-1 text-muted-foreground">
              From bid{" "}
              <span
                className="text-primary hover:underline cursor-pointer font-medium"
                onClick={() => setLocation(`/estimates/${job.estimateId}`)}
                data-testid="link-origin-bid"
              >
                {job.bidNumber}
              </span>
            </p>
          )}
        </div>
        
        <div className="flex gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="text-destructive"><Trash2 className="w-4 h-4 mr-2" /> Delete Job</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>This will permanently delete this job and all associated stages and time entries.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => deleteJob.mutate({ jobId })}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Assembly tracking — the primary view when a BOM has been imported */}
      {hasAssemblies && (
        <AssemblyTracking
          assemblies={job.bomAssemblies!}
          jobNumber={job.jobNumber}
          jobId={jobId}
          assemblyStatus={job.assemblyStatus}
          assemblyProgressPct={job.assemblyProgressPct}
        />
      )}

      {!hasAssemblies && (
        <div className="border rounded-lg bg-muted/30 p-4 text-sm text-muted-foreground" data-testid="assembly-empty-state">
          No assemblies imported yet — import a KISS bill of materials below to track each
          assembly's progress through the shop.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Job Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-muted-foreground">Customer</Label>
                <div className="mt-1">
                  <CustomerPicker
                    value={job.customerId ?? null}
                    onChange={(customerId) => updateJob.mutate({ jobId, data: { customerId } })}
                  />
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground">Assigned To</Label>
                <div className="mt-1">
                  <EmployeeMultiSelect
                    value={(job.assignedEmployees ?? []).map((e) => e.id)}
                    onChange={(ids) => updateJob.mutate({ jobId, data: { assignedEmployeeIds: ids } })}
                  />
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground">Due Date</Label>
                <div className="font-medium">{job.dueDate ? new Date(job.dueDate).toLocaleDateString() : "Not set"}</div>
              </div>
              <div>
                <Label className="text-muted-foreground">Notes</Label>
                <div className="text-sm whitespace-pre-wrap">{job.notes || "No notes"}</div>
              </div>
              <div className="pt-4 border-t">
                <Label className="text-muted-foreground">
                  {(job.assemblyCount ?? 0) > 0 ? "Assembly Progress" : "Total Hours"}
                </Label>
                {(job.assemblyCount ?? 0) > 0 ? (
                  <>
                    <div className="text-2xl font-bold">
                      {job.assemblyProgressPct ?? 0}
                      <span className="text-sm font-normal text-muted-foreground">%</span>
                      <span className="text-sm font-normal text-muted-foreground ml-2">
                        ({job.assemblyCount ?? 0} assemblies)
                      </span>
                    </div>
                    <Progress value={job.assemblyProgressPct ?? 0} className="mt-2" />
                  </>
                ) : (
                  <>
                    <div className="text-2xl font-bold">{job.actualHours.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">/ {job.estimatedHours.toFixed(1)} est.</span></div>
                    <Progress value={job.percentComplete} className="mt-2" />
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Clock className="w-5 h-5" /> Recent Time</CardTitle>
            </CardHeader>
            <CardContent>
              {timeEntries && timeEntries.length > 0 ? (
                <div className="space-y-3">
                  {timeEntries.slice(0, 5).map(entry => (
                    <div key={entry.id} className="text-sm flex justify-between items-center border-b pb-2 last:border-0 last:pb-0">
                      <div>
                        <div className="font-medium">{entry.employeeName}</div>
                        <div className="text-xs text-muted-foreground">{entry.stageName}</div>
                      </div>
                      <div className="text-right">
                        <div>{new Date(entry.clockIn).toLocaleDateString()}</div>
                        <div className="font-mono text-xs">
                          {entry.durationMinutes ? `${(entry.durationMinutes / 60).toFixed(1)}h` : <Badge variant="secondary" className="text-[10px] h-4">Active</Badge>}
                        </div>
                      </div>
                    </div>
                  ))}
                  {timeEntries.length > 5 && (
                    <Button variant="link" className="w-full text-xs" onClick={() => setLocation(`/time?jobId=${jobId}`)}>View All</Button>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-4">No time logged yet.</div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <DocumentsCard owner={{ type: "job", id: jobId }} />

          <PurchaseOrdersCard jobId={jobId} />
        </div>
      </div>

      <BomCard jobId={jobId} />

      <NestingCard jobId={jobId} />

      <HeatSheetCard jobId={jobId} />

      <QcCard
        jobId={jobId}
        assemblies={(job.bomAssemblies ?? []).flatMap((a) =>
          a.id != null ? [{ ...a, id: a.id }] : [],
        )}
      />

      <ShippingCard
        jobId={jobId}
        assemblies={(job.bomAssemblies ?? []).flatMap((a) =>
          a.id != null ? [{ ...a, id: a.id }] : [],
        )}
      />

      <DocumentControl jobId={jobId} />
    </div>
  );
}
