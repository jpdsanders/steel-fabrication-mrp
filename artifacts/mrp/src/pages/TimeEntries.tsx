import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTimeEntries,
  useCreateTimeEntry,
  useUpdateTimeEntry,
  useDeleteTimeEntry,
  useListEmployees,
  useListJobs,
  useGetJob,
  getListTimeEntriesQueryKey,
  getListActivePunchesQueryKey,
  getGetDashboardSummaryQueryKey
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export default function TimeEntries() {
  const { data: entries, isLoading } = useListTimeEntries();

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Time Entries</h1>
          <p className="text-muted-foreground">Review and correct labor records</p>
        </div>
        <ManualEntryDialog />
      </div>

      <div className="border rounded-md bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Job / Stage</TableHead>
              <TableHead>Clock In</TableHead>
              <TableHead>Clock Out</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="h-24 text-center">Loading...</TableCell></TableRow>
            ) : entries?.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No time entries found.</TableCell></TableRow>
            ) : (
              entries?.map((entry) => (
                <TableRow key={entry.id} className={!entry.clockOut ? "bg-primary/5" : ""}>
                  <TableCell>
                    <div className="font-medium">{entry.employeeName}</div>
                    {entry.employeeTitle && <div className="text-xs text-muted-foreground">{entry.employeeTitle}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-primary">{entry.jobNumber}</div>
                    <div className="text-xs text-muted-foreground">{entry.stageName}</div>
                  </TableCell>
                  <TableCell>{new Date(entry.clockIn).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</TableCell>
                  <TableCell>
                    {entry.clockOut ? new Date(entry.clockOut).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {entry.durationMinutes ? 
                      `${Math.floor(entry.durationMinutes / 60)}h ${entry.durationMinutes % 60}m` : 
                      <Badge variant="default" className="animate-pulse">Active</Badge>
                    }
                  </TableCell>
                  <TableCell className="text-right">
                    <EditEntryDialog entry={entry} />
                    <DeleteEntryDialog id={entry.id} />
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

function ManualEntryDialog() {
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [jobId, setJobId] = useState("");
  const [stageId, setStageId] = useState("");
  
  // Format for datetime-local: YYYY-MM-DDThh:mm
  const formatForInput = (d: Date) => {
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  
  const [clockIn, setClockIn] = useState(formatForInput(new Date()));
  const [clockOut, setClockOut] = useState(formatForInput(new Date(Date.now() + 3600000)));

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: employees } = useListEmployees({ activeOnly: true });
  const { data: jobs } = useListJobs();
  const { data: jobDetails } = useGetJob(Number(jobId), { 
    query: { enabled: !!jobId, queryKey: ['job', jobId] }
  });

  const createEntry = useCreateTimeEntry({
    mutation: {
      onSuccess: () => {
        toast({ title: "Time entry created" });
        queryClient.invalidateQueries({ queryKey: getListTimeEntriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        setOpen(false);
        reset();
      }
    }
  });

  const reset = () => {
    setEmployeeId("");
    setJobId("");
    setStageId("");
    setClockIn(formatForInput(new Date()));
    setClockOut(formatForInput(new Date(Date.now() + 3600000)));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId || !jobId || !stageId || !clockIn || !clockOut) return;
    
    createEntry.mutate({
      data: {
        employeeId: Number(employeeId),
        jobId: Number(jobId),
        stageId: Number(stageId),
        clockIn: new Date(clockIn).toISOString(),
        clockOut: new Date(clockOut).toISOString()
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="w-4 h-4" /> Manual Entry</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Manual Time Entry</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>
                {employees?.map(e => <SelectItem key={e.id} value={e.id.toString()}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Job</Label>
            <Select value={jobId} onValueChange={(val) => { setJobId(val); setStageId(""); }}>
              <SelectTrigger><SelectValue placeholder="Select job" /></SelectTrigger>
              <SelectContent>
                {jobs?.map(j => <SelectItem key={j.id} value={j.id.toString()}>{j.jobNumber} - {j.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Stage</Label>
            <Select value={stageId} onValueChange={setStageId} disabled={!jobId}>
              <SelectTrigger><SelectValue placeholder="Select stage" /></SelectTrigger>
              <SelectContent>
                {jobDetails?.stages.map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Clock In</Label>
              <Input type="datetime-local" value={clockIn} onChange={e => setClockIn(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Clock Out</Label>
              <Input type="datetime-local" value={clockOut} onChange={e => setClockOut(e.target.value)} required />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={createEntry.isPending || !employeeId || !jobId || !stageId}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditEntryDialog({ entry }: { entry: any }) {
  const [open, setOpen] = useState(false);
  const formatForInput = (iso: string) => {
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  const [clockIn, setClockIn] = useState(formatForInput(entry.clockIn));
  const [clockOut, setClockOut] = useState(entry.clockOut ? formatForInput(entry.clockOut) : "");

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const updateEntry = useUpdateTimeEntry({
    mutation: {
      onSuccess: () => {
        toast({ title: "Entry updated" });
        queryClient.invalidateQueries({ queryKey: getListTimeEntriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListActivePunchesQueryKey() });
        setOpen(false);
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateEntry.mutate({
      entryId: entry.id,
      data: {
        clockIn: new Date(clockIn).toISOString(),
        clockOut: clockOut ? new Date(clockOut).toISOString() : null
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon"><Pencil className="w-4 h-4" /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Time Entry</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="bg-muted/50 p-3 rounded text-sm space-y-1">
            <div><span className="font-semibold">Employee:</span> {entry.employeeName}</div>
            <div><span className="font-semibold">Job:</span> {entry.jobNumber}</div>
            <div><span className="font-semibold">Stage:</span> {entry.stageName}</div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Clock In</Label>
              <Input type="datetime-local" value={clockIn} onChange={e => setClockIn(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Clock Out</Label>
              <Input type="datetime-local" value={clockOut} onChange={e => setClockOut(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={updateEntry.isPending}>Save Changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteEntryDialog({ id }: { id: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteEntry = useDeleteTimeEntry({
    mutation: {
      onSuccess: () => {
        toast({ title: "Entry deleted" });
        queryClient.invalidateQueries({ queryKey: getListTimeEntriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListActivePunchesQueryKey() });
      }
    }
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete time entry?</AlertDialogTitle>
          <AlertDialogDescription>This action cannot be undone and will affect job labor totals.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => deleteEntry.mutate({ entryId: id })}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
