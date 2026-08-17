import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Users, Pencil } from "lucide-react";

/** Mirrors COMPANY_ROLES in lib/db (userCompanyRoles.ts). */
const COMPANY_ROLES = [
  { value: "admin", label: "Admin" },
  { value: "estimator", label: "Estimator" },
  { value: "doc_control", label: "Document Control" },
  { value: "purchasing", label: "Purchasing" },
  { value: "shop_foreman", label: "Shop Foreman" },
  { value: "qc", label: "QC" },
  { value: "shipping", label: "Shipping" },
] as const;

const ROLE_LABELS = Object.fromEntries(
  COMPANY_ROLES.map((r) => [r.value, r.label]),
);

interface UserRow {
  id: number;
  email: string;
  name: string;
  superAdmin: boolean;
  active: boolean;
  createdAt: string;
  companies: { id: number; name: string; roles: string[] }[];
}

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...opts });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      typeof err.error === "string" ? err.error : res.statusText,
    );
  }
  return res.json();
}

interface CreateForm {
  name: string;
  email: string;
  password: string;
  superAdmin: boolean;
  companyId: number | null;
  roles: string[];
}

export default function AdminUsers() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user: me } = useAuth();
  const isSuper = !!me?.superAdmin;

  // Super-admins can switch which company's users they view ("all" = everyone)
  const [viewCompanyId, setViewCompanyId] = useState<string>(
    me ? String(me.companyId) : "all",
  );

  const emptyForm = (): CreateForm => ({
    name: "",
    email: "",
    password: "",
    superAdmin: false,
    companyId: me?.companyId ?? null,
    roles: [],
  });
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyForm);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", password: "" });

  function openEdit(u: UserRow) {
    setEditTarget(u);
    setEditForm({ name: u.name, email: u.email, password: "" });
  }

  const listUrl =
    isSuper && viewCompanyId !== "all"
      ? `${getApiUrl("users")}?companyId=${viewCompanyId}`
      : getApiUrl("users");

  const { data: users = [], isLoading } = useQuery<UserRow[]>({
    queryKey: ["admin", "users", isSuper ? viewCompanyId : "own"],
    queryFn: () => apiFetch(listUrl),
  });

  const create = useMutation({
    mutationFn: (body: CreateForm) =>
      apiFetch<UserRow>(getApiUrl("users"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: body.name,
          email: body.email,
          password: body.password,
          ...(isSuper ? { superAdmin: body.superAdmin } : {}),
          ...(body.superAdmin
            ? {}
            : { companyId: body.companyId, roles: body.roles }),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setShowCreate(false);
      setForm(emptyForm());
      toast({ title: "User created" });
    },
    onError: (err) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      apiFetch(`${getApiUrl("users")}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
    onError: (err) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, string> }) =>
      apiFetch(`${getApiUrl("users")}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setEditTarget(null);
      toast({ title: "User updated" });
    },
    onError: (err) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function submitEdit() {
    if (!editTarget) return;
    const body: Record<string, string> = {};
    if (editForm.name && editForm.name !== editTarget.name) body.name = editForm.name;
    if (editForm.email && editForm.email !== editTarget.email) body.email = editForm.email;
    if (editForm.password) body.password = editForm.password;
    if (Object.keys(body).length === 0) {
      setEditTarget(null);
      return;
    }
    update.mutate({ id: editTarget.id, body });
  }

  function toggleRole(role: string, checked: boolean) {
    setForm((f) => ({
      ...f,
      roles: checked ? [...f.roles, role] : f.roles.filter((r) => r !== role),
    }));
  }

  const createDisabled =
    !form.name ||
    !form.email ||
    form.password.length < 8 ||
    (!form.superAdmin && (!form.companyId || form.roles.length === 0)) ||
    create.isPending;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Users className="h-6 w-6 text-gray-600" />
          <h1 className="text-2xl font-bold">Users</h1>
        </div>
        <div className="flex items-center gap-3">
          {isSuper && me?.companies && (
            <Select value={viewCompanyId} onValueChange={setViewCompanyId}>
              <SelectTrigger className="w-52" data-testid="users-company-filter">
                <SelectValue placeholder="Company" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All companies</SelectItem>
                {me.companies.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button onClick={() => setShowCreate(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" /> New User
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell className="text-sm text-gray-600">{u.email}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {u.superAdmin && (
                      <Badge className="bg-purple-100 text-purple-800">
                        Super Admin
                      </Badge>
                    )}
                    {u.companies.map((c) => (
                      <Badge key={c.id} variant="outline" className="font-normal">
                        {isSuper && viewCompanyId === "all" ? `${c.name}: ` : ""}
                        {c.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}
                      </Badge>
                    ))}
                    {!u.superAdmin && u.companies.length === 0 && (
                      <Badge variant="destructive" className="font-normal">
                        No company access
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Switch
                    checked={u.active}
                    onCheckedChange={(active) =>
                      toggleActive.mutate({ id: u.id, active })
                    }
                    disabled={u.id === me?.id}
                  />
                </TableCell>
                <TableCell className="text-sm text-gray-500">
                  {new Date(u.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  {(isSuper || !u.superAdmin) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(u)}
                      data-testid={`edit-user-${u.id}`}
                    >
                      <Pencil className="h-4 w-4 text-gray-500" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-gray-400 py-8">
                  No users yet
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                data-testid="edit-user-name"
              />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                data-testid="edit-user-email"
              />
            </div>
            <div className="space-y-1">
              <Label>New password (leave blank to keep)</Label>
              <Input
                type="password"
                value={editForm.password}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, password: e.target.value }))
                }
                placeholder="Min. 8 characters"
                data-testid="edit-user-password"
              />
            </div>
            <p className="text-xs text-gray-500">
              Role changes aren't supported here yet.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={submitEdit}
              disabled={
                update.isPending ||
                !editForm.name ||
                !editForm.email ||
                (editForm.password.length > 0 && editForm.password.length < 8)
              }
              data-testid="edit-user-submit"
            >
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Jane Smith"
                data-testid="new-user-name"
              />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="jane@company.com"
                data-testid="new-user-email"
              />
            </div>
            <div className="space-y-1">
              <Label>Password</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) =>
                  setForm((f) => ({ ...f, password: e.target.value }))
                }
                placeholder="Min. 8 characters"
                data-testid="new-user-password"
              />
            </div>

            {isSuper && (
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.superAdmin}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, superAdmin: v }))}
                  data-testid="new-user-superadmin"
                />
                <Label>Super admin (all companies)</Label>
              </div>
            )}

            {!form.superAdmin && (
              <>
                <div className="space-y-1">
                  <Label>Company</Label>
                  {isSuper && me?.companies ? (
                    <Select
                      value={form.companyId ? String(form.companyId) : ""}
                      onValueChange={(v) =>
                        setForm((f) => ({ ...f, companyId: Number(v) }))
                      }
                    >
                      <SelectTrigger data-testid="new-user-company">
                        <SelectValue placeholder="Select company" />
                      </SelectTrigger>
                      <SelectContent>
                        {me.companies.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-gray-600 border rounded-md px-3 py-2 bg-gray-50">
                      {me?.companyName}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>
                    Roles <span className="text-red-500">*</span>
                  </Label>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {COMPANY_ROLES.map((r) => (
                      <label
                        key={r.value}
                        className="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <Checkbox
                          checked={form.roles.includes(r.value)}
                          onCheckedChange={(c) => toggleRole(r.value, c === true)}
                          data-testid={`new-user-role-${r.value}`}
                        />
                        {r.label}
                      </label>
                    ))}
                  </div>
                  {form.roles.length === 0 && (
                    <p className="text-xs text-amber-600 pt-1">
                      Select at least one role so this user can log in.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => create.mutate(form)}
              disabled={createDisabled}
              data-testid="new-user-submit"
            >
              {create.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
