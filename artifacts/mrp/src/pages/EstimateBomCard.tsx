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

import {
  EstimateBomImportWizard,
  parseEstimateBomFile,
} from "@/components/estimates/EstimateBomImportWizard";

export { parseEstimateBomFile };

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
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<EstimateBomImportPreview | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const { data: bom, isLoading } = useGetEstimateBom(estimateId, {
    query: { enabled: !!estimateId, queryKey: getGetEstimateBomQueryKey(estimateId) },
  });

  const hasBom = !!bom && bom.assemblyCount > 0;

  const handleFileSelected = async (file: File) => {
    try {
      const parsed = await parseEstimateBomFile(estimateId, file);
      setPreview(parsed);
      setWizardOpen(true);
    } catch (err) {
      toast({
        title: "Could not read BOM file",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const closeWizard = () => {
    setWizardOpen(false);
    setPreview(null);
  };

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
            <Upload className="w-4 h-4" /> {hasBom ? "Re-import BOM file" : "Import BOM file"}
          </Button>
          <AddAssemblyDialog estimateId={estimateId} />
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
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>Import a KISS or PowerFab XML file</Button>
            </div>
          </div>
        )}
      </CardContent>

      <EstimateBomImportWizard
        estimateId={estimateId}
        preview={preview}
        open={wizardOpen}
        replacingExisting={hasBom}
        onClose={closeWizard}
      />
    </Card>
  );
}
