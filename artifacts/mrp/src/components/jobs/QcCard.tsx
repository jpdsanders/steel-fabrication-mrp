import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListNcrs,
  getListNcrsQueryKey,
  useCreateNcr,
  useUpdateNcr,
  useListSubstitutionRequests,
  getListSubstitutionRequestsQueryKey,
  useCreateSubstitutionRequest,
  useUpdateSubstitutionRequest,
  type Ncr,
  type SubstitutionRequest,
  type NcrInputSource,
  type SubstitutionRequestInputType,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ShieldAlert, Plus, Replace } from "lucide-react";

const NCR_SOURCE_LABELS: Record<string, string> = {
  receiving: "Receiving",
  in_process: "In-Process",
  final: "Final",
  post_delivery: "Post-Delivery",
};
const DISPOSITION_LABELS: Record<string, string> = {
  rework: "Rework",
  scrap: "Scrap",
  accept_with_deviation: "Accept with Deviation",
};
const SUB_TYPE_LABELS: Record<string, string> = {
  like_for_like: "Like-for-Like",
  equivalent: "Equivalent",
  upgrade: "Upgrade",
  downgrade: "Downgrade",
};

type AssemblyLite = { id: number; mark: string };

function apiError(error: unknown): string | undefined {
  return (error as { response?: { data?: { error?: string } } })?.response?.data
    ?.error;
}

/**
 * Quality — nonconformance reports and material substitution requests for a
 * job. NOTE: the QC data model is a draft pending SME validation.
 */
export default function QcCard({
  jobId,
  assemblies,
}: {
  jobId: number;
  assemblies: AssemblyLite[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5" /> Quality
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="ncrs">
          <TabsList>
            <TabsTrigger value="ncrs" data-testid="tab-ncrs">Nonconformance</TabsTrigger>
            <TabsTrigger value="subs" data-testid="tab-substitutions">Substitutions</TabsTrigger>
          </TabsList>
          <TabsContent value="ncrs" className="mt-4">
            <NcrList jobId={jobId} assemblies={assemblies} />
          </TabsContent>
          <TabsContent value="subs" className="mt-4">
            <SubstitutionList jobId={jobId} assemblies={assemblies} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function AssemblyPicker({
  assemblies,
  value,
  onChange,
}: {
  assemblies: AssemblyLite[];
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  if (assemblies.length === 0) return null;
  return (
    <>
      <Label>Assembly (optional)</Label>
      <Select
        value={value === null ? "none" : String(value)}
        onValueChange={(v) => onChange(v === "none" ? null : Number(v))}
      >
        <SelectTrigger data-testid="select-qc-assembly">
          <SelectValue placeholder="None" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          {assemblies.map((a) => (
            <SelectItem key={a.id} value={String(a.id)}>
              {a.mark}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

// ---------------------------------------------------------------------------
// NCRs
// ---------------------------------------------------------------------------

function NcrList({ jobId, assemblies }: { jobId: number; assemblies: AssemblyLite[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: ncrs } = useListNcrs(
    { jobId },
    { query: { enabled: !!jobId, queryKey: getListNcrsQueryKey({ jobId }) } },
  );
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListNcrsQueryKey({ jobId }) });

  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<string>("in_process");
  const [description, setDescription] = useState("");
  const [assemblyId, setAssemblyId] = useState<number | null>(null);

  const createNcr = useCreateNcr({
    mutation: {
      onSuccess: () => {
        toast({ title: "NCR created" });
        setOpen(false);
        setDescription("");
        setAssemblyId(null);
        invalidate();
      },
      onError: (e) =>
        toast({ title: "Failed to create NCR", description: apiError(e), variant: "destructive" }),
    },
  });
  const updateNcr = useUpdateNcr({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (e) =>
        toast({ title: "Failed to update NCR", description: apiError(e), variant: "destructive" }),
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" data-testid="button-new-ncr">
              <Plus className="w-4 h-4 mr-1" /> New NCR
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Nonconformance Report</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label>Source</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger data-testid="select-ncr-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(NCR_SOURCE_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="What doesn't conform, and where it was found"
                data-testid="input-ncr-description"
              />
              <AssemblyPicker assemblies={assemblies} value={assemblyId} onChange={setAssemblyId} />
            </div>
            <DialogFooter>
              <Button
                disabled={!description.trim() || createNcr.isPending}
                onClick={() =>
                  createNcr.mutate({
                    data: {
                      source: source as NcrInputSource,
                      description: description.trim(),
                      jobId,
                      assemblyId,
                    },
                  })
                }
                data-testid="button-create-ncr"
              >
                Create NCR
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {(ncrs ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="text-no-ncrs">
          No nonconformance reports for this job.
        </p>
      ) : (
        (ncrs ?? []).map((n) => (
          <NcrRow key={n.id} ncr={n} onUpdate={(data) => updateNcr.mutate({ ncrId: n.id, data })} />
        ))
      )}
    </div>
  );
}

function NcrRow({
  ncr: n,
  onUpdate,
}: {
  ncr: Ncr;
  onUpdate: (data: Record<string, unknown>) => void;
}) {
  const [disposition, setDisposition] = useState<string>(n.disposition ?? "");
  const [rootCause, setRootCause] = useState(n.rootCause ?? "");
  const closed = n.status === "closed";

  return (
    <div className="border rounded-lg p-3 space-y-2" data-testid={`ncr-${n.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-sm">{n.number}</span>
        <Badge variant="secondary">{NCR_SOURCE_LABELS[n.source] ?? n.source}</Badge>
        <Badge variant={closed ? "outline" : "destructive"} data-testid={`badge-ncr-status-${n.id}`}>
          {closed ? "Closed" : "Open"}
        </Badge>
        {n.assemblyMark && <Badge variant="outline">Assy {n.assemblyMark}</Badge>}
        {n.disposition && (
          <Badge variant="outline">{DISPOSITION_LABELS[n.disposition] ?? n.disposition}</Badge>
        )}
        {n.approvedByName && (
          <span className="text-xs text-muted-foreground ml-auto">
            Approved by {n.approvedByName}
          </span>
        )}
      </div>
      <p className="text-sm">{n.description}</p>
      {n.rootCause && (
        <p className="text-xs text-muted-foreground">Root cause: {n.rootCause}</p>
      )}
      {!closed && (
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <div className="space-y-1">
            <Label className="text-xs">Disposition</Label>
            <Select value={disposition || undefined} onValueChange={setDisposition}>
              <SelectTrigger className="h-8 w-52" data-testid={`select-ncr-disposition-${n.id}`}>
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DISPOSITION_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 flex-1 min-w-40">
            <Label className="text-xs">Root cause</Label>
            <Input
              className="h-8"
              value={rootCause}
              onChange={(e) => setRootCause(e.target.value)}
              placeholder="For repeat / high-impact issues"
            />
          </div>
          {!n.approvedAt && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onUpdate({
                  approve: true,
                  ...(disposition ? { disposition } : {}),
                  ...(rootCause.trim() !== (n.rootCause ?? "") ? { rootCause: rootCause.trim() || null } : {}),
                })
              }
              data-testid={`button-approve-ncr-${n.id}`}
            >
              Approve
            </Button>
          )}
          <Button
            size="sm"
            disabled={!disposition}
            title={!disposition ? "A disposition is required to close" : undefined}
            onClick={() =>
              onUpdate({
                close: true,
                disposition,
                ...(rootCause.trim() !== (n.rootCause ?? "") ? { rootCause: rootCause.trim() || null } : {}),
              })
            }
            data-testid={`button-close-ncr-${n.id}`}
          >
            Close
          </Button>
        </div>
      )}
      {closed && (
        <Button size="sm" variant="ghost" onClick={() => onUpdate({ reopen: true })} data-testid={`button-reopen-ncr-${n.id}`}>
          Reopen
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Substitution requests
// ---------------------------------------------------------------------------

function SubstitutionList({ jobId, assemblies }: { jobId: number; assemblies: AssemblyLite[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: subs } = useListSubstitutionRequests(
    { jobId },
    { query: { enabled: !!jobId, queryKey: getListSubstitutionRequestsQueryKey({ jobId }) } },
  );
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getListSubstitutionRequestsQueryKey({ jobId }),
    });

  const [open, setOpen] = useState(false);
  const [originalSpec, setOriginalSpec] = useState("");
  const [proposed, setProposed] = useState("");
  const [type, setType] = useState<string>("equivalent");
  const [rationale, setRationale] = useState("");
  const [customerSpecified, setCustomerSpecified] = useState(false);
  const [safetyCritical, setSafetyCritical] = useState(false);
  const [assemblyId, setAssemblyId] = useState<number | null>(null);

  const create = useCreateSubstitutionRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: "Substitution request created" });
        setOpen(false);
        setOriginalSpec(""); setProposed(""); setRationale("");
        setCustomerSpecified(false); setSafetyCritical(false); setAssemblyId(null);
        invalidate();
      },
      onError: (e) =>
        toast({ title: "Failed to create request", description: apiError(e), variant: "destructive" }),
    },
  });
  const update = useUpdateSubstitutionRequest({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (e) =>
        toast({ title: "Failed to update request", description: apiError(e), variant: "destructive" }),
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" data-testid="button-new-substitution">
              <Plus className="w-4 h-4 mr-1" /> New Substitution Request
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Replace className="w-4 h-4" /> Material Substitution Request
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label>Original spec</Label>
              <Input value={originalSpec} onChange={(e) => setOriginalSpec(e.target.value)} placeholder='e.g. W12x26 A992' data-testid="input-sub-original" />
              <Label>Proposed substitution</Label>
              <Input value={proposed} onChange={(e) => setProposed(e.target.value)} placeholder='e.g. W12x30 A992' data-testid="input-sub-proposed" />
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger data-testid="select-sub-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SUB_TYPE_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label>Engineering rationale</Label>
              <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={2} data-testid="input-sub-rationale" />
              <AssemblyPicker assemblies={assemblies} value={assemblyId} onChange={setAssemblyId} />
              <label className="flex items-center gap-2 text-sm pt-1">
                <Checkbox checked={customerSpecified} onCheckedChange={(c) => setCustomerSpecified(!!c)} data-testid="checkbox-customer-specified" />
                Customer-specified material
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={safetyCritical} onCheckedChange={(c) => setSafetyCritical(!!c)} data-testid="checkbox-safety-critical" />
                Safety-critical application
              </label>
              {(customerSpecified || safetyCritical) && (
                <p className="text-xs text-amber-700">
                  Customer concurrence will be required before this request can
                  be approved.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                disabled={!originalSpec.trim() || !proposed.trim() || !rationale.trim() || create.isPending}
                onClick={() =>
                  create.mutate({
                    data: {
                      originalSpec: originalSpec.trim(),
                      proposedSubstitution: proposed.trim(),
                      type: type as SubstitutionRequestInputType,
                      engineeringRationale: rationale.trim(),
                      jobId,
                      assemblyId,
                      customerSpecified,
                      safetyCritical,
                    },
                  })
                }
                data-testid="button-create-substitution"
              >
                Submit Request
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {(subs ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="text-no-substitutions">
          No substitution requests for this job.
        </p>
      ) : (
        (subs ?? []).map((r) => (
          <SubstitutionRow key={r.id} request={r} onUpdate={(data) => update.mutate({ requestId: r.id, data })} />
        ))
      )}
    </div>
  );
}

function SubstitutionRow({
  request: r,
  onUpdate,
}: {
  request: SubstitutionRequest;
  onUpdate: (data: Record<string, unknown>) => void;
}) {
  const pending = r.status === "pending";
  const needsConcurrence =
    (r.customerSpecified || r.safetyCritical) && !r.customerConcurrence;

  return (
    <div className="border rounded-lg p-3 space-y-2" data-testid={`substitution-${r.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-sm">{r.number}</span>
        <Badge variant="secondary">{SUB_TYPE_LABELS[r.type] ?? r.type}</Badge>
        <Badge
          variant={r.status === "approved" ? "default" : r.status === "rejected" ? "destructive" : "outline"}
          data-testid={`badge-sub-status-${r.id}`}
        >
          {r.status}
        </Badge>
        {r.customerSpecified && <Badge variant="outline" className="text-amber-700 border-amber-300">Customer-specified</Badge>}
        {r.safetyCritical && <Badge variant="outline" className="text-red-700 border-red-300">Safety-critical</Badge>}
        {r.customerConcurrence && <Badge variant="outline" className="text-emerald-700 border-emerald-300">Customer concurred</Badge>}
        {r.assemblyMark && <Badge variant="outline">Assy {r.assemblyMark}</Badge>}
      </div>
      <p className="text-sm">
        <span className="line-through text-muted-foreground">{r.originalSpec}</span>
        {" → "}
        <span className="font-medium">{r.proposedSubstitution}</span>
      </p>
      <p className="text-xs text-muted-foreground">{r.engineeringRationale}</p>
      {r.approvedByName && (
        <p className="text-xs text-muted-foreground">
          {r.status === "rejected" ? "Rejected" : "Approved"} by {r.approvedByName}
        </p>
      )}
      {pending && (
        <div className="flex flex-wrap gap-2 pt-1">
          {needsConcurrence && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onUpdate({ customerConcurrence: true })}
              data-testid={`button-record-concurrence-${r.id}`}
            >
              Record Customer Concurrence
            </Button>
          )}
          <Button
            size="sm"
            disabled={needsConcurrence}
            title={needsConcurrence ? "Customer concurrence required first" : undefined}
            onClick={() => onUpdate({ approve: true })}
            data-testid={`button-approve-sub-${r.id}`}
          >
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => onUpdate({ reject: true })} data-testid={`button-reject-sub-${r.id}`}>
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}
