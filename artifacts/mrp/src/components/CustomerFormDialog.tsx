import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateCustomer,
  useUpdateCustomer,
  getListCustomersQueryKey,
  getGetCustomerQueryKey,
  type Customer,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
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
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil } from "lucide-react";

export const INDUSTRY_OPTIONS = [
  "Fired Heaters",
  "Mining",
  "Refinery/Petro-Chem",
  "Power",
  "SCR",
  "Solar",
  "Inter-Company",
  "Miscellaneous",
];

const NONE_INDUSTRY = "__none__";

export function CustomerFormDialog({ customer }: { customer?: Customer }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [fax, setFax] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [defaultDeliveryAddress, setDefaultDeliveryAddress] = useState("");
  const [industry, setIndustry] = useState(NONE_INDUSTRY);
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [notes, setNotes] = useState("");

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
    if (customer) {
      queryClient.invalidateQueries({ queryKey: getGetCustomerQueryKey(customer.id) });
    }
  };

  const createCustomer = useCreateCustomer({
    mutation: {
      onSuccess: () => {
        toast({ title: "Customer created" });
        invalidate();
        setOpen(false);
      },
      onError: () => toast({ title: "Failed to create customer", variant: "destructive" }),
    },
  });

  const updateCustomer = useUpdateCustomer({
    mutation: {
      onSuccess: () => {
        toast({ title: "Customer updated" });
        invalidate();
        setOpen(false);
      },
      onError: () => toast({ title: "Failed to update customer", variant: "destructive" }),
    },
  });

  const loadForm = () => {
    setName(customer?.name || "");
    setPhone(customer?.phone || "");
    setFax(customer?.fax || "");
    setEmail(customer?.email || "");
    setWebsite(customer?.website || "");
    setBillingAddress(customer?.billingAddress || "");
    setDefaultDeliveryAddress(customer?.defaultDeliveryAddress || "");
    setIndustry(customer?.industry || NONE_INDUSTRY);
    setStatus((customer?.status as "active" | "inactive") || "active");
    setNotes(customer?.notes || "");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      name: name.trim(),
      phone: phone.trim() || null,
      fax: fax.trim() || null,
      email: email.trim() || null,
      website: website.trim() || null,
      billingAddress: billingAddress.trim() || null,
      defaultDeliveryAddress: defaultDeliveryAddress.trim() || null,
      industry: industry === NONE_INDUSTRY ? null : industry,
      status,
      notes: notes.trim() || null,
    };
    if (customer) {
      updateCustomer.mutate({ customerId: customer.id, data });
    } else {
      createCustomer.mutate({ data });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (val) loadForm();
      }}
    >
      <DialogTrigger asChild>
        {customer ? (
          <Button variant="outline" size="sm" className="gap-2" data-testid="edit-customer">
            <Pencil className="w-4 h-4" /> Edit
          </Button>
        ) : (
          <Button className="gap-2" data-testid="new-customer">
            <Plus className="w-4 h-4" /> New Customer
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{customer ? "Edit Customer" : "New Customer"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2">
              <Label>Company Name</Label>
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Fax</Label>
              <Input value={fax} onChange={(e) => setFax(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Website</Label>
              <Input value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Industry / Product Type</Label>
              <Select value={industry} onValueChange={setIndustry}>
                <SelectTrigger>
                  <SelectValue placeholder="Select industry" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_INDUSTRY}>None</SelectItem>
                  {INDUSTRY_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as "active" | "inactive")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Billing Address</Label>
            <Input value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Default Delivery Address</Label>
            <Input value={defaultDeliveryAddress} onChange={(e) => setDefaultDeliveryAddress(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={createCustomer.isPending || updateCustomer.isPending}>
              {customer ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
