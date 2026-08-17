import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListVendorCategories,
  getListVendorCategoriesQueryKey,
  useCreateVendorCategory,
  useUpdateVendorCategory,
  useDeleteVendorCategory,
  useListQualityClauses,
  getListQualityClausesQueryKey,
  useCreateQualityClause,
  useUpdateQualityClause,
  useDeleteQualityClause,
  useListApprovalThresholds,
  getListApprovalThresholdsQueryKey,
  useReplaceApprovalThresholds,
  type QualityClause,
  type QualityClauseInput,
  type ApprovalThreshold,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { apiErrorMessage } from "@/components/purchasing/vendorStatus";

const ROLES = [
  "purchasing",
  "admin",
  "estimator",
  "doc_control",
  "shop_foreman",
  "qc",
  "shipping",
] as const;

const AUTO_APPROVE = "__auto__";

function roleLabel(role: string): string {
  return role
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Vendor categories card
// ---------------------------------------------------------------------------

function VendorCategoriesCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  const { data: categories, isLoading } = useListVendorCategories({
    query: { queryKey: getListVendorCategoriesQueryKey() },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getListVendorCategoriesQueryKey(),
    });

  const onError = (err: unknown) =>
    toast({
      title: "Could not save category",
      description: apiErrorMessage(err, "Please try again."),
      variant: "destructive",
    });

  const createCat = useCreateVendorCategory({
    mutation: {
      onSuccess: () => {
        toast({ title: "Category added" });
        setNewName("");
        invalidate();
      },
      onError,
    },
  });
  const updateCat = useUpdateVendorCategory({
    mutation: {
      onSuccess: () => {
        toast({ title: "Category renamed" });
        setEditId(null);
        invalidate();
      },
      onError,
    },
  });
  const deleteCat = useDeleteVendorCategory({
    mutation: {
      onSuccess: () => {
        toast({ title: "Category removed" });
        invalidate();
      },
      onError: (err) =>
        toast({
          title: "Could not delete category",
          description: apiErrorMessage(err, "Please try again."),
          variant: "destructive",
        }),
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vendor Categories</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex gap-2 mb-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            createCat.mutate({ data: { name: newName.trim() } });
          }}
        >
          <Input
            placeholder="New category (e.g. Structural steel)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1"
            data-testid="input-new-category"
          />
          <Button
            type="submit"
            disabled={!newName.trim() || createCat.isPending}
            className="gap-2"
            data-testid="button-add-category"
          >
            <Plus className="w-4 h-4" /> Add
          </Button>
        </form>

        {isLoading ? (
          <div className="text-center py-6 text-muted-foreground">Loading...</div>
        ) : categories && categories.length > 0 ? (
          <div className="space-y-2">
            {categories.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between p-3 border rounded-md"
                data-testid={`category-row-${c.id}`}
              >
                {editId === c.id ? (
                  <div className="flex gap-2 flex-1 mr-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-8"
                      data-testid={`input-edit-category-${c.id}`}
                    />
                    <Button
                      size="icon"
                      className="h-8 w-8"
                      disabled={!editName.trim() || updateCat.isPending}
                      onClick={() =>
                        updateCat.mutate({
                          categoryId: c.id,
                          data: { name: editName.trim() },
                        })
                      }
                    >
                      <Check className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => setEditId(null)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <span className="font-medium">{c.name}</span>
                )}

                {editId !== c.id && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        setEditId(c.id);
                        setEditName(c.name);
                      }}
                      data-testid={`button-rename-category-${c.id}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          data-testid={`button-delete-category-${c.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete {c.name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Vendors in this category will keep their record but
                            lose the category assignment.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive hover:bg-destructive/90"
                            onClick={() =>
                              deleteCat.mutate({ categoryId: c.id })
                            }
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground border-2 border-dashed rounded-lg">
            No vendor categories yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Quality clause library card
// ---------------------------------------------------------------------------

interface ClauseForm {
  code: string;
  title: string;
  description: string;
  active: boolean;
}

function QualityClausesCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<QualityClause | null>(null);
  const [form, setForm] = useState<ClauseForm>({
    code: "",
    title: "",
    description: "",
    active: true,
  });

  const { data: clauses, isLoading } = useListQualityClauses({
    query: { queryKey: getListQualityClausesQueryKey() },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListQualityClausesQueryKey() });

  const onError = (err: unknown) =>
    toast({
      title: "Could not save quality clause",
      description: apiErrorMessage(err, "Please try again."),
      variant: "destructive",
    });

  const createClause = useCreateQualityClause({
    mutation: {
      onSuccess: () => {
        toast({ title: "Quality clause added" });
        invalidate();
        setDialogOpen(false);
      },
      onError,
    },
  });
  const updateClause = useUpdateQualityClause({
    mutation: {
      onSuccess: () => {
        toast({ title: "Quality clause updated" });
        invalidate();
        setDialogOpen(false);
      },
      onError,
    },
  });
  const deleteClause = useDeleteQualityClause({
    mutation: {
      onSuccess: () => {
        toast({ title: "Quality clause removed" });
        invalidate();
      },
      onError: (err) =>
        toast({
          title: "Could not delete quality clause",
          description: apiErrorMessage(err, "Please try again."),
          variant: "destructive",
        }),
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ code: "", title: "", description: "", active: true });
    setDialogOpen(true);
  };
  const openEdit = (c: QualityClause) => {
    setEditing(c);
    setForm({
      code: c.code,
      title: c.title,
      description: c.description ?? "",
      active: c.active,
    });
    setDialogOpen(true);
  };

  const toggleActive = (c: QualityClause, active: boolean) => {
    updateClause.mutate({
      clauseId: c.id,
      data: {
        code: c.code,
        title: c.title,
        description: c.description ?? null,
        active,
      },
    });
  };

  const handleSubmit = () => {
    const data: QualityClauseInput = {
      code: form.code.trim(),
      title: form.title.trim(),
      description: form.description.trim() || null,
      active: form.active,
    };
    if (!data.code || !data.title) return;
    if (editing) {
      updateClause.mutate({ clauseId: editing.id, data });
    } else {
      createClause.mutate({ data });
    }
  };

  const saving = createClause.isPending || updateClause.isPending;

  return (
    <Card>
      <CardHeader className="flex flex-row justify-between items-center">
        <CardTitle>Quality Clause Library</CardTitle>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={openCreate}
          data-testid="button-new-clause"
        >
          <Plus className="w-4 h-4" /> Add clause
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-6 text-muted-foreground">Loading...</div>
        ) : clauses && clauses.length > 0 ? (
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Code</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-24 text-center">Active</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {clauses.map((c) => (
                  <TableRow key={c.id} data-testid={`clause-row-${c.id}`}>
                    <TableCell className="font-mono">{c.code}</TableCell>
                    <TableCell className="font-medium">{c.title}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.description ?? "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={c.active}
                        onCheckedChange={(v) => toggleActive(c, v)}
                        data-testid={`switch-clause-active-${c.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(c)}
                          data-testid={`button-edit-clause-${c.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              data-testid={`button-delete-clause-${c.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Delete clause {c.code}?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes "{c.title}" from the library.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive hover:bg-destructive/90"
                                onClick={() =>
                                  deleteClause.mutate({ clauseId: c.id })
                                }
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground border-2 border-dashed rounded-lg">
            No quality clauses yet.
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Quality Clause" : "New Quality Clause"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2 col-span-1">
                <Label htmlFor="clause-code">Code</Label>
                <Input
                  id="clause-code"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="Q-01"
                  data-testid="input-clause-code"
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="clause-title">Title</Label>
                <Input
                  id="clause-title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Mill test reports required"
                  data-testid="input-clause-title"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="clause-description">Description</Label>
              <Textarea
                id="clause-description"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                data-testid="input-clause-description"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm({ ...form, active: v })}
                data-testid="switch-clause-active"
              />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={saving || !form.code.trim() || !form.title.trim()}
              data-testid="button-save-clause"
            >
              {saving ? "Saving..." : editing ? "Save changes" : "Add clause"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Approval thresholds card
// ---------------------------------------------------------------------------

interface TierRow {
  minTotal: string;
  label: string;
  requiredRole: string; // AUTO_APPROVE or a role
}

function tierFromThreshold(t: ApprovalThreshold): TierRow {
  return {
    minTotal: String(t.minTotal),
    label: t.label,
    requiredRole: t.requiredRole ?? AUTO_APPROVE,
  };
}

function ApprovalThresholdsCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tiers, setTiers] = useState<TierRow[]>([]);

  const { data: thresholds, isLoading } = useListApprovalThresholds({
    query: { queryKey: getListApprovalThresholdsQueryKey() },
  });

  useEffect(() => {
    if (thresholds) {
      setTiers(
        [...thresholds]
          .sort((a, b) => a.minTotal - b.minTotal)
          .map(tierFromThreshold),
      );
    }
  }, [thresholds]);

  const replaceThresholds = useReplaceApprovalThresholds({
    mutation: {
      onSuccess: () => {
        toast({ title: "Approval thresholds saved" });
        queryClient.invalidateQueries({
          queryKey: getListApprovalThresholdsQueryKey(),
        });
      },
      onError: (err) =>
        toast({
          title: "Could not save thresholds",
          description: apiErrorMessage(err, "Check the tier matrix and retry."),
          variant: "destructive",
        }),
    },
  });

  const update = (index: number, patch: Partial<TierRow>) =>
    setTiers(tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)));

  const addTier = () =>
    setTiers([...tiers, { minTotal: "", label: "", requiredRole: AUTO_APPROVE }]);

  const removeTier = (index: number) =>
    setTiers(tiers.filter((_, i) => i !== index));

  const handleSave = () => {
    replaceThresholds.mutate({
      data: {
        tiers: tiers.map((t) => ({
          minTotal: Number(t.minTotal) || 0,
          label: t.label.trim(),
          requiredRole:
            t.requiredRole === AUTO_APPROVE ? null : t.requiredRole,
        })),
      },
    });
  };

  const hasZeroTier = tiers.some((t) => (Number(t.minTotal) || 0) === 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval Thresholds</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          PO approval requirements by dollar amount. One tier must start at $0.
          Choose "Auto-approve" to skip approval for a tier.
        </p>
        {isLoading ? (
          <div className="text-center py-6 text-muted-foreground">Loading...</div>
        ) : (
          <>
            <div className="space-y-2">
              <div className="grid grid-cols-[140px_1fr_180px_40px] gap-2 text-xs font-medium text-muted-foreground px-1">
                <span>Min total ($)</span>
                <span>Label</span>
                <span>Required role</span>
                <span />
              </div>
              {tiers.map((t, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[140px_1fr_180px_40px] gap-2 items-center"
                  data-testid={`tier-row-${i}`}
                >
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={t.minTotal}
                    onChange={(e) => update(i, { minTotal: e.target.value })}
                    className="h-9"
                    data-testid={`input-tier-min-${i}`}
                  />
                  <Input
                    value={t.label}
                    onChange={(e) => update(i, { label: e.target.value })}
                    placeholder="e.g. Under $5k"
                    className="h-9"
                    data-testid={`input-tier-label-${i}`}
                  />
                  <Select
                    value={t.requiredRole}
                    onValueChange={(v) => update(i, { requiredRole: v })}
                  >
                    <SelectTrigger
                      className="h-9"
                      data-testid={`select-tier-role-${i}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTO_APPROVE}>
                        Auto-approve (none)
                      </SelectItem>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {roleLabel(r)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-destructive"
                    onClick={() => removeTier(i)}
                    data-testid={`button-remove-tier-${i}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex justify-between items-center mt-4">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={addTier}
                data-testid="button-add-tier"
              >
                <Plus className="w-4 h-4" /> Add tier
              </Button>
              <Button
                onClick={handleSave}
                disabled={replaceThresholds.isPending || tiers.length === 0}
                data-testid="button-save-tiers"
              >
                {replaceThresholds.isPending ? "Saving..." : "Save thresholds"}
              </Button>
            </div>
            {!hasZeroTier && tiers.length > 0 && (
              <p className="text-xs text-destructive mt-2">
                One tier must have a minimum of $0.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export default function PurchasingSettings() {
  const [, setLocation] = useLocation();
  return (
    <div className="p-8 space-y-6 max-w-4xl mx-auto">
      <div>
        <Button
          variant="ghost"
          onClick={() => setLocation("/purchasing")}
          className="gap-2 -ml-4 mb-2"
        >
          <ChevronLeft className="w-4 h-4" /> Back to Purchasing
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">Purchasing Settings</h1>
        <p className="text-muted-foreground mt-1">
          Vendor categories, quality clauses, and approval thresholds
        </p>
      </div>

      <VendorCategoriesCard />
      <QualityClausesCard />
      <ApprovalThresholdsCard />
    </div>
  );
}
