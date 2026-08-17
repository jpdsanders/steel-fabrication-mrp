import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Package, AlertTriangle, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface MaterialEntry {
  id: number;
  profileType: string | null;
  profileSize: string | null;
  grade: string | null;
  unitPrice: string | null;
  priceUnit: string | null;
  isStale: boolean;
  updatedAt: string;
}

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...opts });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

const PRICE_UNITS = ["cwt", "ton", "lf", "ea", "lb", "sf"];

export default function AdminMaterialCatalog() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({
    profileType: "",
    profileSize: "",
    grade: "",
    unitPrice: "",
    priceUnit: "cwt",
  });

  const { data: materials = [], isLoading } = useQuery<MaterialEntry[]>({
    queryKey: ["material-catalog"],
    queryFn: () => apiFetch(getApiUrl("material-catalog")),
    refetchInterval: 60_000,
  });

  const create = useMutation({
    mutationFn: (body: typeof form) =>
      apiFetch<MaterialEntry>(getApiUrl("material-catalog"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          unitPrice: body.unitPrice ? parseFloat(body.unitPrice) : null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["material-catalog"] });
      setShowCreate(false);
      setForm({ profileType: "", profileSize: "", grade: "", unitPrice: "", priceUnit: "cwt" });
      toast({ title: "Entry added" });
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) =>
      fetch(`${getApiUrl("material-catalog")}/${id}`, {
        method: "DELETE",
        credentials: "include",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["material-catalog"] });
      setDeleteId(null);
      toast({ title: "Entry removed" });
    },
    onError: (err) => toast({ title: "Error", description: (err as Error).message, variant: "destructive" }),
  });

  const staleCount = materials.filter((m) => m.isStale).length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Package className="h-6 w-6 text-gray-600" />
          <h1 className="text-2xl font-bold">Material Catalog</h1>
          <span className="text-sm text-gray-400 ml-2">Shared across all companies</span>
        </div>
        <Button onClick={() => setShowCreate(true)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Add Entry
        </Button>
      </div>

      {staleCount > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-md p-3 mb-4 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>
            {staleCount} {staleCount === 1 ? "entry has" : "entries have"} prices older than 90 days — review and update.
          </span>
        </div>
      )}

      {isLoading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Profile type</TableHead>
              <TableHead>Profile size</TableHead>
              <TableHead>Grade</TableHead>
              <TableHead>Unit price</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Last updated</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {materials.map((m) => (
              <TableRow key={m.id} className={m.isStale ? "bg-amber-50/50" : undefined}>
                <TableCell>{m.profileType ?? <span className="text-gray-400">—</span>}</TableCell>
                <TableCell>{m.profileSize ?? <span className="text-gray-400">—</span>}</TableCell>
                <TableCell>{m.grade ?? <span className="text-gray-400">—</span>}</TableCell>
                <TableCell>
                  {m.unitPrice != null ? (
                    `$${parseFloat(m.unitPrice).toFixed(2)}`
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </TableCell>
                <TableCell>{m.priceUnit ?? <span className="text-gray-400">—</span>}</TableCell>
                <TableCell className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className={m.isStale ? "text-amber-700" : "text-gray-500"}>
                      {new Date(m.updatedAt).toLocaleDateString()}
                    </span>
                    {m.isStale && (
                      <Badge className="bg-amber-100 text-amber-800 text-xs">Stale</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-gray-400 hover:text-red-500"
                    onClick={() => setDeleteId(m.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {materials.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-gray-400 py-8">
                  No entries yet
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Material Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Profile type</Label>
                <Input
                  value={form.profileType}
                  onChange={(e) => setForm((f) => ({ ...f, profileType: e.target.value }))}
                  placeholder="W-Shape"
                />
              </div>
              <div className="space-y-1">
                <Label>Profile size</Label>
                <Input
                  value={form.profileSize}
                  onChange={(e) => setForm((f) => ({ ...f, profileSize: e.target.value }))}
                  placeholder="W8X31"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Grade</Label>
              <Input
                value={form.grade}
                onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}
                placeholder="A992"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Unit price ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.unitPrice}
                  onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1">
                <Label>Price unit</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:ring-1 focus-visible:ring-ring"
                  value={form.priceUnit}
                  onChange={(e) => setForm((f) => ({ ...f, priceUnit: e.target.value }))}
                >
                  {PRICE_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => create.mutate(form)} disabled={create.isPending}>
              {create.isPending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this material catalog entry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteId && remove.mutate(deleteId)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
