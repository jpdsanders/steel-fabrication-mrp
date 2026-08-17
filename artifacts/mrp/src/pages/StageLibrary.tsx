import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListStageLibrary,
  useCreateStageLibraryItem,
  useUpdateStageLibraryItem,
  useDeleteStageLibraryItem,
  useReorderStageLibrary,
  useGetStageLibraryRollup,
  getListStageLibraryQueryKey,
  getGetStageLibraryRollupQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Trash2,
  Plus,
  ArrowUp,
  ArrowDown,
  Pencil,
  Check,
  X,
  ShieldCheck,
  AlertTriangle,
  Factory,
  Truck,
} from "lucide-react";
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

export default function StageLibrary() {
  const { data: stages, isLoading } = useListStageLibrary();
  const { data: rollup } = useGetStageLibraryRollup();
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"in_house" | "vendor">("in_house");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListStageLibraryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetStageLibraryRollupQueryKey() });
  };
  const onError = (err: unknown) => {
    const msg =
      (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
      "Something went wrong";
    toast({ title: msg, variant: "destructive" });
  };

  const createStage = useCreateStageLibraryItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Stage added" });
        invalidate();
        setNewName("");
      },
      onError,
    },
  });
  const updateStage = useUpdateStageLibraryItem({
    mutation: {
      onSuccess: () => {
        invalidate();
        setEditingId(null);
      },
      onError,
    },
  });
  const deleteStage = useDeleteStageLibraryItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Stage removed" });
        invalidate();
      },
      onError,
    },
  });
  const reorder = useReorderStageLibrary({
    mutation: { onSuccess: invalidate, onError },
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    createStage.mutate({ data: { name: newName.trim(), stageType: newType } });
  };

  const move = (index: number, delta: number) => {
    if (!stages) return;
    const target = index + delta;
    if (target < 0 || target >= stages.length) return;
    const ids = stages.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate({ data: { itemIds: ids } });
  };

  const countFor = (stageId: number) =>
    rollup?.stages.find((s) => s.stageId === stageId)?.count ?? 0;

  return (
    <div className="p-8 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Stage Library</h1>
        <p className="text-muted-foreground">
          The production pipeline every assembly moves through, in order. The
          gate stage marks assemblies Ready to Ship; the last stage is set
          automatically when a shipment departs.
        </p>
      </div>

      {rollup && rollup.noStage > 0 && (
        <div
          className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          data-testid="banner-no-stage"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {rollup.noStage} assembl{rollup.noStage === 1 ? "y has" : "ies have"} no
          stage set on active jobs.
        </div>
      )}

      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleAdd} className="flex gap-2 mb-6">
            <Input
              placeholder="New stage name (e.g. Laser Cutting)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1"
              data-testid="input-new-stage"
            />
            <Select value={newType} onValueChange={(v) => setNewType(v as "in_house" | "vendor")}>
              <SelectTrigger className="w-36" data-testid="select-new-stage-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in_house">In-house</SelectItem>
                <SelectItem value="vendor">Vendor</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="submit"
              disabled={!newName.trim() || createStage.isPending}
              className="gap-2"
              data-testid="button-add-stage"
            >
              <Plus className="w-4 h-4" /> Add Stage
            </Button>
          </form>

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : stages?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
              No pipeline stages configured.
            </div>
          ) : (
            <div className="space-y-2">
              {stages?.map((stage, index) => {
                const count = countFor(stage.id);
                const isEditing = editingId === stage.id;
                return (
                  <div
                    key={stage.id}
                    className="flex items-center justify-between gap-2 p-3 border rounded-md bg-background"
                    data-testid={`row-stage-${stage.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="flex flex-col">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          disabled={index === 0 || reorder.isPending}
                          onClick={() => move(index, -1)}
                          data-testid={`button-move-up-${stage.id}`}
                        >
                          <ArrowUp className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          disabled={index === (stages?.length ?? 0) - 1 || reorder.isPending}
                          onClick={() => move(index, 1)}
                          data-testid={`button-move-down-${stage.id}`}
                        >
                          <ArrowDown className="w-3 h-3" />
                        </Button>
                      </div>
                      <span className="text-xs text-muted-foreground w-5 text-right">
                        {index + 1}.
                      </span>
                      {isEditing ? (
                        <form
                          className="flex items-center gap-1 flex-1"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (!editName.trim()) return;
                            updateStage.mutate({
                              itemId: stage.id,
                              data: { name: editName.trim() },
                            });
                          }}
                        >
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="h-8"
                            autoFocus
                            data-testid={`input-rename-${stage.id}`}
                          />
                          <Button type="submit" size="icon" variant="ghost" className="h-8 w-8">
                            <Check className="w-4 h-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => setEditingId(null)}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </form>
                      ) : (
                        <>
                          <span className="font-medium truncate">{stage.name}</span>
                          <Badge variant="outline" className="gap-1 shrink-0">
                            {stage.stageType === "vendor" ? (
                              <Truck className="w-3 h-3" />
                            ) : (
                              <Factory className="w-3 h-3" />
                            )}
                            {stage.stageType === "vendor" ? "Vendor" : "In-house"}
                          </Badge>
                          {stage.isReadyToShipGate && (
                            <Badge className="gap-1 shrink-0 bg-emerald-600 hover:bg-emerald-600">
                              <ShieldCheck className="w-3 h-3" /> RTS Gate
                            </Badge>
                          )}
                          {count > 0 && (
                            <Badge variant="secondary" className="shrink-0" data-testid={`badge-count-${stage.id}`}>
                              {count} in stage
                            </Badge>
                          )}
                        </>
                      )}
                    </div>

                    {!isEditing && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Select
                          value={stage.stageType}
                          onValueChange={(v) =>
                            updateStage.mutate({
                              itemId: stage.id,
                              data: { stageType: v as "in_house" | "vendor" },
                            })
                          }
                        >
                          <SelectTrigger className="h-8 w-28 text-xs" data-testid={`select-type-${stage.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="in_house">In-house</SelectItem>
                            <SelectItem value="vendor">Vendor</SelectItem>
                          </SelectContent>
                        </Select>
                        {!stage.isReadyToShipGate && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() =>
                              updateStage.mutate({
                                itemId: stage.id,
                                data: { isReadyToShipGate: true },
                              })
                            }
                            data-testid={`button-set-gate-${stage.id}`}
                          >
                            Set gate
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            setEditingId(stage.id);
                            setEditName(stage.name);
                          }}
                          data-testid={`button-rename-${stage.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              data-testid={`button-delete-${stage.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove stage?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes "{stage.name}" from the pipeline. Removal
                                is blocked while any assembly sits in this stage or if
                                it is the Ready-to-Ship gate.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive hover:bg-destructive/90"
                                onClick={() => deleteStage.mutate({ itemId: stage.id })}
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
