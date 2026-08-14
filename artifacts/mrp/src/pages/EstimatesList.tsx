import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useListEstimates,
  useCreateEstimate,
  getListEstimatesQueryKey,
  ListEstimatesStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, Paperclip, X, File as FileIcon } from "lucide-react";
import { useRef } from "react";
import type { DocumentCategory } from "@workspace/api-client-react";
import {
  ACCEPT,
  CATEGORY_LABELS,
  uploadDocumentFile,
} from "@/components/jobs/DocumentsCard";

function inferCategory(filename: string): DocumentCategory {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["dwg", "dxf", "pdf"].includes(ext)) return "drawing";
  if (["jpg", "jpeg", "png"].includes(ext)) return "photo";
  if (["nc1", "nc", "kss", "xml"].includes(ext)) return "nc_data";
  if (["xlsx", "csv"].includes(ext)) return "spreadsheet";
  return "other";
}

export function estimateStatusBadge(status: string) {
  switch (status) {
    case "won":
      return <Badge className="bg-green-600 hover:bg-green-600 text-white">Won</Badge>;
    case "lost":
      return <Badge variant="destructive">Lost</Badge>;
    case "submitted":
      return <Badge variant="default">Submitted</Badge>;
    default:
      return <Badge variant="secondary">Draft</Badge>;
  }
}

export default function EstimatesList() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");

  const queryParams: { search?: string; status?: ListEstimatesStatus } = {};
  if (search) queryParams.search = search;
  if (status && status !== "all") queryParams.status = status as ListEstimatesStatus;

  const { data: estimates, isLoading } = useListEstimates(queryParams);

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Estimates</h1>
          <p className="text-muted-foreground">Bid pipeline — quotes before they become jobs</p>
        </div>
        <NewEstimateDialog />
      </div>

      <div className="flex gap-4 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by bid number, name, or customer..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-estimates"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px]" data-testid="select-estimate-status">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="won">Won</SelectItem>
            <SelectItem value="lost">Lost</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-md bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bid #</TableHead>
              <TableHead>Name / Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Est. Hours</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Job</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">Loading estimates...</TableCell>
              </TableRow>
            ) : estimates?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No estimates found.</TableCell>
              </TableRow>
            ) : (
              estimates?.map((est) => (
                <TableRow key={est.id} className="hover:bg-muted/50 transition-colors" data-testid={`row-estimate-${est.id}`}>
                  <TableCell className="font-medium">
                    <Link href={`/estimates/${est.id}`} className="hover:underline text-primary">
                      {est.bidNumber}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div>{est.name}</div>
                    <div className="text-xs text-muted-foreground">{est.customer}</div>
                  </TableCell>
                  <TableCell>{estimateStatusBadge(est.status)}</TableCell>
                  <TableCell>{est.estimatedHours.toFixed(1)}h</TableCell>
                  <TableCell>{est.amount != null ? `$${est.amount.toLocaleString()}` : "—"}</TableCell>
                  <TableCell>
                    {est.jobId ? (
                      <Link href={`/jobs/${est.jobId}`} className="hover:underline text-primary">
                        {est.jobNumber}
                      </Link>
                    ) : (
                      "—"
                    )}
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

function NewEstimateDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [customer, setCustomer] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [amount, setAmount] = useState("");
  const [bidDate, setBidDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [attachments, setAttachments] = useState<
    { file: File; category: DocumentCategory }[]
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const resetForm = () => {
    setName("");
    setCustomer("");
    setEstimatedHours("");
    setAmount("");
    setBidDate("");
    setDueDate("");
    setNotes("");
    setAttachments([]);
  };

  const createEstimate = useCreateEstimate({
    mutation: {
      onSuccess: async (created) => {
        queryClient.invalidateQueries({ queryKey: getListEstimatesQueryKey() });
        const toUpload = attachments;
        setOpen(false);
        resetForm();
        if (toUpload.length === 0) {
          toast({ title: `Estimate ${created.bidNumber} created` });
          return;
        }
        const failures: string[] = [];
        for (const a of toUpload) {
          const result = await uploadDocumentFile(
            { type: "estimate", id: created.id },
            a.file,
            a.category,
          );
          if (!result.ok) failures.push(a.file.name);
        }
        if (failures.length > 0) {
          toast({
            title: `Estimate ${created.bidNumber} created, but ${failures.length} file${failures.length > 1 ? "s" : ""} failed to upload`,
            description: `${failures.join(", ")} — retry from the estimate page.`,
            variant: "destructive",
          });
        } else {
          toast({
            title: `Estimate ${created.bidNumber} created`,
            description: `${toUpload.length} document${toUpload.length > 1 ? "s" : ""} attached.`,
          });
        }
      },
      onError: () => {
        toast({ title: "Failed to create estimate", variant: "destructive" });
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createEstimate.mutate({
      data: {
        name,
        customer,
        estimatedHours: Number(estimatedHours) || 0,
        amount: amount ? Number(amount) : null,
        bidDate: bidDate || null,
        dueDate: dueDate || null,
        notes: notes || null,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2" data-testid="button-new-estimate"><Plus className="w-4 h-4" /> New Estimate</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Estimate</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">A bid number will be assigned automatically.</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input required value={name} onChange={(e) => setName(e.target.value)} data-testid="input-estimate-name" />
            </div>
            <div className="space-y-2">
              <Label>Customer</Label>
              <Input required value={customer} onChange={(e) => setCustomer(e.target.value)} data-testid="input-estimate-customer" />
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
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5" /> Documents (optional)
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-add-estimate-files"
              >
                Add Files
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) {
                    setAttachments((prev) => [
                      ...prev,
                      ...files.map((file) => ({
                        file,
                        category: inferCategory(file.name),
                      })),
                    ]);
                  }
                  e.target.value = "";
                }}
              />
            </div>
            {attachments.length > 0 && (
              <div className="space-y-2 border rounded-md p-2">
                {attachments.map((a, idx) => (
                  <div key={`${a.file.name}-${idx}`} className="flex items-center gap-2">
                    <FileIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate flex-1" title={a.file.name}>
                      {a.file.name}
                    </span>
                    <Select
                      value={a.category}
                      onValueChange={(val) =>
                        setAttachments((prev) =>
                          prev.map((p, i) =>
                            i === idx ? { ...p, category: val as DocumentCategory } : p,
                          ),
                        )
                      }
                    >
                      <SelectTrigger className="w-[130px] h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(CATEGORY_LABELS) as DocumentCategory[]).map((key) => (
                          <SelectItem key={key} value={key}>
                            {CATEGORY_LABELS[key]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      aria-label={`Remove ${a.file.name}`}
                      onClick={() =>
                        setAttachments((prev) => prev.filter((_, i) => i !== idx))
                      }
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={createEstimate.isPending} data-testid="button-create-estimate">
              {createEstimate.isPending ? "Creating..." : "Create Estimate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
