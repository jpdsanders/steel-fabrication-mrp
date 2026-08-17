/**
 * NestingCard — 1D cutting-stock nesting for a job's BOM.
 *
 * Shows:
 *  - Accepted nesting plan (if one exists) with per-group summary + cut list toggle
 *  - "Run nesting" controls to compute and compare options by profile group
 *  - Accept/reset actions
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useComputeNesting,
  useGetNestingPlan,
  useGetNestingCutList,
  useAcceptNestingOption,
  useDeleteNestingPlan,
  getGetNestingPlanQueryKey,
  getGetNestingCutListQueryKey,
  type NestingGroupResult,
  type NestingOption,
  type NestingPlan,
  type NestingCutList,
  type NestingComputeResult,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Scissors,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  RotateCcw,
  Loader2,
  AlertTriangle,
  Printer,
} from "lucide-react";

// ----------------------------
// Helpers
// ----------------------------
function inToFt(inches: number): string {
  const ft = Math.floor(inches / 12);
  const inRem = inches % 12;
  if (inRem === 0) return `${ft}'`;
  return `${ft}'-${inRem.toFixed(3).replace(/\.?0+$/, '')}"`;
}

function wasteBadge(pct: number) {
  const variant =
    pct < 5 ? "default" : pct < 12 ? "secondary" : "destructive";
  return (
    <Badge variant={variant} className="text-xs">
      {pct.toFixed(1)}% drop
    </Badge>
  );
}

// ----------------------------
// Cut list view (accepted plan)
// ----------------------------
function CutListView({ cutList }: { cutList: NestingCutList }) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpenGroups((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Scissors className="w-3.5 h-3.5" />
        Kerf: {cutList.kerfIn}" per cut
      </div>
      {cutList.groups.map((g) => {
        const key = `${g.profileType}|${g.profileSize}|${g.grade}`;
        const open = openGroups.has(key);
        return (
          <div key={key} className="border rounded-md">
            <button
              onClick={() => toggle(key)}
              className="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-muted/50 transition-colors rounded-md"
            >
              <span className="flex items-center gap-2">
                {open ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                {g.profileType} {g.profileSize} — {g.grade}
                <span className="text-muted-foreground font-normal">
                  {g.totalBars} bar{g.totalBars !== 1 ? "s" : ""} ×{" "}
                  {inToFt(g.totalStockIn / g.totalBars)}
                </span>
              </span>
              {wasteBadge(g.wastePercent)}
            </button>
            {open && (
              <div className="border-t px-3 pb-3 space-y-3">
                {g.bars.map((bar, bi) => (
                  <div key={bi} className="pt-3">
                    <div className="flex items-center justify-between mb-1 text-xs text-muted-foreground">
                      <span>
                        Bar {bar.barIndex} —{" "}
                        {bar.source === "remnant"
                          ? `Remnant ${bar.remnantRef ?? ""}`
                          : bar.vendorName ?? "Stock"}{" "}
                        — {inToFt(bar.stockLengthIn)}
                      </span>
                      {wasteBadge(bar.wastePercent)}
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs h-7">Part</TableHead>
                          <TableHead className="text-xs h-7 text-right">
                            Length
                          </TableHead>
                          <TableHead className="text-xs h-7 text-right">
                            Qty
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bar.cuts.map((cut, ci) => (
                          <TableRow key={ci}>
                            <TableCell className="text-xs py-1">
                              {cut.label || `Part ${cut.partId}`}
                            </TableCell>
                            <TableCell className="text-xs py-1 text-right font-mono">
                              {inToFt(cut.lengthIn)}
                            </TableCell>
                            <TableCell className="text-xs py-1 text-right">
                              ×{cut.quantity}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-muted/30">
                          <TableCell className="text-xs py-1 text-muted-foreground">
                            Drop
                          </TableCell>
                          <TableCell className="text-xs py-1 text-right font-mono text-muted-foreground">
                            {inToFt(bar.wasteIn)}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ----------------------------
// Option picker for one group
// ----------------------------
function GroupOptionPicker({
  group,
  selectedIdx,
  onSelect,
}: {
  group: NestingGroupResult;
  selectedIdx: number;
  onSelect: (idx: number) => void;
}) {
  if (group.options.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic">
        No stock lengths on file for this profile — add them on the Vendors page.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {group.options.map((opt, i) => {
        const incomplete = !opt.isComplete;
        const isSelected = selectedIdx === i;
        return (
          <div key={i} className="space-y-0.5">
            <button
              onClick={() => !incomplete && onSelect(i)}
              disabled={incomplete}
              className={`w-full text-left border rounded p-2 text-xs flex items-center justify-between transition-colors ${
                incomplete
                  ? "opacity-60 cursor-not-allowed border-muted bg-muted/20"
                  : isSelected
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/40"
              }`}
            >
              <span className="flex items-center gap-2">
                {isSelected && !incomplete && (
                  <CheckCircle className="w-3.5 h-3.5 text-primary shrink-0" />
                )}
                {incomplete && (
                  <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                )}
                <span className="font-medium">{inToFt(opt.stockLengthIn)}</span>
                <span className="text-muted-foreground">
                  {opt.vendorName} — {opt.bars.filter((b) => b.source === "stock").length} bar
                  {opt.bars.filter((b) => b.source === "stock").length !== 1 ? "s" : ""}
                </span>
                {incomplete && (
                  <span className="text-destructive font-medium">
                    — {opt.missingParts.length} part{opt.missingParts.length !== 1 ? "s" : ""} too long
                  </span>
                )}
              </span>
              {wasteBadge(opt.wastePercent)}
            </button>
          </div>
        );
      })}
      {group.unnestable.length > 0 && (
        <div className="flex items-start gap-1.5 text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded p-2 mt-1">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            {group.unnestable.length} part
            {group.unnestable.length !== 1 ? "s are" : " is"} longer than all
            available stock lengths and cannot be nested.
          </span>
        </div>
      )}
    </div>
  );
}

// ----------------------------
// Main component
// ----------------------------
export default function NestingCard({ jobId }: { jobId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [kerfIn, setKerfIn] = useState("0.25");
  const [computed, setComputed] = useState<NestingComputeResult | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<
    Record<string, number>
  >({});
  const [showCutList, setShowCutList] = useState(false);

  const { data: plan, isLoading: planLoading } = useGetNestingPlan(jobId);
  const { data: cutList, isLoading: cutListLoading } = useGetNestingCutList(
    jobId,
    {
      query: {
        queryKey: getGetNestingCutListQueryKey(jobId),
        enabled: showCutList && !!plan,
      },
    },
  );

  const invalidatePlan = () => {
    queryClient.invalidateQueries({ queryKey: getGetNestingPlanQueryKey(jobId) });
    queryClient.invalidateQueries({ queryKey: getGetNestingCutListQueryKey(jobId) });
  };

  const compute = useComputeNesting({
    mutation: {
      onSuccess: (data) => {
        setComputed(data);
        // Default: pick option 0 (best waste%) for each group
        const defaults: Record<string, number> = {};
        for (const g of data.groups) {
          const key = `${g.profileType}|${g.profileSize}|${g.grade}`;
          defaults[key] = 0;
        }
        setSelectedOptions(defaults);
      },
      onError: (e: unknown) => {
        toast({
          title: "Nesting failed",
          description: String((e as Error).message ?? e),
          variant: "destructive",
        });
      },
    },
  });

  const accept = useAcceptNestingOption({
    mutation: {
      onSuccess: () => {
        setComputed(null);
        setShowCutList(false);
        invalidatePlan();
        toast({ title: "Nesting plan accepted" });
      },
      onError: (e: unknown) => {
        toast({
          title: "Could not accept plan",
          description: String((e as Error).message ?? e),
          variant: "destructive",
        });
      },
    },
  });

  const deletePlan = useDeleteNestingPlan({
    mutation: {
      onSuccess: () => {
        setShowCutList(false);
        invalidatePlan();
        toast({ title: "Nesting plan cleared" });
      },
    },
  });

  function handleCompute() {
    compute.mutate({
      jobId,
      data: { kerfIn: parseFloat(kerfIn) || 0.25 },
    });
  }

  function handleAccept() {
    if (!computed) return;
    const groups = computed.groups.map((g) => {
      const key = `${g.profileType}|${g.profileSize}|${g.grade}`;
      const idx = selectedOptions[key] ?? 0;
      const opt = g.options[idx];
      return {
        profileType: g.profileType,
        profileSize: g.profileSize,
        grade: g.grade,
        // Submit stable identity (vendorId + stockLengthIn) rather than array index
        // so the server always accepts the exact option the user saw.
        vendorId: opt?.vendorId ?? 0,
        stockLengthIn: opt?.stockLengthIn ?? 0,
      };
    });
    accept.mutate({
      jobId,
      data: { kerfIn: computed.kerfIn, groups },
    });
  }

  // ---
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Scissors className="w-4 h-4" />
          Material Nesting
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Accepted plan banner */}
        {planLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading plan…
          </div>
        ) : plan ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="default" className="text-xs">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Plan accepted
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {plan.groups.length} profile group
                  {plan.groups.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={() => setShowCutList((x) => !x)}
                >
                  <Printer className="w-3.5 h-3.5" />
                  {showCutList ? "Hide" : "View"} Cut List
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1 text-muted-foreground"
                  onClick={() => deletePlan.mutate({ jobId })}
                  disabled={deletePlan.isPending}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </Button>
              </div>
            </div>

            {/* Plan summary by group */}
            {!showCutList && (
              <div className="grid gap-2">
                {plan.groups.map((g) => (
                  <div
                    key={`${g.profileType}|${g.profileSize}|${g.grade}`}
                    className="flex items-center justify-between text-sm border rounded px-3 py-2"
                  >
                    <span className="font-medium">
                      {g.profileType} {g.profileSize} — {g.grade}
                    </span>
                    <div className="flex items-center gap-2 text-muted-foreground text-xs">
                      {g.bars.filter((b) => b.source === "stock").length} bar
                      {g.bars.filter((b) => b.source === "stock").length !== 1 ? "s" : ""}
                      {wasteBadge(g.wastePercent)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Cut list */}
            {showCutList && (
              <>
                {cutListLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading cut list…
                  </div>
                ) : cutList ? (
                  <CutListView cutList={cutList} />
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {/* Divider if plan exists and we're also showing compute controls */}
        {plan && <div className="border-t" />}

        {/* Compute controls */}
        {!computed ? (
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Kerf (inches)</Label>
              <Input
                value={kerfIn}
                onChange={(e) => setKerfIn(e.target.value)}
                className="h-8 w-24 text-sm"
                type="number"
                step="0.0625"
                min="0"
              />
            </div>
            <Button
              size="sm"
              onClick={handleCompute}
              disabled={compute.isPending}
              className="gap-1.5"
            >
              {compute.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Scissors className="w-3.5 h-3.5" />
              )}
              {plan ? "Re-run Nesting" : "Run Nesting"}
            </Button>
          </div>
        ) : (
          /* Computed results — option picker */
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Nesting options — pick one per profile
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setComputed(null)}
              >
                Cancel
              </Button>
            </div>

            {computed.groups.length === 0 && (
              <div className="text-sm text-muted-foreground italic">
                No nestable parts found in this job's BOM (parts need profile
                type, size, grade, and length).
              </div>
            )}

            {computed.groups.map((g) => {
              const key = `${g.profileType}|${g.profileSize}|${g.grade}`;
              return (
                <div key={key} className="space-y-1.5">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {g.profileType} {g.profileSize} — {g.grade}
                  </div>
                  <GroupOptionPicker
                    group={g}
                    selectedIdx={selectedOptions[key] ?? 0}
                    onSelect={(idx) =>
                      setSelectedOptions((s) => ({ ...s, [key]: idx }))
                    }
                  />
                </div>
              );
            })}

            {computed.groups.length > 0 && (() => {
              // Disable accept if any group has an incomplete option selected
              const hasIncomplete = computed.groups.some((g) => {
                const key = `${g.profileType}|${g.profileSize}|${g.grade}`;
                const idx = selectedOptions[key] ?? 0;
                return g.options[idx] && !g.options[idx]!.isComplete;
              });
              return (
              <Button
                onClick={handleAccept}
                disabled={accept.isPending || hasIncomplete}
                title={hasIncomplete ? "One or more selected options cannot nest all required parts — choose a longer stock length" : undefined}
                className="gap-1.5 w-full"
              >
                {accept.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                Accept Selected Options & Save Plan
              </Button>
              );
            })()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
