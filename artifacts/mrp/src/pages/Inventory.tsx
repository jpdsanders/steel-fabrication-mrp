import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListInventoryItems,
  getListInventoryItemsQueryKey,
  useCreateInventoryItem,
  useConsumeInventoryItem,
  useTransferInventoryItem,
  useCommitInventoryItem,
  useUncommitInventoryItem,
  useListJobs,
  getListJobsQueryKey,
  getGetJobHeatSheetQueryKey,
  type InventoryItem,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { useToast } from "@/hooks/use-toast";
import { Package, Plus, Scissors, ArrowLeftRight, Search, Bookmark, BookmarkX } from "lucide-react";
import { formatFeetInches, parseFeetInches } from "@/lib/units";

function statusBadge(status: string, committedJobNumber?: string | null) {
  if (status === "available") return <Badge className="bg-green-600 hover:bg-green-600">Available</Badge>;
  if (status === "committed")
    return (
      <Badge className="bg-amber-500 hover:bg-amber-500">
        Reserved{committedJobNumber ? ` · ${committedJobNumber}` : ""}
      </Badge>
    );
  return <Badge variant="secondary">Consumed</Badge>;
}

export default function Inventory() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>("available");
  const [search, setSearch] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    profileType: "", profileSize: "", grade: "", quantity: "1", length: "",
    unitCost: "", isRemnant: false, notes: "",
  });

  const [consumeItem, setConsumeItem] = useState<InventoryItem | null>(null);
  const [consumeForm, setConsumeForm] = useState({ jobId: "", pieces: "1", remnantLength: "", notes: "" });

  const [transferItem, setTransferItem] = useState<InventoryItem | null>(null);
  const [transferJobId, setTransferJobId] = useState<string>("general");

  const [commitItem, setCommitItem] = useState<InventoryItem | null>(null);
  const [commitJobId, setCommitJobId] = useState<string>("");

  const queryArgs = {
    status: status === "all" ? undefined : (status as "available" | "committed" | "consumed"),
    search: search.trim() || undefined,
  };
  const { data: items, isLoading } = useListInventoryItems(queryArgs, {
    query: { queryKey: getListInventoryItemsQueryKey(queryArgs) },
  });
  const { data: jobs } = useListJobs(undefined, {
    query: { queryKey: getListJobsQueryKey() },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/inventory"], exact: false });
    queryClient.invalidateQueries({ queryKey: getListInventoryItemsQueryKey(queryArgs) });
  };

  const createItem = useCreateInventoryItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Inventory item added" });
        setAddOpen(false);
        invalidate();
      },
      onError: () => toast({ title: "Could not add item", variant: "destructive" }),
    },
  });

  const consume = useConsumeInventoryItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Material consumed", description: "Heat traceability recorded on the job's heat sheet." });
        if (consumeForm.jobId) {
          queryClient.invalidateQueries({ queryKey: getGetJobHeatSheetQueryKey(Number(consumeForm.jobId)) });
        }
        setConsumeItem(null);
        invalidate();
      },
      onError: (err: unknown) =>
        toast({
          title: "Could not consume",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        }),
    },
  });

  const transfer = useTransferInventoryItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Item transferred" });
        setTransferItem(null);
        invalidate();
      },
      onError: () => toast({ title: "Could not transfer", variant: "destructive" }),
    },
  });

  const commit = useCommitInventoryItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Item reserved", description: "This item is now committed to the selected job." });
        setCommitItem(null);
        invalidate();
      },
      onError: (err: unknown) =>
        toast({
          title: "Could not commit",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        }),
    },
  });

  const uncommit = useUncommitInventoryItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Reservation released", description: "Item returned to available stock." });
        invalidate();
      },
      onError: () => toast({ title: "Could not release reservation", variant: "destructive" }),
    },
  });

  const materialLabel = (i: InventoryItem) =>
    [i.profileType, i.profileSize, i.grade].filter(Boolean).join(" ") || "—";

  const handleAdd = () => {
    const parsed = parseFeetInches(addForm.length);
    createItem.mutate({
      data: {
        profileType: addForm.profileType.trim() || null,
        profileSize: addForm.profileSize.trim() || null,
        grade: addForm.grade.trim() || null,
        quantity: Math.max(1, Math.round(Number(addForm.quantity) || 1)),
        lengthIn: parsed === null || Number.isNaN(parsed) ? null : parsed,
        unitCost: addForm.unitCost.trim() === "" ? null : Math.max(0, Number(addForm.unitCost)),
        isRemnant: addForm.isRemnant,
        notes: addForm.notes.trim() || null,
      },
    });
  };

  const handleConsume = () => {
    if (!consumeItem || !consumeForm.jobId) return;
    const remnant = parseFeetInches(consumeForm.remnantLength);
    consume.mutate({
      itemId: consumeItem.id,
      data: {
        jobId: Number(consumeForm.jobId),
        pieces: Math.max(1, Math.round(Number(consumeForm.pieces) || 1)),
        remnantLengthIn: remnant === null || Number.isNaN(remnant) || remnant <= 0 ? null : remnant,
        notes: consumeForm.notes.trim() || null,
      },
    });
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-6 h-6" /> Inventory
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            On-hand stock and remnants with heat/CMTR traceability
          </p>
        </div>
        <Button onClick={() => { setAddForm({ profileType: "", profileSize: "", grade: "", quantity: "1", length: "", unitCost: "", isRemnant: false, notes: "" }); setAddOpen(true); }} data-testid="button-add-inventory">
          <Plus className="w-4 h-4 mr-1" /> Add stock
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 w-64"
            placeholder="Search material, heat #, PO, vendor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-inventory-search"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40" data-testid="select-inventory-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="committed">Committed</SelectItem>
            <SelectItem value="consumed">Consumed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Length</TableHead>
                <TableHead>Heat #</TableHead>
                <TableHead>PO / Vendor</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Unit cost</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(items ?? []).map((i) => (
                <TableRow key={i.id} data-testid={`inventory-row-${i.id}`}>
                  <TableCell className="whitespace-nowrap">
                    {materialLabel(i)}
                    {i.isRemnant && <Badge variant="outline" className="ml-2">Remnant</Badge>}
                  </TableCell>
                  <TableCell>{i.quantity}</TableCell>
                  <TableCell>{i.lengthIn != null ? formatFeetInches(i.lengthIn) : "—"}</TableCell>
                  <TableCell>{i.heatNumber ? <Badge variant="secondary">{i.heatNumber}</Badge> : "—"}</TableCell>
                  <TableCell className="text-sm">
                    {i.poNumber ?? "—"}
                    {i.vendorName && <div className="text-xs text-muted-foreground">{i.vendorName}</div>}
                  </TableCell>
                  <TableCell>{i.sourceJobNumber ?? <span className="text-muted-foreground">General</span>}</TableCell>
                  <TableCell>{statusBadge(i.status, i.committedJobNumber)}</TableCell>
                  <TableCell>{i.unitCost != null ? `$${i.unitCost.toFixed(2)}` : "—"}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {i.status !== "consumed" && (
                      <>
                        {i.status === "committed" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => uncommit.mutate({ itemId: i.id })}
                            disabled={uncommit.isPending}
                            data-testid={`button-uncommit-${i.id}`}
                          >
                            <BookmarkX className="w-4 h-4 mr-1" /> Uncommit
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setCommitJobId(""); setCommitItem(i); }}
                            data-testid={`button-commit-${i.id}`}
                          >
                            <Bookmark className="w-4 h-4 mr-1" /> Commit
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setConsumeForm({ jobId: "", pieces: "1", remnantLength: "", notes: "" });
                            setConsumeItem(i);
                          }}
                          data-testid={`button-consume-${i.id}`}
                        >
                          <Scissors className="w-4 h-4 mr-1" /> Consume
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setTransferJobId(i.sourceJobId ? String(i.sourceJobId) : "general"); setTransferItem(i); }}
                          data-testid={`button-transfer-${i.id}`}
                        >
                          <ArrowLeftRight className="w-4 h-4 mr-1" /> Transfer
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && (items ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    No inventory items. Stock is created automatically when POs are received.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add stock */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add stock manually</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-2">
            For general stock without a PO. Material received against a PO should be recorded
            from the purchase order's Receiving section so heat traceability is captured.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Profile type</Label>
              <Input value={addForm.profileType} onChange={(e) => setAddForm({ ...addForm, profileType: e.target.value })} placeholder="W" data-testid="input-add-profile-type" />
            </div>
            <div className="space-y-1">
              <Label>Profile size</Label>
              <Input value={addForm.profileSize} onChange={(e) => setAddForm({ ...addForm, profileSize: e.target.value })} placeholder="W12x26" data-testid="input-add-profile-size" />
            </div>
            <div className="space-y-1">
              <Label>Grade</Label>
              <Input value={addForm.grade} onChange={(e) => setAddForm({ ...addForm, grade: e.target.value })} placeholder="A992" data-testid="input-add-grade" />
            </div>
            <div className="space-y-1">
              <Label>Pieces</Label>
              <Input type="number" min={1} value={addForm.quantity} onChange={(e) => setAddForm({ ...addForm, quantity: e.target.value })} data-testid="input-add-quantity" />
            </div>
            <div className="space-y-1">
              <Label>Length</Label>
              <Input value={addForm.length} onChange={(e) => setAddForm({ ...addForm, length: e.target.value })} placeholder={`40' or 480"`} data-testid="input-add-length" />
            </div>
            <div className="space-y-1">
              <Label>Cost per piece ($)</Label>
              <Input type="number" min={0} value={addForm.unitCost} onChange={(e) => setAddForm({ ...addForm, unitCost: e.target.value })} data-testid="input-add-cost" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea value={addForm.notes} onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })} data-testid="input-add-notes" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={createItem.isPending} data-testid="button-save-inventory">
              {createItem.isPending ? "Saving..." : "Add stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Consume */}
      <Dialog open={!!consumeItem} onOpenChange={(o) => !o && setConsumeItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Consume on a job</DialogTitle>
          </DialogHeader>
          {consumeItem && (
            <div className="space-y-4">
              <p className="text-sm">
                {materialLabel(consumeItem)} — {consumeItem.quantity} pc(s) on hand
                {consumeItem.heatNumber && <> · Heat <Badge variant="secondary">{consumeItem.heatNumber}</Badge></>}
              </p>
              <div className="space-y-1">
                <Label>Job *</Label>
                <Select value={consumeForm.jobId} onValueChange={(v) => setConsumeForm({ ...consumeForm, jobId: v })}>
                  <SelectTrigger data-testid="select-consume-job">
                    <SelectValue placeholder="Select job..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(jobs ?? []).map((j) => (
                      <SelectItem key={j.id} value={String(j.id)}>
                        {j.jobNumber} — {j.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Consuming on a different job than it was received against keeps the original
                  heat/vendor/PO/CMTR references on that job's heat sheet.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Pieces</Label>
                  <Input type="number" min={1} max={consumeItem.quantity} value={consumeForm.pieces} onChange={(e) => setConsumeForm({ ...consumeForm, pieces: e.target.value })} data-testid="input-consume-pieces" />
                </div>
                <div className="space-y-1">
                  <Label>Remnant length (optional)</Label>
                  <Input value={consumeForm.remnantLength} onChange={(e) => setConsumeForm({ ...consumeForm, remnantLength: e.target.value })} placeholder={consumeForm.pieces !== "1" ? "Single-piece cuts only" : `e.g. 12' 6"`} disabled={consumeForm.pieces !== "1"} data-testid="input-remnant-length" />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Textarea value={consumeForm.notes} onChange={(e) => setConsumeForm({ ...consumeForm, notes: e.target.value })} data-testid="input-consume-notes" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConsumeItem(null)}>Cancel</Button>
            <Button onClick={handleConsume} disabled={!consumeForm.jobId || consume.isPending} data-testid="button-confirm-consume">
              {consume.isPending ? "Saving..." : "Consume"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Commit to job */}
      <Dialog open={!!commitItem} onOpenChange={(o) => !o && setCommitItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reserve for a job</DialogTitle>
          </DialogHeader>
          {commitItem && (
            <div className="space-y-4">
              <p className="text-sm">
                {materialLabel(commitItem)} — {commitItem.quantity} pc(s) ·{" "}
                {commitItem.heatNumber && <>Heat <Badge variant="secondary">{commitItem.heatNumber}</Badge></>}
              </p>
              <p className="text-xs text-muted-foreground">
                Committing reserves this item so it won't appear in other jobs' stock matches.
                You can uncommit at any time, or it clears automatically when consumed.
              </p>
              <div className="space-y-1">
                <Label>Job *</Label>
                <Select value={commitJobId} onValueChange={setCommitJobId}>
                  <SelectTrigger data-testid="select-commit-job">
                    <SelectValue placeholder="Select job..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(jobs ?? []).map((j) => (
                      <SelectItem key={j.id} value={String(j.id)}>
                        {j.jobNumber} — {j.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommitItem(null)}>Cancel</Button>
            <Button
              onClick={() =>
                commitItem && commitJobId &&
                commit.mutate({ itemId: commitItem.id, data: { jobId: Number(commitJobId) } })
              }
              disabled={!commitJobId || commit.isPending}
              data-testid="button-confirm-commit"
            >
              {commit.isPending ? "Saving..." : "Reserve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer */}
      <Dialog open={!!transferItem} onOpenChange={(o) => !o && setTransferItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer item</DialogTitle>
          </DialogHeader>
          {transferItem && (
            <div className="space-y-4">
              <p className="text-sm">{materialLabel(transferItem)} — currently {transferItem.sourceJobNumber ? `allocated to job ${transferItem.sourceJobNumber}` : "general stock"}</p>
              <div className="space-y-1">
                <Label>Move to</Label>
                <Select value={transferJobId} onValueChange={setTransferJobId}>
                  <SelectTrigger data-testid="select-transfer-job">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General stock</SelectItem>
                    {(jobs ?? []).map((j) => (
                      <SelectItem key={j.id} value={String(j.id)}>
                        {j.jobNumber} — {j.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferItem(null)}>Cancel</Button>
            <Button
              onClick={() =>
                transferItem &&
                transfer.mutate({
                  itemId: transferItem.id,
                  data: { jobId: transferJobId === "general" ? null : Number(transferJobId) },
                })
              }
              disabled={transfer.isPending}
              data-testid="button-confirm-transfer"
            >
              {transfer.isPending ? "Saving..." : "Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
