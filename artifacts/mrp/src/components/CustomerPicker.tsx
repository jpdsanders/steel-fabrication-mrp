import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCustomers,
  useCreateCustomer,
  getListCustomersQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface CustomerPickerProps {
  value: number | null;
  onChange: (customerId: number) => void;
}

export default function CustomerPicker({ value, onChange }: CustomerPickerProps) {
  const [open, setOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const { data: customers } = useListCustomers();

  const selected = customers?.find((c) => c.id === value);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
            data-testid="customer-picker"
          >
            {selected ? selected.name : "Select customer..."}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search customers..." />
            <CommandList>
              <CommandEmpty>No customers found.</CommandEmpty>
              <CommandGroup>
                {customers?.map((customer) => (
                  <CommandItem
                    key={customer.id}
                    value={customer.name}
                    onSelect={() => {
                      onChange(customer.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === customer.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <div>
                      <div>{customer.name}</div>
                      {customer.industry && (
                        <div className="text-xs text-muted-foreground">
                          {customer.industry}
                        </div>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <div className="border-t p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 text-primary"
                onClick={() => {
                  setOpen(false);
                  setQuickAddOpen(true);
                }}
                data-testid="quick-add-customer"
              >
                <Plus className="w-4 h-4" /> New customer
              </Button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>
      <QuickAddCustomerDialog
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        onCreated={(id) => onChange(id)}
      />
    </>
  );
}

function QuickAddCustomerDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (customerId: number) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createCustomer = useCreateCustomer({
    mutation: {
      onSuccess: (customer) => {
        toast({ title: "Customer created" });
        queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
        onCreated(customer.id);
        onOpenChange(false);
        setName("");
        setPhone("");
        setEmail("");
      },
      onError: () => {
        toast({ title: "Failed to create customer", variant: "destructive" });
      },
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Customer</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Company Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Phone (optional)</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Email (optional)</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!name.trim() || createCustomer.isPending}
            onClick={() =>
              createCustomer.mutate({
                data: {
                  name: name.trim(),
                  phone: phone.trim() || null,
                  email: email.trim() || null,
                },
              })
            }
          >
            {createCustomer.isPending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
