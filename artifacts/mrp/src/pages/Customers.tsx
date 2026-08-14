import { useState } from "react";
import { Link } from "wouter";
import {
  useListCustomers,
  ListCustomersStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import { CustomerFormDialog } from "@/components/CustomerFormDialog";

export default function Customers() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");

  const queryParams: { search?: string; status?: ListCustomersStatus } = {};
  if (search) queryParams.search = search;
  if (status !== "all") queryParams.status = status as ListCustomersStatus;

  const { data: customers, isLoading } = useListCustomers(queryParams);

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
          <p className="text-muted-foreground">Client companies, contacts, and delivery addresses</p>
        </div>
        <CustomerFormDialog />
      </div>

      <div className="flex gap-4 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, industry, or email..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="customer-search"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-md bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Industry</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">Loading customers...</TableCell>
              </TableRow>
            ) : customers?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No customers found.</TableCell>
              </TableRow>
            ) : (
              customers?.map((customer) => (
                <TableRow key={customer.id} className="hover:bg-muted/50 transition-colors">
                  <TableCell className="font-medium">
                    <Link href={`/customers/${customer.id}`} className="hover:underline text-primary" data-testid={`customer-link-${customer.id}`}>
                      {customer.name}
                    </Link>
                  </TableCell>
                  <TableCell>{customer.industry || "—"}</TableCell>
                  <TableCell>{customer.phone || "—"}</TableCell>
                  <TableCell>{customer.email || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={customer.status === "active" ? "default" : "secondary"}>
                      {customer.status}
                    </Badge>
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
