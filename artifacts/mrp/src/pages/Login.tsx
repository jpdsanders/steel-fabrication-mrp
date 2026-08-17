import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/api";

interface CompanyBranding {
  id: number;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
}

export default function Login() {
  const { login, user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Lightweight company identity: public branding list + optional picker
  const [companies, setCompanies] = useState<CompanyBranding[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  useEffect(() => {
    fetch(getApiUrl("auth/companies"))
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: CompanyBranding[]) => setCompanies(rows))
      .catch(() => {});
  }, []);
  const selectedCompany =
    companies.find((c) => c.id === selectedCompanyId) ?? null;

  // Already authenticated (e.g. dev auth bypass) — skip the login screen.
  useEffect(() => {
    if (!authLoading && user) {
      navigate("/", { replace: true });
    }
  }, [authLoading, user, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate("/");
    } catch (err) {
      toast({
        title: "Login failed",
        description: err instanceof Error ? err.message : "Invalid credentials",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-2">
            {selectedCompany?.logoUrl ? (
              <img
                src={selectedCompany.logoUrl}
                alt={selectedCompany.name}
                className="h-12 max-w-[160px] object-contain"
              />
            ) : (
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: selectedCompany?.primaryColor || "#1e3a8a" }}
              >
                <span className="text-white font-bold text-lg">
                  {selectedCompany ? selectedCompany.name.charAt(0) : "M"}
                </span>
              </div>
            )}
          </div>
          <CardTitle className="text-2xl font-bold">
            {selectedCompany ? selectedCompany.name : "Steel MRP"}
          </CardTitle>
          <CardDescription>Sign in to your account</CardDescription>
          {companies.length > 1 && (
            <div className="flex flex-wrap justify-center gap-1.5 pt-2">
              {companies.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() =>
                    setSelectedCompanyId((cur) => (cur === c.id ? null : c.id))
                  }
                  data-testid={`login-company-${c.slug}`}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    selectedCompanyId === c.id
                      ? "text-white border-transparent"
                      : "text-gray-600 border-gray-300 hover:border-gray-400 bg-white"
                  }`}
                  style={
                    selectedCompanyId === c.id
                      ? { backgroundColor: c.primaryColor || "#1e3a8a" }
                      : undefined
                  }
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                placeholder="you@company.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
