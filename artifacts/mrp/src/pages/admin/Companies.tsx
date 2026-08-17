import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Building2 } from "lucide-react";

interface Company {
  id: number;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  createdAt: string;
}

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...opts });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

export default function AdminCompanies() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", primaryColor: "", accentColor: "" });

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ["admin", "companies"],
    queryFn: () => apiFetch(getApiUrl("companies")),
  });

  const create = useMutation({
    mutationFn: (body: typeof form) =>
      apiFetch<Company>(getApiUrl("companies"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "companies"] });
      setShowCreate(false);
      setForm({ name: "", slug: "", primaryColor: "", accentColor: "" });
      toast({ title: "Company created" });
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function handleSlugify(name: string) {
    setForm((f) => ({
      ...f,
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    }));
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Building2 className="h-6 w-6 text-gray-600" />
          <h1 className="text-2xl font-bold">Companies</h1>
        </div>
        <Button onClick={() => setShowCreate(true)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Company
        </Button>
      </div>

      {isLoading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Primary color</TableHead>
              <TableHead>Accent color</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {companies.map((co) => (
              <TableRow key={co.id}>
                <TableCell className="font-medium">{co.name}</TableCell>
                <TableCell className="font-mono text-sm text-gray-500">{co.slug}</TableCell>
                <TableCell>
                  {co.primaryColor ? (
                    <div className="flex items-center gap-2">
                      <div
                        className="w-5 h-5 rounded border"
                        style={{ backgroundColor: co.primaryColor }}
                      />
                      <span className="text-sm font-mono">{co.primaryColor}</span>
                    </div>
                  ) : (
                    <span className="text-gray-400 text-sm">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {co.accentColor ? (
                    <div className="flex items-center gap-2">
                      <div
                        className="w-5 h-5 rounded border"
                        style={{ backgroundColor: co.accentColor }}
                      />
                      <span className="text-sm font-mono">{co.accentColor}</span>
                    </div>
                  ) : (
                    <span className="text-gray-400 text-sm">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-gray-500">
                  {new Date(co.createdAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
            {companies.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-gray-400 py-8">
                  No companies yet
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Company</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => handleSlugify(e.target.value)}
                placeholder="Acme Steel"
              />
            </div>
            <div className="space-y-1">
              <Label>Slug</Label>
              <Input
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                placeholder="acme-steel"
                className="font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Primary color</Label>
                <Input
                  value={form.primaryColor}
                  onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
                  placeholder="#1e3a5f"
                />
              </div>
              <div className="space-y-1">
                <Label>Accent color</Label>
                <Input
                  value={form.accentColor}
                  onChange={(e) => setForm((f) => ({ ...f, accentColor: e.target.value }))}
                  placeholder="#f97316"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => create.mutate(form)}
              disabled={!form.name || !form.slug || create.isPending}
            >
              {create.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
