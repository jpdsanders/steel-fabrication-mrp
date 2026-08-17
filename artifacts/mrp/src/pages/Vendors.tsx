import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListVendors,
  getListVendorsQueryKey,
  useCreateVendor,
  useUpdateVendor,
  useDeleteVendor,
  useListVendorCategories,
  getListVendorCategoriesQueryKey,
  type Vendor,
  type VendorInput,
  type VendorStatus,
  type ListVendorsParams,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Search, Plus, Pencil, Trash2 } from "lucide-react";
import {
  vendorStatusBadge,
  apiErrorMessage,
} from "@/components/purchasing/vendorStatus";
import VendorStockLengths from "@/components/vendors/VendorStockLengths";

const STATUS_OPTIONS: VendorStatus[] = [
  "approved",
  "conditional",
  "suspended",
  "disqualified",
];

const NO_CATEGORY = "__none__";

interface FormState {
  name: string;
  categoryId: string;
  status: VendorStatus;
  scopeOfApproval: string;
  coiExpiration: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes: string;
}

function emptyForm(): FormState {
  return {
    name: "",
    categoryId: NO_CATEGORY,
    status: "approved",
    scopeOfApproval: "",
    coiExpiration: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    notes: "",
  };
}

function formFromVendor(v: Vendor): FormState {
  return {
    name: v.name,
    categoryId: v.categoryId != null ? String(v.categoryId) : NO_CATEGORY,
    status: v.status,
    scopeOfApproval: v.scopeOfApproval ?? "",
    coiExpiration: v.coiExpiration ?? "",
    contactName: v.contactName ?? "",
    contactEmail: v.contactEmail ?? "",
    contactPhone: v.contactPhone ?? "",
    notes: v.notes ?? "",
  };
}

function toInput(form: FormState): VendorInput {
  return {
    name: form.name.trim(),
    categoryId:
      form.categoryId === NO_CATEGORY ? null : Number(form.categoryId),
    status: form.status,
    scopeOfApproval: form.scopeOfApproval.trim() || null,
    coiExpiration: form.coiExpiration || null,
    contactName: form.contactName.trim() || null,
    contactEmail: form.contactEmail.trim() || null,
    contactPhone: form.contactPhone.trim() || null,
    notes: form.notes.trim() || null,
  };
}

export default function Vendors() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const params: ListVendorsParams =
    status !== "all" ? { status: status as VendorStatus } : {};
  const { data: vendors, isLoading } = useListVendors(params, {
    query: { queryKey: getListVendorsQueryKey(params) },
  });
  const { data: categories } = useListVendorCategories({
    query: { queryKey: getListVendorCategoriesQueryKey() },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() });

  const createVendor = useCreateVendor({
    mutation: {
      onSuccess: () => {
        toast({ title: "Vendor added" });
        invalidate();
        setDialogOpen(false);
      },
      onError: (err) =>
        toast({
          title: "Could not save vendor",
          description: apiErrorMessage(err, "Please try again."),
          variant: "destructive",
        }),
    },
  });

  const updateVendor = useUpdateVendor({
    mutation: {
      onSuccess: () => {
        toast({ title: "Vendor updated" });
        invalidate();
        setDialogOpen(false);
      },
      onError: (err) =>
        toast({
          title: "Could not save vendor",
          description: apiErrorMessage(err, "Please try again."),
          variant: "destructive",
        }),
    },
  });

  const deleteVendor = useDeleteVendor({
    mutation: {
      onSuccess: () => {
        toast({ title: "Vendor deleted" });
        invalidate();
      },
      onError: (err) =>
        toast({
          title: "Could not delete vendor",
          description: apiErrorMessage(
            err,
            "This vendor may be referenced by purchase orders.",
          ),
          variant: "destructive",
        }),
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (v: Vendor) => {
    setEditing(v);
    setForm(formFromVendor(v));
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const data = toInput(form);
    if (!data.name) return;
    if (editing) {
      updateVendor.mutate({ vendorId: editing.id, data });
    } else {
      createVendor.mutate({ data });
    }
  };

  const filtered = (vendors ?? []).filter((v) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      v.name.toLowerCase().includes(q) ||
      (v.categoryName ?? "").toLowerCase().includes(q) ||
      (v.contactName ?? "").toLowerCase().includes(q)
    );
  });

  const saving = createVendor.isPending || updateVendor.isPending;

  return (
    <div className="p-8 space-y-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Vendors</h1>
          <p className="text-muted-foreground mt-1">
            Approved vendor list (AVL) and supplier records
          </p>
        </div>
        <Button className="gap-2" onClick={openCreate} data-testid="button-new-vendor">
          <Plus className="w-4 h-4" /> New Vendor
        </Button>
      </div>

      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search vendors..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-vendor-search"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px]" data-testid="select-vendor-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : filtered.length > 0 ? (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>COI expiration</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((v) => (
                <TableRow key={v.id} data-testid={`vendor-row-${v.id}`}>
                  <TableCell className="font-medium">
                    {v.name}
                    {v.contactName && (
                      <div className="text-xs text-muted-foreground">
                        {v.contactName}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{v.categoryName ?? "—"}</TableCell>
                  <TableCell>{vendorStatusBadge(v.status)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{v.coiExpiration ?? "—"}</span>
                      {v.coiLapsed && (
                        <Badge
                          className="bg-red-600 hover:bg-red-600 text-white border-transparent"
                          data-testid={`vendor-coi-lapsed-${v.id}`}
                        >
                          COI lapsed
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(v)}
                        data-testid={`button-edit-vendor-${v.id}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            data-testid={`button-delete-vendor-${v.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {v.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This removes the vendor from the AVL. Vendors
                              referenced by purchase orders cannot be deleted.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive hover:bg-destructive/90"
                              onClick={() => deleteVendor.mutate({ vendorId: v.id })}
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
        <div className="text-center text-muted-foreground py-16 border rounded-md">
          No vendors found. Add one to build your approved vendor list.
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Vendor" : "New Vendor"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="vendor-name">Name</Label>
              <Input
                id="vendor-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Acme Steel Supply"
                data-testid="input-vendor-name"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={form.categoryId}
                  onValueChange={(v) => setForm({ ...form, categoryId: v })}
                >
                  <SelectTrigger data-testid="select-vendor-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY}>No category</SelectItem>
                    {(categories ?? []).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) =>
                    setForm({ ...form, status: v as VendorStatus })
                  }
                >
                  <SelectTrigger data-testid="select-vendor-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="vendor-scope">Scope of approval</Label>
              <Textarea
                id="vendor-scope"
                value={form.scopeOfApproval}
                onChange={(e) =>
                  setForm({ ...form, scopeOfApproval: e.target.value })
                }
                placeholder="What this vendor is approved to supply..."
                data-testid="input-vendor-scope"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="vendor-coi">COI expiration</Label>
              <Input
                id="vendor-coi"
                type="date"
                value={form.coiExpiration}
                onChange={(e) =>
                  setForm({ ...form, coiExpiration: e.target.value })
                }
                className="w-52"
                data-testid="input-vendor-coi"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vendor-contact-name">Contact name</Label>
                <Input
                  id="vendor-contact-name"
                  value={form.contactName}
                  onChange={(e) =>
                    setForm({ ...form, contactName: e.target.value })
                  }
                  data-testid="input-vendor-contact-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendor-contact-email">Contact email</Label>
                <Input
                  id="vendor-contact-email"
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) =>
                    setForm({ ...form, contactEmail: e.target.value })
                  }
                  data-testid="input-vendor-contact-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendor-contact-phone">Contact phone</Label>
                <Input
                  id="vendor-contact-phone"
                  value={form.contactPhone}
                  onChange={(e) =>
                    setForm({ ...form, contactPhone: e.target.value })
                  }
                  data-testid="input-vendor-contact-phone"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="vendor-notes">Notes</Label>
              <Textarea
                id="vendor-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                data-testid="input-vendor-notes"
              />
            </div>

            {editing && (
              <div className="border-t pt-4">
                <VendorStockLengths vendorId={editing.id} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={saving || !form.name.trim()}
              data-testid="button-save-vendor"
            >
              {saving ? "Saving..." : editing ? "Save changes" : "Add vendor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
