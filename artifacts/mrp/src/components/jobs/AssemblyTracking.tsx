import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateBomAssembly,
  useListStageLibrary,
  useListProcessingPathOptions,
  useCreateProcessingPathOption,
  getListProcessingPathOptionsQueryKey,
  useUpdateBomPart,
  useListPartDocuments,
  useDeleteDocument,
  getGetJobQueryKey,
  getGetDashboardJobsQueryKey,
  getGetDashboardSummaryQueryKey,
  getListPartDocumentsQueryKey,
  getDownloadDocumentUrl,
  type BomAssembly,
  type BomPart,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  PackageCheck,
  Paperclip,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Stage model (driven by the company's Stage Library pipeline) ─────────────

type BucketKey = string; // "notStarted" | "onHold" | a pipeline stage name

/** Bucket an assembly the same way the dashboard grid does. */
function bucketOf(asm: BomAssembly, knownStages: Set<string>): BucketKey {
  if (asm.onHold) return "onHold";
  if (asm.currentStage && knownStages.has(asm.currentStage.toLowerCase())) {
    return asm.currentStage.toLowerCase();
  }
  return "notStarted";
}

function qtyOf(asm: BomAssembly): number {
  return asm.quantity > 0 ? asm.quantity : 1;
}

// ─── Summary strip ────────────────────────────────────────────────────────────

function StageCountChip({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone: "muted" | "vendor" | "shop" | "hold";
  onClick: () => void;
}) {
  const toneCls =
    tone === "vendor"
      ? "bg-amber-50 dark:bg-amber-950/30"
      : tone === "shop"
        ? "bg-sky-50 dark:bg-sky-950/30"
        : tone === "hold"
          ? "bg-destructive/5"
          : "bg-muted/40";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={`chip-stage-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      className={`flex flex-col items-center justify-center px-2.5 py-1.5 rounded-md border min-w-[74px] transition-colors ${toneCls} ${
        active
          ? "border-primary ring-1 ring-primary"
          : "border-transparent hover:border-border"
      } ${count === 0 ? "opacity-60" : ""}`}
    >
      <span
        className={`text-lg leading-tight tabular-nums ${
          count === 0
            ? "text-muted-foreground/50 font-normal"
            : tone === "hold"
              ? "font-bold text-destructive"
              : "font-bold"
        }`}
      >
        {count}
      </span>
      <span className="text-[10px] leading-tight text-muted-foreground text-center whitespace-nowrap">
        {label}
      </span>
    </button>
  );
}

// ─── Assembly status badge ────────────────────────────────────────────────────

export function AssemblyStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const cls =
    status === "Ready to Ship" || status === "Complete"
      ? "border-green-500 text-green-700 bg-green-50 dark:bg-green-950 dark:text-green-400"
      : status === "In Progress"
        ? "border-blue-500 text-blue-700 bg-blue-50 dark:bg-blue-950 dark:text-blue-400"
        : "border-muted-foreground/40 text-muted-foreground";
  return (
    <Badge variant="outline" className={`text-xs ${cls}`}>
      {(status === "Ready to Ship" || status === "Complete") && (
        <PackageCheck className="w-3 h-3 mr-1" />
      )}
      {status}
    </Badge>
  );
}

// ─── Assembly current-stage badge ─────────────────────────────────────────────

function StageBadge({ stageName }: { stageName: string | null | undefined }) {
  if (!stageName) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <Badge variant="secondary" className="text-xs font-medium">
      <span className="w-1.5 h-1.5 rounded-full bg-primary mr-1.5 inline-block" />
      {stageName}
    </Badge>
  );
}

// ─── Per-assembly pipeline stepper ────────────────────────────────────────────

function AssemblyPipelineStepper({
  pipeline,
  currentStage,
  onSelectStage,
  disabled = false,
}: {
  pipeline: string[];
  currentStage: string | null | undefined;
  onSelectStage?: (stage: string | null) => void;
  disabled?: boolean;
}) {
  const currentIdx = currentStage
    ? pipeline.findIndex((n) => n.toLowerCase() === currentStage.toLowerCase())
    : -1;
  const clickable = !!onSelectStage && !disabled;
  const finalIdx = pipeline.length - 1;
  return (
    <div className="flex items-start gap-0 overflow-x-auto pb-1">
      {pipeline.map((name, i) => {
        const isDone = currentIdx >= 0 && i < currentIdx;
        const isCurrent = i === currentIdx;
        const isFinal = i === finalIdx;
        return (
          <div key={name} className="flex items-center shrink-0">
            {i > 0 && (
              <div
                className={`h-0.5 w-6 mt-3.5 shrink-0 ${isDone || isCurrent ? "bg-primary" : "bg-muted"}`}
              />
            )}
            <button
              type="button"
              disabled={!clickable || (isFinal && !isCurrent)}
              onClick={() =>
                onSelectStage?.(isCurrent ? null : name)
              }
              title={
                isFinal && !isCurrent
                  ? "Set automatically when a shipment departs"
                  : clickable
                    ? isCurrent
                      ? "Click to clear stage (back to Not Started)"
                      : `Set stage to ${name}`
                    : undefined
              }
              data-testid={`stepper-stage-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              className={`flex flex-col items-center gap-1 w-14 rounded-md ${
                clickable ? "cursor-pointer hover:bg-muted/60 py-0.5" : "cursor-default"
              }`}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                  isDone
                    ? "bg-primary text-primary-foreground"
                    : isCurrent
                      ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-background ring-offset-2"
                      : "bg-muted text-muted-foreground border border-border"
                }`}
              >
                {isDone ? "✓" : i + 1}
              </div>
              <span className="text-[9px] text-center leading-tight text-muted-foreground max-w-full px-0.5">
                {name}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Level 3 expansion panel ──────────────────────────────────────────────────

function AssemblyDetailPanel({
  assembly,
  jobNumber,
  jobId,
  pipeline,
}: {
  assembly: BomAssembly;
  jobNumber: string;
  jobId: number;
  pipeline: string[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
    queryClient.invalidateQueries({ queryKey: getGetDashboardJobsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  };

  const updateAssembly = useUpdateBomAssembly({
    mutation: {
      onSuccess: invalidate,
      onError: (err: unknown) =>
        toast({
          title: "Could not save assembly",
          description:
            (err as { data?: { error?: string } })?.data?.error ?? undefined,
          variant: "destructive",
        }),
    },
  });

  // Local drafts for text fields (committed on blur / Enter).
  const [description, setDescription] = useState(assembly.description ?? "");
  const [qty, setQty] = useState(String(assembly.quantity));
  const [notes, setNotes] = useState(assembly.notes ?? "");

  useEffect(() => {
    setDescription(assembly.description ?? "");
    setQty(String(assembly.quantity));
    setNotes(assembly.notes ?? "");
  }, [assembly.description, assembly.quantity, assembly.notes]);

  const save = (data: Parameters<typeof updateAssembly.mutate>[0]["data"]) => {
    if (assembly.id == null) return;
    updateAssembly.mutate({ assemblyId: assembly.id, data });
  };

  const commitDescription = () => {
    const v = description.trim();
    if (v === (assembly.description ?? "")) return;
    save({ description: v === "" ? null : v });
  };

  const commitQty = () => {
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 1) {
      toast({
        title: "Invalid quantity",
        description: "Quantity must be a whole number of 1 or more.",
        variant: "destructive",
      });
      setQty(String(assembly.quantity));
      return;
    }
    if (n === assembly.quantity) return;
    save({ quantity: n });
  };

  const commitNotes = () => {
    const v = notes.trim();
    if (v === (assembly.notes ?? "")) return;
    save({ notes: v === "" ? null : v });
  };

  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
  };

  return (
    <div className="bg-muted/30 border-t border-b border-muted p-4 space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Process Stage
          <span className="ml-2 normal-case font-normal text-muted-foreground/70">
            (click a step to set the stage)
          </span>
        </p>
        <AssemblyPipelineStepper
          pipeline={pipeline}
          currentStage={assembly.currentStage}
          disabled={updateAssembly.isPending}
          onSelectStage={(stage) => save({ currentStage: stage })}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border rounded-md bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Assembly — {assembly.mark}
          </p>
          <div className="space-y-2 text-sm">
            <DetailRow label="Customer job" value={jobNumber} />
            <EditRow label="Description">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={commitDescription}
                onKeyDown={blurOnEnter}
                className="h-7 text-sm"
                data-testid={`input-asm-description-${assembly.mark}`}
              />
            </EditRow>
            <EditRow label="Qty">
              <Input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                onBlur={commitQty}
                onKeyDown={blurOnEnter}
                inputMode="numeric"
                className="h-7 text-sm w-24"
                data-testid={`input-asm-qty-${assembly.mark}`}
              />
            </EditRow>
            <EditRow label="Processing path">
              <ProcessingPathCombobox
                value={assembly.processingPath ?? null}
                disabled={updateAssembly.isPending}
                mark={assembly.mark}
                onChange={(v) => save({ processingPath: v })}
              />
            </EditRow>
            <EditRow label="Current stage">
              <Select
                value={assembly.currentStage ?? "__none__"}
                onValueChange={(v) =>
                  save({ currentStage: v === "__none__" ? null : v })
                }
                disabled={updateAssembly.isPending}
              >
                <SelectTrigger
                  className="h-7 text-sm"
                  data-testid={`select-asm-stage-${assembly.mark}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not Started</SelectItem>
                  {pipeline.map((s, i) => (
                    <SelectItem
                      key={s}
                      value={s}
                      disabled={i === pipeline.length - 1 && s !== assembly.currentStage}
                    >
                      {s}
                      {i === pipeline.length - 1 ? " (via shipment departure)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </EditRow>
            <EditRow label="On hold">
              <div className="flex items-center gap-2 h-7">
                <Switch
                  checked={assembly.onHold}
                  onCheckedChange={(checked) => save({ onHold: checked })}
                  disabled={updateAssembly.isPending}
                  data-testid={`switch-asm-hold-${assembly.mark}`}
                />
                {assembly.onHold && (
                  <span className="text-destructive font-medium flex items-center gap-1 text-xs">
                    <AlertCircle className="w-3 h-3" /> On hold
                  </span>
                )}
              </div>
            </EditRow>
            <EditRow label="Notes / hold reason">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={commitNotes}
                rows={2}
                className="text-sm min-h-[3rem]"
                data-testid={`input-asm-notes-${assembly.mark}`}
              />
            </EditRow>
            {assembly.inspectedOn && (
              <DetailRow label="Inspected on" value={assembly.inspectedOn} />
            )}
            {(assembly.station || assembly.inspector) && (
              <DetailRow
                label="Station / by"
                value={[assembly.station, assembly.inspector].filter(Boolean).join(" · ")}
              />
            )}
          </div>
        </div>

        <div className="border rounded-md bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Parts &amp; Material — Heat Traceability
          </p>
          {assembly.parts.length === 0 ? (
            <p className="text-xs text-muted-foreground">No parts recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Stock Type</TableHead>
                    <TableHead className="text-xs">Piece Marks</TableHead>
                    <TableHead className="text-xs text-right">Qty</TableHead>
                    <TableHead className="text-xs w-10">
                      <span className="sr-only">Attachments</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assembly.parts.map((p, i) => (
                    <PartEditRow key={p.id ?? i} part={p} jobId={jobId} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground mt-2">
            Edit any cell — changes save when you click away. Record heat #s as
            material arrives for full traceability.
          </p>
        </div>
      </div>
    </div>
  );
}

function ProcessingPathCombobox({
  value,
  disabled,
  mark,
  onChange,
}: {
  value: string | null;
  disabled?: boolean;
  mark: string;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: options = [] } = useListProcessingPathOptions();

  const createOption = useCreateProcessingPathOption({
    mutation: {
      onSuccess: (created) => {
        queryClient.invalidateQueries({
          queryKey: getListProcessingPathOptionsQueryKey(),
        });
        onChange(created.name);
        setOpen(false);
        setSearch("");
      },
      onError: () =>
        toast({
          title: "Could not add option",
          variant: "destructive",
        }),
    },
  });

  // Include the current (possibly legacy free-text) value so it never looks blank.
  const names = options.map((o) => o.name);
  if (value && !names.some((n) => n.toLowerCase() === value.toLowerCase())) {
    names.push(value);
  }
  names.sort((a, b) => a.localeCompare(b));

  const trimmed = search.trim();
  const canAdd =
    trimmed !== "" &&
    !names.some((n) => n.toLowerCase() === trimmed.toLowerCase());

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-7 w-full justify-between text-sm font-normal px-2"
          data-testid={`combobox-asm-path-${mark}`}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ?? "Select processing path…"}
          </span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search or add…"
            value={search}
            onValueChange={setSearch}
            data-testid={`input-asm-path-search-${mark}`}
          />
          <CommandList>
            <CommandEmpty>
              {trimmed === "" ? "No options yet." : "No matching option."}
            </CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                    setSearch("");
                  }}
                  data-testid={`option-asm-path-clear-${mark}`}
                >
                  <X className="mr-2 h-3.5 w-3.5" />
                  Clear (none)
                </CommandItem>
              )}
              {names.map((name) => (
                <CommandItem
                  key={name}
                  value={name}
                  onSelect={() => {
                    if (name !== value) onChange(name);
                    setOpen(false);
                    setSearch("");
                  }}
                  data-testid={`option-asm-path-${mark}-${name}`}
                >
                  <Check
                    className={cn(
                      "mr-2 h-3.5 w-3.5",
                      value?.toLowerCase() === name.toLowerCase()
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                  {name}
                </CommandItem>
              ))}
              {canAdd && (
                <CommandItem
                  value={`__add__${trimmed}`}
                  onSelect={() => createOption.mutate({ data: { name: trimmed } })}
                  disabled={createOption.isPending}
                  data-testid={`option-asm-path-add-${mark}`}
                >
                  {createOption.isPending ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-3.5 w-3.5" />
                  )}
                  Add "{trimmed}"
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
function EditRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground shrink-0 min-w-[110px] pt-1.5">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ─── Editable part row ────────────────────────────────────────────────────────

function PartEditRow({ part, jobId }: { part: BomPart; jobId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const updatePart = useUpdateBomPart({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
      },
      onError: (err: unknown) =>
        toast({
          title: "Could not save part",
          description:
            (err as { data?: { error?: string } })?.data?.error ?? undefined,
          variant: "destructive",
        }),
    },
  });

  const [stockType, setStockType] = useState(
    [part.profileType, part.profileSize].filter(Boolean).join(" "),
  );
  const [partMark, setPartMark] = useState(part.partMark ?? "");
  const [qty, setQty] = useState(String(part.quantity));

  useEffect(() => {
    setStockType([part.profileType, part.profileSize].filter(Boolean).join(" "));
    setPartMark(part.partMark ?? "");
    setQty(String(part.quantity));
  }, [part.profileType, part.profileSize, part.partMark, part.quantity]);

  const save = (data: Parameters<typeof updatePart.mutate>[0]["data"]) => {
    if (part.id == null) return;
    updatePart.mutate({ partId: part.id, data });
  };

  const commitStockType = () => {
    const current = [part.profileType, part.profileSize].filter(Boolean).join(" ");
    const v = stockType.trim();
    if (v === current) return;
    if (v === "") {
      save({ profileType: null, profileSize: null });
      return;
    }
    const spaceIdx = v.indexOf(" ");
    if (spaceIdx === -1) {
      save({ profileType: v, profileSize: null });
    } else {
      save({
        profileType: v.slice(0, spaceIdx),
        profileSize: v.slice(spaceIdx + 1).trim() || null,
      });
    }
  };

  const commitPartMark = () => {
    const v = partMark.trim();
    if (v === (part.partMark ?? "")) return;
    save({ partMark: v === "" ? null : v });
  };

  const commitQty = () => {
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 1) {
      toast({
        title: "Invalid quantity",
        description: "Quantity must be a whole number of 1 or more.",
        variant: "destructive",
      });
      setQty(String(part.quantity));
      return;
    }
    if (n === part.quantity) return;
    save({ quantity: n });
  };

  // Heat numbers are captured relationally at PO receiving (Job Heat Sheet);
  // the legacy free-text bom_parts.heatNumber is no longer edited here.

  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
  };

  return (
    <TableRow className="text-xs">
      <TableCell className="p-1.5">
        <Input
          value={stockType}
          onChange={(e) => setStockType(e.target.value)}
          onBlur={commitStockType}
          onKeyDown={blurOnEnter}
          placeholder={part.description ?? "e.g. W 12x26"}
          className="h-7 text-xs font-medium min-w-[100px]"
          data-testid={`input-part-stock-${part.id}`}
        />
      </TableCell>
      <TableCell className="p-1.5">
        <Input
          value={partMark}
          onChange={(e) => setPartMark(e.target.value)}
          onBlur={commitPartMark}
          onKeyDown={blurOnEnter}
          className="h-7 text-xs font-mono min-w-[70px]"
          data-testid={`input-part-mark-${part.id}`}
        />
      </TableCell>
      <TableCell className="p-1.5">
        <Input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onBlur={commitQty}
          onKeyDown={blurOnEnter}
          inputMode="numeric"
          className="h-7 text-xs text-right w-16"
          data-testid={`input-part-qty-${part.id}`}
        />
      </TableCell>
      <TableCell className="p-1.5 text-center">
        {part.id != null && <PartAttachmentCell partId={part.id} />}
      </TableCell>
    </TableRow>
  );
}

// ─── Per-part PDF attachments (MTRs) ─────────────────────────────────────────

const MAX_PART_PDF_MB = 50;

function PartAttachmentCell({ partId }: { partId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [open, setOpen] = useState(false);

  const listQueryKey = getListPartDocumentsQueryKey(partId);
  const { data: docs } = useListPartDocuments(partId, {
    query: { queryKey: listQueryKey },
  });
  const count = docs?.length ?? 0;

  const deleteDocument = useDeleteDocument({
    mutation: {
      onSuccess: () => {
        toast({ title: "PDF deleted" });
        queryClient.invalidateQueries({ queryKey: listQueryKey });
      },
      onError: () =>
        toast({ title: "Failed to delete PDF", variant: "destructive" }),
    },
  });

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast({
        title: "PDF files only",
        description: "Attach a PDF (e.g. a mill test report) to this part.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_PART_PDF_MB * 1024 * 1024) {
      toast({
        title: "File too large",
        description: `Maximum size is ${MAX_PART_PDF_MB} MB.`,
        variant: "destructive",
      });
      return;
    }
    setIsUploading(true);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${base}/api/bom/parts/${partId}/documents`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        let message = "Upload failed";
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          // keep default message
        }
        toast({ title: message, variant: "destructive" });
        return;
      }
      toast({ title: "PDF attached" });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 relative ${count > 0 ? "text-primary" : "text-muted-foreground"}`}
          aria-label={
            count > 0 ? `View ${count} attached PDF(s)` : "Attach a PDF"
          }
          data-testid={`button-part-docs-${partId}`}
        >
          <Paperclip className="w-3.5 h-3.5" />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-primary text-primary-foreground rounded-full text-[9px] leading-none w-3.5 h-3.5 flex items-center justify-center">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <p className="text-xs font-semibold mb-2">Attached PDFs</p>
        {count === 0 ? (
          <p className="text-xs text-muted-foreground mb-2">
            No PDF attached. Upload a mill test report or certificate for this
            part.
          </p>
        ) : (
          <div className="space-y-1.5 mb-2">
            {docs!.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-2 border rounded px-2 py-1.5"
              >
                <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <a
                  href={`${base}${getDownloadDocumentUrl(doc.id)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs truncate flex-1 hover:underline"
                  title={doc.filename}
                  data-testid={`link-part-doc-${doc.id}`}
                >
                  {doc.filename}
                </a>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive shrink-0"
                  aria-label={`Delete ${doc.filename}`}
                  disabled={deleteDocument.isPending}
                  onClick={() => deleteDocument.mutate({ documentId: doc.id })}
                  data-testid={`button-delete-part-doc-${doc.id}`}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2 h-7 text-xs"
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
          data-testid={`button-upload-part-doc-${partId}`}
        >
          {isUploading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Upload className="w-3.5 h-3.5" />
          )}
          {count > 0 ? "Upload another PDF" : "Upload PDF"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function DetailRow({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: React.ReactNode;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between items-start gap-2">
      <span className="text-muted-foreground shrink-0 min-w-[110px]">{label}</span>
      <span className={`text-right ${bold ? "font-semibold" : ""}`}>{value ?? "—"}</span>
    </div>
  );
}

// ─── Assembly row ─────────────────────────────────────────────────────────────

function AssemblyRow({
  assembly,
  jobNumber,
  jobId,
  pipeline,
}: {
  assembly: BomAssembly;
  jobNumber: string;
  jobId: number;
  pipeline: string[];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
        data-testid={`assembly-row-${assembly.mark}`}
      >
        <TableCell className="w-8 p-2">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="font-semibold font-mono text-sm">{assembly.mark}</TableCell>
        <TableCell className="text-sm">{assembly.description ?? "—"}</TableCell>
        <TableCell className="text-sm text-center">{assembly.quantity}</TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {assembly.processingPath ?? "—"}
        </TableCell>
        <TableCell>
          <StageBadge stageName={assembly.currentStage} />
        </TableCell>
        <TableCell className="w-8">
          {assembly.onHold && (
            <AlertCircle className="w-4 h-4 text-destructive" aria-label="On hold" />
          )}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={7} className="p-0">
            <AssemblyDetailPanel assembly={assembly} jobNumber={jobNumber} jobId={jobId} pipeline={pipeline} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── Main assembly tracking card ──────────────────────────────────────────────

export default function AssemblyTracking({
  assemblies,
  jobNumber,
  jobId,
  assemblyStatus,
  assemblyProgressPct,
}: {
  assemblies: BomAssembly[];
  jobNumber: string;
  jobId: number;
  assemblyStatus: string | null | undefined;
  assemblyProgressPct: number | null | undefined;
}) {
  const [bucketFilter, setBucketFilter] = useState<BucketKey | null>(null);
  const [search, setSearch] = useState("");

  const { data: stageLibrary } = useListStageLibrary();
  const pipelineStages = useMemo(() => stageLibrary ?? [], [stageLibrary]);
  const pipelineNames = useMemo(
    () => pipelineStages.map((s) => s.name),
    [pipelineStages],
  );
  const knownStages = useMemo(
    () => new Set(pipelineNames.map((n) => n.toLowerCase())),
    [pipelineNames],
  );

  const counts = useMemo(() => {
    const c = new Map<BucketKey, number>();
    for (const asm of assemblies) {
      const b = bucketOf(asm, knownStages);
      c.set(b, (c.get(b) ?? 0) + qtyOf(asm));
    }
    return c;
  }, [assemblies, knownStages]);

  const totalQty = useMemo(
    () => assemblies.reduce((s, a) => s + qtyOf(a), 0),
    [assemblies],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assemblies.filter((asm) => {
      if (bucketFilter && bucketOf(asm, knownStages) !== bucketFilter) return false;
      if (q) {
        const hay = `${asm.mark} ${asm.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [assemblies, bucketFilter, search, knownStages]);

  const toggleBucket = (b: BucketKey) =>
    setBucketFilter((cur) => (cur === b ? null : b));

  const filtersActive = bucketFilter !== null || search.trim() !== "";
  const pct = Math.round(assemblyProgressPct ?? 0);

  return (
    <Card data-testid="assembly-tracking-card">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            <CardTitle>Assembly Tracking</CardTitle>
            <Badge variant="secondary">
              {assemblies.length} assemblies · {totalQty} pcs
            </Badge>
            <AssemblyStatusBadge status={assemblyStatus} />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{pct}% done</span>
            <Progress value={pct} className="w-32" />
          </div>
        </div>

        {/* Stage summary strip */}
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2 pt-3">
          <StageCountChip
            label="Not Started"
            count={counts.get("notStarted") ?? 0}
            active={bucketFilter === "notStarted"}
            tone="muted"
            onClick={() => toggleBucket("notStarted")}
          />
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold pl-0.5">
              Production Pipeline
            </span>
            <div className="flex gap-1 flex-wrap">
              {pipelineStages.map((s) => (
                <StageCountChip
                  key={s.id}
                  label={s.name}
                  count={counts.get(s.name.toLowerCase()) ?? 0}
                  active={bucketFilter === s.name.toLowerCase()}
                  tone={s.stageType === "vendor" ? "vendor" : "shop"}
                  onClick={() => toggleBucket(s.name.toLowerCase())}
                />
              ))}
            </div>
          </div>
          <StageCountChip
            label="On Hold"
            count={counts.get("onHold") ?? 0}
            active={bucketFilter === "onHold"}
            tone="hold"
            onClick={() => toggleBucket("onHold")}
          />
        </div>

        {/* Search + clear */}
        <div className="flex items-center gap-2 pt-2">
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search mark or description..."
              className="pl-8 h-8 text-sm"
              data-testid="input-assembly-search"
            />
          </div>
          {filtersActive && (
            <button
              type="button"
              onClick={() => {
                setBucketFilter(null);
                setSearch("");
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              data-testid="button-clear-assembly-filters"
            >
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          )}
          {filtersActive && (
            <span className="text-xs text-muted-foreground ml-auto">
              {filtered.length} of {assemblies.length} shown
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Mark / Assy</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-center">Qty</TableHead>
                <TableHead>Processing Path</TableHead>
                <TableHead>Current Stage</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                    No assemblies match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((asm, i) => (
                  <AssemblyRow key={asm.id ?? i} assembly={asm} jobNumber={jobNumber} jobId={jobId} pipeline={pipelineNames} />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
