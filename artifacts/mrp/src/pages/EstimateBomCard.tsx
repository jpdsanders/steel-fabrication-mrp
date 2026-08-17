import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEstimateBom,
  getGetEstimateBomQueryKey,
  useCommitEstimateBomImport,
  useCreateEstimateBomAssembly,
  useUpdateEstimateBomAssembly,
  useDeleteEstimateBomAssembly,
  useCreateEstimateBomPart,
  useUpdateEstimateBomPart,
  useDeleteEstimateBomPart,
  getGetEstimatePricingQueryKey,
  getGetEstimateRfqQueryKey,
  type EstimateBomView,
  type EstimateBomAssembly,
  type EstimateBomPart,
  type EstimateBomMaterialMatch,
  type EstimateBomImportPreview,
  type EstimateBomMaterialResolution,
  EstimateBomMaterialResolutionAction,
  EstimateBomPartUpdatePricingStatus
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight, ClipboardList, Upload, AlertTriangle, CheckCircle2, Download, Plus, Pencil, Trash2 } from "lucide-react";
import { formatFeetInches } from "@/lib/units";
import { getApiUrl } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export async function parseEstimateBomFile(estimateId: number, file: File): Promise<EstimateBomImportPreview> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(getApiUrl(`estimates/${estimateId}/bom/parse`), {
    method: "POST",
    body: formData,
    credentials: "include"
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error || "Could not parse the file.");
  }
  return body as EstimateBomImportPreview;
}

function AssemblyRow({ estimateId, assembly }: { estimateId: number, assembly: EstimateBomAssembly }) {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
      >
        <TableCell className="w-8 p-2" onClick={() => setExpanded(!expanded)}>
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="font-medium" onClick={() => setExpanded(!expanded)}>{assembly.mark}</TableCell>
        <TableCell onClick={() => setExpanded(!expanded)}>{assembly.description ?? "—"}</TableCell>
        <TableCell onClick={() => setExpanded(!expanded)}>{assembly.finish ?? "—"}</TableCell>
        <TableCell className="text-right" onClick={() => setExpanded(!expanded)}>{assembly.quantity}</TableCell>
        <TableCell className="text-right" onClick={() => setExpanded(!expanded)}>{assembly.parts.length}</TableCell>
        <TableCell className="text-right space-x-2">
          <EditAssemblyDialog estimateId={estimateId} assembly={assembly} />
          <DeleteAssemblyButton estimateId={estimateId} assemblyId={assembly.id} />
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/30 p-0 relative">
            <div className="p-2 flex justify-end">
               <AddPartDialog estimateId={estimateId} assemblyId={assembly.id} />
            </div>
            {assembly.parts.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-10">Part</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Grade</TableHead>
                    <TableHead className="text-right">Length</TableHead>
                    <TableHead className="text-right">Qty / asm</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ext. Cost</TableHead>
                    <TableHead className="w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assembly.parts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="pl-10 font-mono text-xs">
                        {p.partMark ?? p.description ?? "—"}
                        {p.isMisc && <Badge variant="secondary" className="ml-2 text-[10px] px-1 py-0 h-4">Misc</Badge>}
                      </TableCell>
                      <TableCell>{p.profileType ?? "—"}</TableCell>
                      <TableCell>{p.profileSize ?? "—"}</TableCell>
                      <TableCell>{p.grade ?? "—"}</TableCell>
                      <TableCell className="text-right">{formatFeetInches(p.lengthIn)}</TableCell>
                      <TableCell className="text-right">{p.quantity}</TableCell>
                      <TableCell>
                        {p.pricingStatus === 'matched' ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-900">Catalog</Badge>
                        ) : p.pricingStatus === 'needs_quote' ? (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900">Needs Quote</Badge>
                        ) : (
                          <Badge variant="outline">Manual</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {p.lineCost != null ? `$${p.lineCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <EditPartDialog estimateId={estimateId} assemblyId={assembly.id} part={p} />
                        <DeletePartButton estimateId={estimateId} partId={p.id} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
               <div className="pb-4 text-center text-sm text-muted-foreground">No parts in this assembly.</div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function AddAssemblyDialog({ estimateId }: { estimateId: number }) {
  const [open, setOpen] = useState(false);
  const [mark, setMark] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [description, setDescription] = useState("");
  const [finish, setFinish] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const create = useCreateEstimateBomAssembly({
    mutation: {
      onSuccess: () => {
        toast({ title: "Assembly added" });
        queryClient.invalidateQueries({ queryKey: getGetEstimateBomQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getGetEstimatePricingQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getGetEstimateRfqQueryKey(estimateId) });
        setOpen(false);
        setMark("");
        setQuantity("1");
        setDescription("");
        setFinish("");
      },
      onError: (err) => toast({ title: "Failed to add assembly", description: err instanceof Error ? err.message : undefined, variant: "destructive" })
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2"><Plus className="w-4 h-4" /> Add Assembly</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Assembly</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-2">
            <Label>Mark</Label>
            <Input value={mark} onChange={(e) => setMark(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Quantity</Label>
            <Input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="space-y-2 col-span-2">
            <Label>Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-2 col-span-2">
            <Label>Finish (optional)</Label>
            <Input value={finish} onChange={(e) => setFinish(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button 
            onClick={() => create.mutate({ estimateId, data: { mark, quantity: Number(quantity) || 1, description: description || null, finish: finish || null }})}
            disabled={create.isPending || !mark}
          >
            {create.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditAssemblyDialog({ estimateId, assembly }: { estimateId: number, assembly: EstimateBomAssembly }) {
  const [open, setOpen] = useState(false);
  const [mark, setMark] = useState(assembly.mark);
  const [quantity, setQuantity] = useState(String(assembly.quantity));
  const [description, setDescription] = useState(assembly.description || "");
  const [finish, setFinish] = useState(assembly.finish || "");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const update = useUpdateEstimateBomAssembly({
    mutation: {
      onSuccess: () => {
        toast({ title: "Assembly updated" });
        queryClient.invalidateQueries({ queryKey: getGetEstimateBomQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getGetEstimatePricingQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getGetEstimateRfqQueryKey(estimateId) });
        setOpen(false);
      },
      onError: (err) => toast({ title: "Failed to update assembly", description: err instanceof Error ? err.message : undefined, variant: "destructive" })
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8"><Pencil className="w-4 h-4" /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Assembly</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-2">
            <Label>Mark</Label>
            <Input value={mark} onChange={(e) => setMark(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Quantity</Label>
            <Input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="space-y-2 col-span-2">
            <Label>Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-2 col-span-2">
            <Label>Finish (optional)</Label>
            <Input value={finish} onChange={(e) => setFinish(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button 
            onClick={() => update.mutate({ assemblyId: assembly.id, data: { mark, quantity: Number(quantity) || 1, description: description || null, finish: finish || null }})}
            disabled={update.isPending || !mark}
          >
            {update.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteAssemblyButton({ estimateId, assemblyId }: { estimateId: number, assemblyId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const del = useDeleteEstimateBomAssembly({
    mutation: {
      onSuccess: () => {
        toast({ title: "Assembly deleted" });
        queryClient.invalidateQueries({ queryKey: getGetEstimateBomQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getGetEstimatePricingQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getGetEstimateRfqQueryKey(estimateId) });
      },
      onError: () => toast({ title: "Failed to delete assembly", variant: "destructive" })
    }
  });

  return (
    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={(e) => { e.stopPropagation(); if (confirm('Delete this assembly and all its parts?')) { del.mutate({ assemblyId }); } }} disabled={del.isPending}>
      <Trash2 className="w-4 h-4" />
    </Button>
  );
}

function AddPartDialog({ estimateId, assemblyId }: { estimateId: number, assemblyId: number }) {
  const [open, setOpen] = useState(false);
  const [partMark, setPartMark] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [profileType, setProfileType] = useState("");
  const [profileSize, setProfileSize] = useState("");
  const [grade, setGrade] = useState("");
  const [lengthIn, setLengthIn] = useState("");
  const [description, setDescription] = useState("");
  const [isMisc, setIsMisc] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const create = useCreateEstimateBomPart({
    mutation: {
      onSuccess: (createdPart) => {
        toast({ title: `Part added (${createdPart.pricingStatus})` });
        queryClient.invalidateQueries({ queryKey: getGetEstimateBomQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getGetEstimatePricingQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getGetEstimateRfqQueryKey(estimateId) });
        setOpen(false);
        setPartMark("");
        setQuantity("1");
        setProfileType("");
        setProfileSize("");
        setGrade("");
        setLengthIn("");
        setDescription("");
        setIsMisc(false);
      },
      onError: (err) => toast({ title: "Failed to add part", description: err instanceof Error ? err.message : undefined, variant: "destructive" })
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2"><Plus className="w-4 h-4" /> Add Part</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add Part</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-4 py-2">
          <div className="space-y-2">
            <Label>Part Mark</Label>
            <Input value={partMark} onChange={(e) => setPartMark(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Quantity (per assembly)</Label>
            <Input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Length (inches)</Label>
            <Input type="number" min="0" step="0.001" value={lengthIn} onChange={(e) => setLengthIn(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Profile Type (e.g. W)</Label>
            <Input value={profileType} onChange={(e) => setProfileType(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Profile Size (e.g. 10X30)</Label>
            <Input value={profileSize} onChange={(e) => setProfileSize(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Grade (e.g. A992)</Label>
            <Input value={grade} onChange={(e) => setGrade(e.target.value)} />
          </div>
          <div className="space-y-2 col-span-3">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-2 col-span-3 flex items-center gap-2 mt-2">
            <Checkbox id={`misc-new`} checked={isMisc} onCheckedChange={(c) => setIsMisc(!!c)} />
            <Label htmlFor={`misc-new`} className="font-normal cursor-pointer">Misc / Hardware (always include in RFQ)</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button 
            onClick={() => create.mutate({ assemblyId, data: { 
              partMark: partMark || null, 
              quantity: Number(quantity) || 1, 
              profileType: profileType || null, 
              profileSize: profileSize || null, 
              grade: grade || null, 
              lengthIn: lengthIn ? Number(lengthIn) : null, 
              description: description || null,
              isMisc 
            }})}
            disabled={create.isPending || (!partMark && !description)}
          >
            {create.isPending ? "Adding..." : "Add Part"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditPartDialog({ estimateId, assemblyId, part }: { estimateId: number, assemblyId: number, part: EstimateBomPart }) {
  const [open, setOpen] = useState(false);
  const [partMark, setPartMark] = useState(part.partMark || "");
  const [quantity, setQuantity] = useState(String(part.quantity));
  const [profileType, setProfileType] = useState(part.profileType || "");
  const [profileSize, setProfileSize] = useState(part.profileSize || "");
  const [grade, setGrade] = useState(part.grade || "");
  const [lengthIn, setLengthIn] = useState(part.lengthIn != null ? String(part.lengthIn) : "");
  const [description, setDescription] = useState(part.description || "");
  const [isMisc, setIsMisc] = useState(part.isMisc);
  
  // Pricing
  const [pricingStatus, setPricingStatus] = useState<EstimateBomPartUpdatePricingStatus>(part.pricingStatus as EstimateBomPartUpdatePricingStatus);
  const [quotedUnitPrice, setQuotedUnitPrice] = useState(part.quotedUnitPrice != null ? String(part.quotedUnitPrice) : "");
  const [quotedPriceUnit, setQuotedPriceUnit] = useState(part.quotedPriceUnit || "per_foot");
  const [quoteSource, setQuoteSource] = useState(part.quoteSource || "");

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const update = useUpdateEstimateBomPart({
    mutation: {
      onSuccess: () => {
        toast({ title: "Part updated" });
        queryClient.invalidateQueries({ queryKey: getGetEstimateBomQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getGetEstimatePricingQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getGetEstimateRfqQueryKey(estimateId) });
        setOpen(false);
      },
      onError: (err) => toast({ title: "Failed to update part", description: err instanceof Error ? err.message : undefined, variant: "destructive" })
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7"><Pencil className="w-3.5 h-3.5" /></Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Part</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-4 py-2">
          <div className="space-y-2">
            <Label>Part Mark</Label>
            <Input value={partMark} onChange={(e) => setPartMark(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Quantity (per assembly)</Label>
            <Input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Length (inches)</Label>
            <Input type="number" min="0" step="0.001" value={lengthIn} onChange={(e) => setLengthIn(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Profile Type</Label>
            <Input value={profileType} onChange={(e) => setProfileType(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Profile Size</Label>
            <Input value={profileSize} onChange={(e) => setProfileSize(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Grade</Label>
            <Input value={grade} onChange={(e) => setGrade(e.target.value)} />
          </div>
          <div className="space-y-2 col-span-3">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-2 col-span-3 flex items-center gap-2">
            <Checkbox id={`misc-edit-${part.id}`} checked={isMisc} onCheckedChange={(c) => setIsMisc(!!c)} />
            <Label htmlFor={`misc-edit-${part.id}`} className="font-normal cursor-pointer">Misc / Hardware (always include in RFQ)</Label>
          </div>
          
          <div className="col-span-3 border-t my-2 pt-4">
            <h3 className="text-sm font-semibold mb-3">Pricing</h3>
            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Pricing Status</Label>
                <Select value={pricingStatus} onValueChange={(val: EstimateBomPartUpdatePricingStatus) => setPricingStatus(val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="matched" disabled>Matched to Catalog</SelectItem>
                    <SelectItem value="needs_quote">Needs Quote</SelectItem>
                    <SelectItem value="manual">Manual Pricing</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {pricingStatus === "manual" && (
                <>
                  <div className="space-y-2">
                    <Label>Unit Price ($)</Label>
                    <Input type="number" min="0" step="0.01" value={quotedUnitPrice} onChange={(e) => setQuotedUnitPrice(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Unit</Label>
                    <Select value={quotedPriceUnit} onValueChange={setQuotedPriceUnit}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="per_foot">per foot</SelectItem>
                        <SelectItem value="per_lb">per lb</SelectItem>
                        <SelectItem value="per_piece">per piece</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Source / Vendor</Label>
                    <Input value={quoteSource} onChange={(e) => setQuoteSource(e.target.value)} />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button 
            onClick={() => update.mutate({ partId: part.id, data: { 
              partMark: partMark || null, 
              quantity: Number(quantity) || 1, 
              profileType: profileType || null, 
              profileSize: profileSize || null, 
              grade: grade || null, 
              lengthIn: lengthIn ? Number(lengthIn) : null, 
              description: description || null,
              isMisc,
              pricingStatus,
              quotedUnitPrice: pricingStatus === "manual" && quotedUnitPrice ? Number(quotedUnitPrice) : null,
              quotedPriceUnit: pricingStatus === "manual" ? quotedPriceUnit : null,
              quoteSource: pricingStatus === "manual" ? quoteSource || null : null,
            }})}
            disabled={update.isPending || (!partMark && !description) || (pricingStatus === 'manual' && !quotedUnitPrice)}
          >
            {update.isPending ? "Saving..." : "Save Part"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeletePartButton({ estimateId, partId }: { estimateId: number, partId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const del = useDeleteEstimateBomPart({
    mutation: {
      onSuccess: () => {
        toast({ title: "Part deleted" });
        queryClient.invalidateQueries({ queryKey: getGetEstimateBomQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getGetEstimatePricingQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getGetEstimateRfqQueryKey(estimateId) });
      },
      onError: () => toast({ title: "Failed to delete part", variant: "destructive" })
    }
  });

  return (
    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); if (confirm('Delete this part?')) { del.mutate({ partId }); } }} disabled={del.isPending}>
      <Trash2 className="w-3.5 h-3.5" />
    </Button>
  );
}

export default function EstimateBomCard({ estimateId }: { estimateId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Wizard state
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<EstimateBomImportPreview | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, EstimateBomMaterialResolution>>({});

  const { data: bom, isLoading } = useGetEstimateBom(estimateId, {
    query: { enabled: !!estimateId, queryKey: getGetEstimateBomQueryKey(estimateId) },
  });

  const commit = useCommitEstimateBomImport({
    mutation: {
      onSuccess: () => {
        toast({ title: "BOM imported successfully" });
        queryClient.invalidateQueries({ queryKey: getGetEstimateBomQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getGetEstimatePricingQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getGetEstimateRfqQueryKey(estimateId) });
        closeWizard();
      },
      onError: (err) => toast({ title: "Failed to import BOM", description: err instanceof Error ? err.message : undefined, variant: "destructive" })
    }
  });

  const hasBom = !!bom && bom.assemblyCount > 0;

  const handleFileSelected = async (file: File) => {
    try {
      const parsed = await parseEstimateBomFile(estimateId, file);
      setPendingFile(file);
      setPreview(parsed);
      
      // Auto-resolve matched materials
      const initialResolutions: Record<string, EstimateBomMaterialResolution> = {};
      parsed.materials.forEach(mat => {
        if (mat.matched && mat.catalogItemId) {
          initialResolutions[mat.key] = {
            key: mat.key,
            action: 'match',
            catalogItemId: mat.catalogItemId
          };
        }
      });
      setResolutions(initialResolutions);
      setWizardOpen(true);
    } catch (err) {
      toast({
        title: "Could not read KISS file",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const closeWizard = () => {
    setWizardOpen(false);
    setPendingFile(null);
    setPreview(null);
    setResolutions({});
  };

  const updateResolution = (key: string, data: Partial<EstimateBomMaterialResolution>) => {
    setResolutions(prev => ({
      ...prev,
      [key]: {
        ...(prev[key] || { key, action: 'needs_quote' }),
        ...data
      } as EstimateBomMaterialResolution
    }));
  };

  const handleCommit = () => {
    if (!preview) return;
    
    // Ensure all materials have a resolution
    const missing = preview.materials.filter(m => !resolutions[m.key]);
    if (missing.length > 0) {
      toast({ title: "Missing resolutions", description: "Please review all unmatched materials.", variant: "destructive" });
      return;
    }

    commit.mutate({
      estimateId,
      data: {
        assemblies: preview.bom.assemblies.map(a => ({
          mark: a.mark,
          quantity: a.quantity,
          description: a.description,
          finish: a.finish,
          parts: a.parts.map(p => ({
            partMark: p.partMark,
            quantity: p.quantity,
            profileType: p.profileType,
            profileSize: p.profileSize,
            grade: p.grade,
            lengthIn: p.lengthIn,
            description: p.description
          }))
        })),
        resolutions: Object.values(resolutions)
      }
    });
  };

  const isWizardComplete = preview && preview.materials.every(m => resolutions[m.key]);

  return (
    <Card>
      <CardHeader className="flex flex-row justify-between items-center">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5" /> Bill of Materials
          </CardTitle>
          <CardDescription>Detailed parts list for pricing</CardDescription>
        </div>
        <div className="flex gap-2">
          {hasBom && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                window.location.href = getApiUrl(`estimates/${estimateId}/rfq.csv`);
              }}
            >
              <Download className="w-4 h-4" /> Export RFQ (.csv)
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-4 h-4" /> {hasBom ? "Re-import KISS" : "Import KISS file"}
          </Button>
          <AddAssemblyDialog estimateId={estimateId} />
        </div>
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
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{bom.assemblyCount} assemblies</Badge>
              <Badge variant="secondary">{bom.partCount} part lines</Badge>
              <Badge variant="secondary">{bom.totalPieces} total pieces</Badge>
              {bom.needsQuoteCount > 0 && <Badge variant="outline" className="bg-amber-50 text-amber-700">{bom.needsQuoteCount} need quote</Badge>}
            </div>
            
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
                    <TableHead className="w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bom.assemblies.map((a) => (
                    <AssemblyRow key={a.id} estimateId={estimateId} assembly={a} />
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground py-10 text-center flex flex-col items-center">
            <ClipboardList className="w-10 h-10 mb-3 text-muted-foreground/30" />
            <p className="mb-4">No bill of materials imported yet.</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>Import a KISS file</Button>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={wizardOpen} onOpenChange={(o) => !o && closeWizard()}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Materials</DialogTitle>
          </DialogHeader>
          
          {preview && (
            <div className="space-y-6">
              {hasBom && (
                <div className="bg-destructive/10 text-destructive p-3 rounded-md flex gap-2 text-sm">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <div>This estimate already has a BOM. Importing will replace all existing assemblies, parts, and manual pricing with the contents of this file.</div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Matched</CardTitle></CardHeader>
                  <CardContent className="py-2 px-4 text-2xl font-bold text-green-600">
                    {preview.materials.filter(m => m.matched).length}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Need Review</CardTitle></CardHeader>
                  <CardContent className="py-2 px-4 text-2xl font-bold text-amber-600">
                    {preview.materials.filter(m => !m.matched).length}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Total Groups</CardTitle></CardHeader>
                  <CardContent className="py-2 px-4 text-2xl font-bold">
                    {preview.materials.length}
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-medium">Unmatched Materials</h3>
                <p className="text-xs text-muted-foreground">The following materials could not be automatically matched to your catalog. You must decide how to handle each one before importing.</p>
                
                <div className="border rounded-md divide-y">
                  {preview.materials.filter(m => !m.matched).map(mat => {
                    const res = resolutions[mat.key] || { action: 'needs_quote' };
                    return (
                      <div key={mat.key} className="p-4 bg-muted/10 flex flex-col gap-4">
                        <div className="flex justify-between">
                          <div className="font-mono text-sm font-semibold">{mat.profileType || ''} {mat.profileSize || ''} {mat.grade || ''}</div>
                          <div className="text-xs text-muted-foreground">{mat.pieces} pieces • {formatFeetInches(mat.totalLengthIn)} total length</div>
                        </div>
                        
                        <div className="flex items-start gap-4">
                          <div className="w-48 shrink-0">
                            <Select 
                              value={res.action} 
                              onValueChange={(val: EstimateBomMaterialResolutionAction) => updateResolution(mat.key, { action: val })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="needs_quote">Mark for RFQ</SelectItem>
                                <SelectItem value="manual">Enter Manual Price</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          
                          <div className="flex-1">
                            {res.action === 'needs_quote' && (
                              <div className="flex items-center gap-2 h-10 px-3 bg-amber-50 text-amber-700 rounded-md text-sm">
                                <AlertTriangle className="w-4 h-4" /> Will be excluded from material total until quoted
                              </div>
                            )}
                            
                            {res.action === 'manual' && (
                              <div className="flex gap-2">
                                <div className="flex items-center">
                                  <span className="text-muted-foreground bg-muted h-10 flex items-center px-3 border border-r-0 rounded-l-md border-input">$</span>
                                  <Input 
                                    type="number" 
                                    min="0" 
                                    step="0.01" 
                                    className="rounded-l-none w-24"
                                    placeholder="0.00"
                                    value={res.manualUnitPrice || ''}
                                    onChange={e => updateResolution(mat.key, { manualUnitPrice: Number(e.target.value) || 0 })}
                                  />
                                </div>
                                <div>
                                  <Select 
                                    value={res.manualPriceUnit || 'per_foot'} 
                                    onValueChange={(val) => updateResolution(mat.key, { manualPriceUnit: val })}
                                  >
                                    <SelectTrigger className="w-32">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="per_foot">per foot</SelectItem>
                                      <SelectItem value="per_lb">per lb</SelectItem>
                                      <SelectItem value="per_piece">per piece</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <Input 
                                  placeholder="Source/Vendor (optional)" 
                                  className="flex-1"
                                  value={res.quoteSource || ''}
                                  onChange={e => updateResolution(mat.key, { quoteSource: e.target.value })}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox 
                            id={`misc-${mat.key}`} 
                            checked={res.isMisc || false} 
                            onCheckedChange={(c) => updateResolution(mat.key, { isMisc: !!c })} 
                          />
                          <Label htmlFor={`misc-${mat.key}`} className="text-xs font-normal">Flag as Misc/Hardware (always included in RFQ)</Label>
                        </div>
                      </div>
                    );
                  })}
                  {preview.materials.filter(m => !m.matched).length === 0 && (
                    <div className="p-8 text-center text-sm text-green-600 flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-5 h-5" /> All materials matched the catalog!
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={closeWizard}>Cancel</Button>
            <Button onClick={handleCommit} disabled={commit.isPending || !isWizardComplete}>
              {commit.isPending ? "Importing..." : "Commit BOM"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
