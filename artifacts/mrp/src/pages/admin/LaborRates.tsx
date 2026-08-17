import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListLaborRates,
  useCreateLaborRate,
  useUpdateLaborRate,
  useDeleteLaborRate,
  getListLaborRatesQueryKey
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, ShieldAlert } from "lucide-react";

export default function AdminLaborRates() {
  const { data: rates, isLoading } = useListLaborRates();
  
  return (
    <div className="p-8 space-y-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Labor Rates</h1>
          <p className="text-muted-foreground">Default hourly rates per trade for estimating</p>
        </div>
        <AddRateDialog />
      </div>

      <div className="bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900/50 p-4 rounded-md flex gap-3 text-sm">
        <ShieldAlert className="w-5 h-5 shrink-0" />
        <div>
          <span className="font-semibold">Super-Admin Global Settings</span>
          <p>Changes here affect the default estimating rates for all newly created estimates. Existing estimates will retain their saved rates.</p>
        </div>
      </div>

      <div className="border rounded-md bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Trade / Activity</TableHead>
              <TableHead className="text-right">Default Hourly Rate</TableHead>
              <TableHead className="w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center">Loading rates...</TableCell>
              </TableRow>
            ) : rates?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">No default rates defined.</TableCell>
              </TableRow>
            ) : (
              rates?.map((rate) => (
                <TableRow key={rate.id}>
                  <TableCell className="font-medium">{rate.trade}</TableCell>
                  <TableCell className="text-right">${rate.hourlyRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/hr</TableCell>
                  <TableCell className="text-right space-x-2">
                    <EditRateDialog rate={rate} />
                    <DeleteRateButton rateId={rate.id} trade={rate.trade} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AddRateDialog() {
  const [open, setOpen] = useState(false);
  const [trade, setTrade] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const create = useCreateLaborRate({
    mutation: {
      onSuccess: () => {
        toast({ title: "Labor rate created" });
        queryClient.invalidateQueries({ queryKey: getListLaborRatesQueryKey() });
        setOpen(false);
        setTrade("");
        setHourlyRate("");
      },
      onError: (err: any) => {
        const isConflict = err?.response?.status === 409 || err?.message?.includes("409");
        toast({ 
          title: "Failed to create rate", 
          description: isConflict ? "A rate for this trade already exists." : err.message,
          variant: "destructive" 
        });
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="w-4 h-4" /> Add Rate</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Labor Rate</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Trade / Activity</Label>
            <Input value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="e.g. Welding" />
          </div>
          <div className="space-y-2">
            <Label>Hourly Rate ($/hr)</Label>
            <Input type="number" min="0" step="0.01" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button 
            onClick={() => create.mutate({ data: { trade, hourlyRate: Number(hourlyRate) || 0 }})}
            disabled={create.isPending || !trade || !hourlyRate}
          >
            {create.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditRateDialog({ rate }: { rate: { id: number, trade: string, hourlyRate: number } }) {
  const [open, setOpen] = useState(false);
  const [trade, setTrade] = useState(rate.trade);
  const [hourlyRate, setHourlyRate] = useState(String(rate.hourlyRate));
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const update = useUpdateLaborRate({
    mutation: {
      onSuccess: () => {
        toast({ title: "Labor rate updated" });
        queryClient.invalidateQueries({ queryKey: getListLaborRatesQueryKey() });
        setOpen(false);
      },
      onError: (err: any) => {
        const isConflict = err?.response?.status === 409 || err?.message?.includes("409");
        toast({ 
          title: "Failed to update rate", 
          description: isConflict ? "A rate for this trade already exists." : err.message,
          variant: "destructive" 
        });
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8"><Pencil className="w-4 h-4" /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Labor Rate</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Trade / Activity</Label>
            <Input value={trade} onChange={(e) => setTrade(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Hourly Rate ($/hr)</Label>
            <Input type="number" min="0" step="0.01" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button 
            onClick={() => update.mutate({ rateId: rate.id, data: { trade, hourlyRate: Number(hourlyRate) || 0 }})}
            disabled={update.isPending || !trade || !hourlyRate}
          >
            {update.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteRateButton({ rateId, trade }: { rateId: number, trade: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const del = useDeleteLaborRate({
    mutation: {
      onSuccess: () => {
        toast({ title: `Removed rate for ${trade}` });
        queryClient.invalidateQueries({ queryKey: getListLaborRatesQueryKey() });
      },
      onError: () => toast({ title: "Failed to delete rate", variant: "destructive" })
    }
  });

  return (
    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => {
      if (confirm(`Remove default rate for ${trade}?`)) {
        del.mutate({ rateId });
      }
    }} disabled={del.isPending}>
      <Trash2 className="w-4 h-4" />
    </Button>
  );
}
