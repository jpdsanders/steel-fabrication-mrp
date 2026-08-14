import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListStageLibrary,
  useCreateStageLibraryItem,
  useDeleteStageLibraryItem,
  getListStageLibraryQueryKey
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Plus, GripVertical } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export default function StageLibrary() {
  const { data: stages, isLoading } = useListStageLibrary();
  const [newName, setNewName] = useState("");
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createStage = useCreateStageLibraryItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Template added" });
        queryClient.invalidateQueries({ queryKey: getListStageLibraryQueryKey() });
        setNewName("");
      }
    }
  });

  const deleteStage = useDeleteStageLibraryItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Template removed" });
        queryClient.invalidateQueries({ queryKey: getListStageLibraryQueryKey() });
      }
    }
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    createStage.mutate({ data: { name: newName.trim() } });
  };

  return (
    <div className="p-8 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Stage Library</h1>
        <p className="text-muted-foreground">Manage default production routing templates</p>
      </div>

      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleAdd} className="flex gap-2 mb-6">
            <Input 
              placeholder="New stage name (e.g. Laser Cutting)" 
              value={newName} 
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={!newName.trim() || createStage.isPending} className="gap-2">
              <Plus className="w-4 h-4" /> Add Template
            </Button>
          </form>

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : stages?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
              No stage templates configured.
            </div>
          ) : (
            <div className="space-y-2">
              {stages?.map(stage => (
                <div key={stage.id} className="flex items-center justify-between p-3 border rounded-md bg-background">
                  <div className="flex items-center gap-3">
                    <GripVertical className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">{stage.name}</span>
                  </div>
                  
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove template?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will remove "{stage.name}" from the template list. Existing jobs using this stage will not be affected.
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
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
