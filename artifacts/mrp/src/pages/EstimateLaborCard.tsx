import { useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  useListEstimateLaborLines,
  useCreateEstimateLaborLine,
  useUpdateEstimateLaborLine,
  useDeleteEstimateLaborLine,
  getListEstimateLaborLinesQueryKey,
  getGetEstimatePricingQueryKey,
  type EstimateLaborLine
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export function EstimateLaborCard({ estimateId }: { estimateId: number }) {
  const { data: lines, isLoading } = useListEstimateLaborLines(estimateId, {
    query: { enabled: !!estimateId, queryKey: getListEstimateLaborLinesQueryKey(estimateId) }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const totalHours = lines?.reduce((sum, line) => sum + line.hours, 0) ?? 0;
  const totalCost = lines?.reduce((sum, line) => sum + line.cost, 0) ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Labor</CardTitle>
        <AddLaborDialog estimateId={estimateId} />
      </CardHeader>
      <CardContent>
        {lines && lines.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trade / Activity</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Ext. Cost</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="font-medium">{line.trade}</TableCell>
                  <TableCell className="text-right">{line.hours.toFixed(1)}</TableCell>
                  <TableCell className="text-right">${line.hourlyRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/hr</TableCell>
                  <TableCell className="text-right">${line.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <EditLaborDialog estimateId={estimateId} line={line} />
                    <DeleteLaborButton estimateId={estimateId} lineId={line.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No labor lines added yet. Add labor activities to calculate costs.
          </div>
        )}
      </CardContent>
      {lines && lines.length > 0 && (
        <CardFooter className="flex justify-between bg-muted/20 border-t pt-6">
          <div className="text-sm text-muted-foreground">Total Labor</div>
          <div className="text-right font-medium">
            <span className="mr-6">{totalHours.toFixed(1)} hrs</span>
            ${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </CardFooter>
      )}
    </Card>
  );
}

function AddLaborDialog({ estimateId }: { estimateId: number }) {
  const [open, setOpen] = useState(false);
  const [trade, setTrade] = useState("");
  const [hours, setHours] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const create = useCreateEstimateLaborLine({
    mutation: {
      onSuccess: () => {
        toast({ title: "Labor line added" });
        queryClient.invalidateQueries({ queryKey: getListEstimateLaborLinesQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getGetEstimatePricingQueryKey(estimateId) });
        setOpen(false);
        setTrade("");
        setHours("");
        setHourlyRate("");
      },
      onError: (err) => toast({ title: "Failed to add labor", description: err instanceof Error ? err.message : undefined, variant: "destructive" })
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1"><Plus className="w-4 h-4" /> Add Labor</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Labor Line</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Trade / Activity</Label>
            <Input value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="e.g. Welding, Layout, Paint" />
          </div>
          <div className="space-y-2">
            <Label>Estimated Hours</Label>
            <Input type="number" min="0" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Hourly Rate ($/hr) — optional</Label>
            <Input type="number" min="0" step="0.01" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} placeholder="Leave blank to use company default" />
            <p className="text-xs text-muted-foreground">If left blank, the system will use the company's labor rate for this trade if one is set.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button 
            onClick={() => create.mutate({ estimateId, data: { trade, hours: Number(hours) || 0, hourlyRate: hourlyRate ? Number(hourlyRate) : undefined }})}
            disabled={create.isPending || !trade || !hours}
          >
            {create.isPending ? "Adding..." : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditLaborDialog({ estimateId, line }: { estimateId: number, line: EstimateLaborLine }) {
  const [open, setOpen] = useState(false);
  const [trade, setTrade] = useState(line.trade);
  const [hours, setHours] = useState(String(line.hours));
  const [hourlyRate, setHourlyRate] = useState(String(line.hourlyRate));
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const update = useUpdateEstimateLaborLine({
    mutation: {
      onSuccess: () => {
        toast({ title: "Labor line updated" });
        queryClient.invalidateQueries({ queryKey: getListEstimateLaborLinesQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getGetEstimatePricingQueryKey(estimateId) });
        setOpen(false);
      },
      onError: (err) => toast({ title: "Failed to update labor", description: err instanceof Error ? err.message : undefined, variant: "destructive" })
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8"><Pencil className="w-4 h-4" /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Labor Line</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Trade / Activity</Label>
            <Input value={trade} onChange={(e) => setTrade(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Estimated Hours</Label>
            <Input type="number" min="0" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Hourly Rate ($/hr)</Label>
            <Input type="number" min="0" step="0.01" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} placeholder="Leave blank to use company default" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button 
            onClick={() => update.mutate({ lineId: line.id, data: { trade, hours: Number(hours) || 0, ...(hourlyRate ? { hourlyRate: Number(hourlyRate) } : {}) }})}
            disabled={update.isPending || !trade || !hours}
          >
            {update.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteLaborButton({ estimateId, lineId }: { estimateId: number, lineId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const del = useDeleteEstimateLaborLine({
    mutation: {
      onSuccess: () => {
        toast({ title: "Labor line removed" });
        queryClient.invalidateQueries({ queryKey: getListEstimateLaborLinesQueryKey(estimateId) });
        queryClient.invalidateQueries({ queryKey: getGetEstimatePricingQueryKey(estimateId) });
      },
      onError: () => toast({ title: "Failed to remove labor", variant: "destructive" })
    }
  });

  return (
    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => del.mutate({ lineId })} disabled={del.isPending}>
      <Trash2 className="w-4 h-4" />
    </Button>
  );
}
