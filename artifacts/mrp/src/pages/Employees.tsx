import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListEmployees,
  useCreateEmployee,
  useUpdateEmployee,
  useDeleteEmployee,
  getListEmployeesQueryKey
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export default function Employees() {
  const { data: employees, isLoading } = useListEmployees();
  const [editingEmployee, setEditingEmployee] = useState<any>(null);

  return (
    <div className="p-8 space-y-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Employees</h1>
          <p className="text-muted-foreground">Manage shop floor personnel</p>
        </div>
        <EmployeeDialog />
      </div>

      <div className="border rounded-md bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center">Loading...</TableCell></TableRow>
            ) : employees?.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No employees found.</TableCell></TableRow>
            ) : (
              employees?.map((emp) => (
                <TableRow key={emp.id}>
                  <TableCell className="font-medium">{emp.name}</TableCell>
                  <TableCell>{emp.jobTitle || "—"}</TableCell>
                  <TableCell>{emp.employeeCode || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={emp.active ? "default" : "secondary"}>
                      {emp.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <EmployeeDialog employee={emp} />
                    <DeleteEmployeeDialog id={emp.id} name={emp.name} />
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

function EmployeeDialog({ employee }: { employee?: any }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(employee?.name || "");
  const [employeeCode, setEmployeeCode] = useState(employee?.employeeCode || "");
  const [jobTitle, setJobTitle] = useState(employee?.jobTitle || "");
  const [active, setActive] = useState(employee ? employee.active : true);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createEmp = useCreateEmployee({
    mutation: {
      onSuccess: () => {
        toast({ title: "Employee created" });
        queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
        setOpen(false);
        reset();
      }
    }
  });

  const updateEmp = useUpdateEmployee({
    mutation: {
      onSuccess: () => {
        toast({ title: "Employee updated" });
        queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
        setOpen(false);
      }
    }
  });

  const reset = () => {
    setName("");
    setEmployeeCode("");
    setJobTitle("");
    setActive(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (employee) {
      updateEmp.mutate({ employeeId: employee.id, data: { name, employeeCode: employeeCode || null, jobTitle: jobTitle.trim() || null, active } });
    } else {
      createEmp.mutate({ data: { name, employeeCode: employeeCode || null, jobTitle: jobTitle.trim() || null, active } });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(val) => {
      setOpen(val);
      if (val && employee) {
        setName(employee.name);
        setEmployeeCode(employee.employeeCode || "");
        setJobTitle(employee.jobTitle || "");
        setActive(employee.active);
      } else if (val && !employee) {
        reset();
      }
    }}>
      <DialogTrigger asChild>
        {employee ? (
          <Button variant="ghost" size="icon"><Pencil className="w-4 h-4" /></Button>
        ) : (
          <Button className="gap-2"><Plus className="w-4 h-4" /> Add Employee</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{employee ? "Edit Employee" : "Add Employee"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input required value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Job Title (Optional)</Label>
            <Input placeholder="e.g. Welder, Fitter, Painter" value={jobTitle} onChange={e => setJobTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Employee Code (Optional)</Label>
            <Input value={employeeCode} onChange={e => setEmployeeCode(e.target.value)} />
          </div>
          <div className="flex items-center space-x-2 pt-2">
            <Switch id="active" checked={active} onCheckedChange={setActive} />
            <Label htmlFor="active">Active (Can clock in)</Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={createEmp.isPending || updateEmp.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteEmployeeDialog({ id, name }: { id: number, name: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteEmp = useDeleteEmployee({
    mutation: {
      onSuccess: () => {
        toast({ title: "Employee deleted" });
        queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
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
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>This action cannot be undone. Time entries will remain but be orphaned.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => deleteEmp.mutate({ employeeId: id })}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
