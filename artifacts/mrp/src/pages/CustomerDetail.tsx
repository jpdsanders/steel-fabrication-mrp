import { useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCustomer,
  useDeleteCustomer,
  useCreateContact,
  useUpdateContact,
  useDeleteContact,
  useCreateCustomerAddress,
  useUpdateCustomerAddress,
  useDeleteCustomerAddress,
  getGetCustomerQueryKey,
  getListCustomersQueryKey,
  type Contact,
  type CustomerAddress,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft,
  Plus,
  Pencil,
  Trash2,
  Phone,
  Mail,
  Globe,
  MapPin,
  Star,
  Printer,
} from "lucide-react";
import { CustomerFormDialog } from "@/components/CustomerFormDialog";

export default function CustomerDetail() {
  const [, params] = useRoute("/customers/:id");
  const [, setLocation] = useLocation();
  const customerId = Number(params?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useGetCustomer(customerId, {
    query: { enabled: !!customerId, queryKey: getGetCustomerQueryKey(customerId) },
  });

  const deleteCustomer = useDeleteCustomer({
    mutation: {
      onSuccess: () => {
        toast({ title: "Customer deleted" });
        queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
        setLocation("/customers");
      },
      onError: (err: unknown) => {
        const message =
          err && typeof err === "object" && "error" in err
            ? String((err as { error: unknown }).error)
            : "Failed to delete customer";
        toast({ title: message, variant: "destructive" });
      },
    },
  });

  if (isLoading) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) return <div className="p-8">Customer not found.</div>;

  const { customer, contacts, addresses, jobs } = data;

  return (
    <div className="p-8 space-y-6 max-w-6xl mx-auto">
      <Button variant="ghost" onClick={() => setLocation("/customers")} className="gap-2 -ml-4">
        <ChevronLeft className="w-4 h-4" /> Back to Customers
      </Button>

      <div className="flex justify-between items-start">
        <div>
          <div className="flex gap-3 items-center mb-1">
            <h1 className="text-3xl font-bold tracking-tight" data-testid="customer-name">{customer.name}</h1>
            <Badge variant={customer.status === "active" ? "default" : "secondary"}>
              {customer.status}
            </Badge>
          </div>
          {customer.industry && <p className="text-muted-foreground">{customer.industry}</p>}
        </div>
        <div className="flex gap-2">
          <CustomerFormDialog customer={customer} />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive gap-2">
                <Trash2 className="w-4 h-4" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {customer.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the customer, its contacts, and addresses. Customers with linked jobs cannot be deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive hover:bg-destructive/90"
                  onClick={() => deleteCustomer.mutate({ customerId })}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Client Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <InfoRow icon={Phone} label="Phone" value={customer.phone} />
              <InfoRow icon={Printer} label="Fax" value={customer.fax} />
              <InfoRow icon={Mail} label="Email" value={customer.email} />
              <InfoRow icon={Globe} label="Website" value={customer.website} />
              <InfoRow icon={MapPin} label="Billing" value={customer.billingAddress} />
              <InfoRow icon={MapPin} label="Default Delivery" value={customer.defaultDeliveryAddress} />
              <div className="pt-3 border-t">
                <Label className="text-muted-foreground">Notes</Label>
                <div className="whitespace-pre-wrap mt-1">{customer.notes || "No notes"}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row justify-between items-center">
              <CardTitle>Delivery Addresses</CardTitle>
              <AddressDialog customerId={customerId} />
            </CardHeader>
            <CardContent className="space-y-3">
              {addresses.length === 0 ? (
                <div className="text-sm text-muted-foreground">No delivery addresses.</div>
              ) : (
                addresses.map((addr) => (
                  <div key={addr.id} className="flex justify-between items-start gap-2 border-b pb-2 last:border-0 last:pb-0">
                    <div className="text-sm">
                      <div className="font-medium">{addr.label}</div>
                      <div className="text-muted-foreground">{addr.address}</div>
                    </div>
                    <div className="flex shrink-0">
                      <AddressDialog customerId={customerId} address={addr} />
                      <DeleteAddressButton customerId={customerId} address={addr} />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row justify-between items-center">
              <CardTitle>Contacts</CardTitle>
              <ContactDialog customerId={customerId} />
            </CardHeader>
            <CardContent>
              {contacts.length === 0 ? (
                <div className="text-sm text-muted-foreground">No contacts yet.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Phone / Mobile</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contacts.map((contact) => (
                      <TableRow key={contact.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-1.5">
                            {contact.name}
                            {contact.isPrimary && (
                              <Star className="w-3.5 h-3.5 fill-primary text-primary" aria-label="Primary contact" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{contact.title || "—"}</TableCell>
                        <TableCell>
                          <div>{contact.phone || "—"}</div>
                          {contact.mobile && <div className="text-xs text-muted-foreground">{contact.mobile} (m)</div>}
                        </TableCell>
                        <TableCell>{contact.email || "—"}</TableCell>
                        <TableCell className="text-right">
                          <ContactDialog customerId={customerId} contact={contact} />
                          <DeleteContactButton customerId={customerId} contact={contact} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Job History</CardTitle>
            </CardHeader>
            <CardContent>
              {jobs.length === 0 ? (
                <div className="text-sm text-muted-foreground">No jobs for this customer yet.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Progress</TableHead>
                      <TableHead>Hours</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell>
                          <Link href={`/jobs/${job.id}`} className="hover:underline text-primary font-medium">
                            {job.jobNumber}
                          </Link>
                          <div className="text-xs text-muted-foreground">{job.name}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 items-start">
                            <Badge variant={job.status === "active" ? "default" : "secondary"}>
                              {job.status}
                            </Badge>
                            {job.isPastDue && <Badge variant="destructive">Past Due</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="w-[160px]">
                          <div className="space-y-1">
                            <div className="text-xs">{Math.round(job.percentComplete)}%</div>
                            <Progress value={job.percentComplete} />
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {job.actualHours.toFixed(1)} / {job.estimatedHours.toFixed(1)}h
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Phone;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex gap-2 items-start">
      <Icon className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
      <div>
        <span className="text-muted-foreground">{label}: </span>
        <span className="font-medium">{value || "—"}</span>
      </div>
    </div>
  );
}

function ContactDialog({ customerId, contact }: { customerId: number; contact?: Contact }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [mobile, setMobile] = useState("");
  const [fax, setFax] = useState("");
  const [email, setEmail] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetCustomerQueryKey(customerId) });

  const createContact = useCreateContact({
    mutation: {
      onSuccess: () => {
        toast({ title: "Contact added" });
        invalidate();
        setOpen(false);
      },
    },
  });
  const updateContact = useUpdateContact({
    mutation: {
      onSuccess: () => {
        toast({ title: "Contact updated" });
        invalidate();
        setOpen(false);
      },
    },
  });

  const loadForm = () => {
    setName(contact?.name || "");
    setTitle(contact?.title || "");
    setPhone(contact?.phone || "");
    setMobile(contact?.mobile || "");
    setFax(contact?.fax || "");
    setEmail(contact?.email || "");
    setIsPrimary(contact?.isPrimary || false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      name: name.trim(),
      title: title.trim() || null,
      phone: phone.trim() || null,
      mobile: mobile.trim() || null,
      fax: fax.trim() || null,
      email: email.trim() || null,
      isPrimary,
    };
    if (contact) {
      updateContact.mutate({ contactId: contact.id, data });
    } else {
      createContact.mutate({ customerId, data });
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
        {contact ? (
          <Button variant="ghost" size="icon"><Pencil className="w-4 h-4" /></Button>
        ) : (
          <Button variant="outline" size="sm" className="gap-2" data-testid="add-contact">
            <Plus className="w-4 h-4" /> Add Contact
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{contact ? "Edit Contact" : "Add Contact"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Title / Role</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Mobile</Label>
              <Input value={mobile} onChange={(e) => setMobile(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Fax</Label>
              <Input value={fax} onChange={(e) => setFax(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="isPrimary"
              checked={isPrimary}
              onCheckedChange={(v) => setIsPrimary(v === true)}
            />
            <Label htmlFor="isPrimary">Primary contact</Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={createContact.isPending || updateContact.isPending}>
              {contact ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteContactButton({ customerId, contact }: { customerId: number; contact: Contact }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteContact = useDeleteContact({
    mutation: {
      onSuccess: () => {
        toast({ title: "Contact deleted" });
        queryClient.invalidateQueries({ queryKey: getGetCustomerQueryKey(customerId) });
      },
    },
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {contact.name}?</AlertDialogTitle>
          <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive hover:bg-destructive/90"
            onClick={() => deleteContact.mutate({ contactId: contact.id })}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AddressDialog({
  customerId,
  address,
}: {
  customerId: number;
  address?: CustomerAddress;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [addr, setAddr] = useState("");

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetCustomerQueryKey(customerId) });

  const createAddress = useCreateCustomerAddress({
    mutation: {
      onSuccess: () => {
        toast({ title: "Address added" });
        invalidate();
        setOpen(false);
      },
    },
  });
  const updateAddress = useUpdateCustomerAddress({
    mutation: {
      onSuccess: () => {
        toast({ title: "Address updated" });
        invalidate();
        setOpen(false);
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = { label: label.trim(), address: addr.trim() };
    if (address) {
      updateAddress.mutate({ addressId: address.id, data });
    } else {
      createAddress.mutate({ customerId, data });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (val) {
          setLabel(address?.label || "");
          setAddr(address?.address || "");
        }
      }}
    >
      <DialogTrigger asChild>
        {address ? (
          <Button variant="ghost" size="icon"><Pencil className="w-4 h-4" /></Button>
        ) : (
          <Button variant="outline" size="sm" className="gap-2" data-testid="add-address">
            <Plus className="w-4 h-4" /> Add
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{address ? "Edit Address" : "Add Delivery Address"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Label</Label>
            <Input required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Morenci Mine" />
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            <Input required value={addr} onChange={(e) => setAddr(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={createAddress.isPending || updateAddress.isPending}>
              {address ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteAddressButton({
  customerId,
  address,
}: {
  customerId: number;
  address: CustomerAddress;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteAddress = useDeleteCustomerAddress({
    mutation: {
      onSuccess: () => {
        toast({ title: "Address deleted" });
        queryClient.invalidateQueries({ queryKey: getGetCustomerQueryKey(customerId) });
      },
    },
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{address.label}"?</AlertDialogTitle>
          <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive hover:bg-destructive/90"
            onClick={() => deleteAddress.mutate({ addressId: address.id })}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
