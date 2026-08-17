/**
 * VendorStockLengths — manage standard stock lengths for a single vendor.
 * Rendered inside the vendor detail dialog on the Vendors page.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListVendorStockLengths,
  useCreateVendorStockLength,
  useDeleteVendorStockLength,
  getListVendorStockLengthsQueryKey,
  type VendorStockLength,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Plus, Trash2, Loader2 } from "lucide-react";

function inToFt(inches: number): string {
  const ft = Math.floor(inches / 12);
  const inRem = Math.round((inches % 12) * 1000) / 1000;
  if (inRem === 0) return `${ft}'`;
  return `${ft}'-${inRem}"`;
}

interface Props {
  vendorId: number;
}

export default function VendorStockLengths({ vendorId }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: stockLengths, isLoading } = useListVendorStockLengths(vendorId);

  const [profileType, setProfileType] = useState("");
  const [lengthFt, setLengthFt] = useState("");
  const [lengthIn, setLengthIn] = useState("");
  const [notes, setNotes] = useState("");

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getListVendorStockLengthsQueryKey(vendorId),
    });

  const create = useCreateVendorStockLength({
    mutation: {
      onSuccess: () => {
        setProfileType("");
        setLengthFt("");
        setLengthIn("");
        setNotes("");
        invalidate();
        toast({ title: "Stock length added" });
      },
      onError: (e: unknown) => {
        toast({
          title: "Could not add",
          description: String((e as Error).message ?? e),
          variant: "destructive",
        });
      },
    },
  });

  const remove = useDeleteVendorStockLength({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Removed" });
      },
    },
  });

  function handleAdd() {
    const ft = parseFloat(lengthFt) || 0;
    const inches = parseFloat(lengthIn) || 0;
    const totalIn = ft * 12 + inches;
    if (totalIn <= 0) {
      toast({
        title: "Enter a valid length",
        description: "Feet and/or inches must total more than 0.",
        variant: "destructive",
      });
      return;
    }
    create.mutate({
      vendorId,
      data: {
        profileType: profileType.trim() || null,
        lengthIn: totalIn,
        notes: notes.trim() || null,
      },
    });
  }

  return (
    <div className="space-y-4 pt-2">
      <div className="text-sm font-medium">Standard Stock Lengths</div>
      <p className="text-xs text-muted-foreground">
        Stock lengths the nesting engine will offer when this vendor is selected.
        Leave "Profile type" blank to apply a length to all profiles this vendor
        supplies.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : stockLengths && stockLengths.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs h-7">Profile type</TableHead>
              <TableHead className="text-xs h-7">Length</TableHead>
              <TableHead className="text-xs h-7">Notes</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {stockLengths.map((sl: VendorStockLength) => (
              <TableRow key={sl.id}>
                <TableCell className="text-xs py-1.5">
                  {sl.profileType ?? <span className="text-muted-foreground italic">All profiles</span>}
                </TableCell>
                <TableCell className="text-xs py-1.5 font-mono">
                  {inToFt(sl.lengthIn)}{" "}
                  <span className="text-muted-foreground">
                    ({sl.lengthIn}"  / {(sl.lengthIn / 12).toFixed(2)}')
                  </span>
                </TableCell>
                <TableCell className="text-xs py-1.5 text-muted-foreground">
                  {sl.notes ?? "—"}
                </TableCell>
                <TableCell className="py-1">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove stock length?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will remove {inToFt(sl.lengthIn)}
                          {sl.profileType ? ` (${sl.profileType})` : ""} from
                          this vendor's nesting options.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() =>
                            remove.mutate({ vendorId, stockLengthId: sl.id })
                          }
                        >
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="text-xs text-muted-foreground italic border rounded p-3 text-center">
          No stock lengths configured yet.
        </div>
      )}

      {/* Add form */}
      <div className="border rounded-md p-3 space-y-3 bg-muted/30">
        <div className="text-xs font-medium">Add stock length</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Profile type (optional)</Label>
            <Input
              placeholder="e.g. W, HSS, L — leave blank for all"
              value={profileType}
              onChange={(e) => setProfileType(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Feet</Label>
            <Input
              type="number"
              min="0"
              step="1"
              placeholder="40"
              value={lengthFt}
              onChange={(e) => setLengthFt(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Inches</Label>
            <Input
              type="number"
              min="0"
              step="0.25"
              placeholder="0"
              value={lengthIn}
              onChange={(e) => setLengthIn(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Notes (optional)</Label>
            <Input
              placeholder="e.g. standard mill length"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
        </div>
        <Button
          size="sm"
          onClick={handleAdd}
          disabled={create.isPending}
          className="gap-1.5 h-7 text-xs"
        >
          {create.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Plus className="w-3 h-3" />
          )}
          Add
        </Button>
      </div>
    </div>
  );
}
