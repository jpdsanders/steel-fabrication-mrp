import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCommitEstimateBomImport,
  getGetEstimateBomQueryKey,
  getGetEstimatePricingQueryKey,
  getGetEstimateRfqQueryKey,
  type EstimateBomImportPreview,
  type EstimateBomMaterialResolution,
  EstimateBomMaterialResolutionAction,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatFeetInches } from "@/lib/units";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { getApiUrl } from "@/lib/api";

export async function parseEstimateBomFile(estimateId: number, file: File): Promise<EstimateBomImportPreview> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(getApiUrl(`estimates/${estimateId}/bom/parse`), {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error || "Could not parse the file.");
  }
  return body as EstimateBomImportPreview;
}

/**
 * Material-review + commit wizard for KISS / PowerFab XML imports into an
 * estimate. Shared by the estimate detail BOM card and the Import page so
 * the resolution / commit logic lives in one place.
 */
export function EstimateBomImportWizard({
  estimateId,
  preview,
  open,
  replacingExisting,
  onClose,
  onImported,
}: {
  estimateId: number;
  preview: EstimateBomImportPreview | null;
  open: boolean;
  replacingExisting: boolean;
  onClose: () => void;
  onImported?: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [resolutions, setResolutions] = useState<Record<string, EstimateBomMaterialResolution>>({});

  // Seed auto-resolutions for catalog-matched materials whenever a new preview arrives.
  useEffect(() => {
    if (!preview) {
      setResolutions({});
      return;
    }
    const initial: Record<string, EstimateBomMaterialResolution> = {};
    preview.materials.forEach((mat) => {
      if (mat.matched && mat.catalogItemId) {
        initial[mat.key] = { key: mat.key, action: "match", catalogItemId: mat.catalogItemId };
      }
    });
    setResolutions(initial);
  }, [preview]);

  const commit = useCommitEstimateBomImport({
    mutation: {
      onSuccess: () => {
        toast({ title: "BOM imported successfully" });
        queryClient.invalidateQueries({ queryKey: getGetEstimateBomQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getGetEstimatePricingQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getGetEstimateRfqQueryKey(estimateId) });
        onImported?.();
        onClose();
      },
      onError: (err) =>
        toast({
          title: "Failed to import BOM",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        }),
    },
  });

  const updateResolution = (key: string, data: Partial<EstimateBomMaterialResolution>) => {
    setResolutions((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || { key, action: "needs_quote" }),
        ...data,
      } as EstimateBomMaterialResolution,
    }));
  };

  const handleCommit = () => {
    if (!preview) return;
    const missing = preview.materials.filter((m) => !resolutions[m.key]);
    if (missing.length > 0) {
      toast({ title: "Missing resolutions", description: "Please review all unmatched materials.", variant: "destructive" });
      return;
    }
    commit.mutate({
      estimateId,
      data: {
        assemblies: preview.bom.assemblies.map((a) => ({
          mark: a.mark,
          quantity: a.quantity,
          description: a.description,
          finish: a.finish,
          parts: a.parts.map((p) => ({
            partMark: p.partMark,
            quantity: p.quantity,
            profileType: p.profileType,
            profileSize: p.profileSize,
            grade: p.grade,
            lengthIn: p.lengthIn,
            description: p.description,
          })),
        })),
        resolutions: Object.values(resolutions),
      },
    });
  };

  const unmatchedCount = preview ? preview.materials.filter((m) => !m.matched).length : 0;
  const isWizardComplete =
    preview &&
    preview.materials.every((m) => {
      const r = resolutions[m.key];
      if (!r) return false;
      if (r.action === "manual") return r.manualUnitPrice != null && r.manualUnitPrice > 0;
      return true;
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review Materials</DialogTitle>
        </DialogHeader>

        {preview && (
          <div className="space-y-6">
            {replacingExisting && (
              <div className="bg-destructive/10 text-destructive p-3 rounded-md flex gap-2 text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <div>
                  This estimate already has a BOM. Importing will replace all existing assemblies, parts, and manual
                  pricing with the contents of this file.
                </div>
              </div>
            )}

            {unmatchedCount > 0 && (
              <div
                className="bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-900 p-3 rounded-md flex gap-2 text-sm"
                data-testid="banner-unmatched-materials"
              >
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <div>
                  <span className="font-semibold">
                    {unmatchedCount} material{unmatchedCount === 1 ? "" : "s"} need{unmatchedCount === 1 ? "s" : ""} a
                    manual price or RFQ decision
                  </span>{" "}
                  — they did not match the catalog and will not be priced automatically. Resolve each one below before
                  committing.
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4">
              <Card>
                <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Matched</CardTitle></CardHeader>
                <CardContent className="py-2 px-4 text-2xl font-bold text-green-600">
                  {preview.materials.filter((m) => m.matched).length}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Need Review</CardTitle></CardHeader>
                <CardContent className="py-2 px-4 text-2xl font-bold text-amber-600">{unmatchedCount}</CardContent>
              </Card>
              <Card>
                <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Total Groups</CardTitle></CardHeader>
                <CardContent className="py-2 px-4 text-2xl font-bold">{preview.materials.length}</CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-medium">Unmatched Materials</h3>
              <p className="text-xs text-muted-foreground">
                The following materials could not be automatically matched to your catalog. You must decide how to
                handle each one before importing.
              </p>

              <div className="border rounded-md divide-y">
                {preview.materials.filter((m) => !m.matched).map((mat) => {
                  const res = resolutions[mat.key] || { action: "needs_quote" };
                  return (
                    <div key={mat.key} className="p-4 bg-muted/10 flex flex-col gap-4">
                      <div className="flex justify-between">
                        <div className="font-mono text-sm font-semibold">
                          {mat.profileType || ""} {mat.profileSize || ""} {mat.grade || ""}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {mat.pieces} pieces • {formatFeetInches(mat.totalLengthIn)} total length
                        </div>
                      </div>

                      <div className="flex items-start gap-4">
                        <div className="w-48 shrink-0">
                          <Select
                            value={res.action}
                            onValueChange={(val: EstimateBomMaterialResolutionAction) =>
                              updateResolution(mat.key, { action: val })
                            }
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
                          {res.action === "needs_quote" && (
                            <div className="flex items-center gap-2 h-10 px-3 bg-amber-50 text-amber-700 rounded-md text-sm">
                              <AlertTriangle className="w-4 h-4" /> Will be excluded from material total until quoted
                            </div>
                          )}

                          {res.action === "manual" && (
                            <div className="flex gap-2">
                              <div className="flex items-center">
                                <span className="text-muted-foreground bg-muted h-10 flex items-center px-3 border border-r-0 rounded-l-md border-input">$</span>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  className="rounded-l-none w-24"
                                  placeholder="0.00"
                                  value={res.manualUnitPrice || ""}
                                  onChange={(e) => updateResolution(mat.key, { manualUnitPrice: Number(e.target.value) || 0 })}
                                />
                              </div>
                              <div>
                                <Select
                                  value={res.manualPriceUnit || "per_foot"}
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
                                value={res.quoteSource || ""}
                                onChange={(e) => updateResolution(mat.key, { quoteSource: e.target.value })}
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
                        <Label htmlFor={`misc-${mat.key}`} className="text-xs font-normal">
                          Flag as Misc/Hardware (always included in RFQ)
                        </Label>
                      </div>
                    </div>
                  );
                })}
                {unmatchedCount === 0 && (
                  <div className="p-8 text-center text-sm text-green-600 flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-5 h-5" /> All materials matched the catalog!
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCommit} disabled={commit.isPending || !isWizardComplete} data-testid="button-commit-bom">
            {commit.isPending ? "Importing..." : "Commit BOM"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
