import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Briefcase,
  Clock,
  Users,
  Library,
  MonitorSmartphone,
  FileText,
  Building2,
  ShoppingCart,
  ChevronDown,
  LogOut,
  Settings,
  Package,
  UserCog,
  RefreshCw,
  Truck,
  BarChart3,
  FileUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api";

interface NavShellProps {
  children: ReactNode;
}

interface Company {
  id: number;
  name: string;
  slug: string;
}

export default function NavShell({ children }: NavShellProps) {
  const [location] = useLocation();
  const { user, logout, switchCompany } = useAuth();
  const { toast } = useToast();

  // Only fetch companies list for super-admins
  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["companies-list"],
    queryFn: async () => {
      const res = await fetch(getApiUrl("companies"), { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!user?.superAdmin,
    staleTime: 5 * 60 * 1000,
  });

  const links = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/estimates", label: "Estimates", icon: FileText },
    { href: "/jobs", label: "Jobs", icon: Briefcase },
    { href: "/customers", label: "Customers", icon: Building2 },
    { href: "/purchasing", label: "Purchasing", icon: ShoppingCart },
    { href: "/vendors", label: "Vendors", icon: Truck },
    { href: "/inventory", label: "Inventory", icon: Package },
    { href: "/import", label: "Import", icon: FileUp },
    { href: "/reports", label: "Reports", icon: BarChart3 },
    { href: "/time", label: "Time", icon: Clock },
    { href: "/employees", label: "Employees", icon: Users },
    { href: "/stage-library", label: "Stage Library", icon: Library },
  ];

  const adminLinks = user?.superAdmin
    ? [
        { href: "/admin/companies", label: "Companies", icon: Building2 },
        { href: "/admin/users", label: "Users", icon: UserCog },
        { href: "/admin/labor-rates", label: "Labor Rates", icon: Settings },
        { href: "/admin/material-catalog", label: "Material Catalog", icon: Package },
      ]
    : user?.roles?.includes("admin")
      ? [{ href: "/admin/users", label: "Users", icon: UserCog }]
      : [];

  async function handleLogout() {
    await logout();
  }

  async function handleSwitchCompany(companyId: number) {
    try {
      await switchCompany(companyId);
      toast({ title: "Company switched" });
    } catch (err) {
      toast({
        title: "Switch failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <nav className="w-64 flex flex-col border-r bg-card shrink-0 print:hidden">
        <div className="p-6 pb-3">
          <h1 className="text-xl font-bold tracking-tight text-primary">Steel MRP</h1>
          {user && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{user.companyName}</p>
          )}
        </div>

        <div className="flex-1 px-4 space-y-1 overflow-y-auto">
          {links.map((link) => {
            const Icon = link.icon;
            const isActive =
              location === link.href ||
              (link.href !== "/" && location.startsWith(link.href));

            return (
              <Link key={link.href} href={link.href} className="block">
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  className="w-full justify-start gap-3"
                  data-testid={`nav-${link.label.toLowerCase().replace(" ", "-")}`}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </Button>
              </Link>
            );
          })}

          {adminLinks.length > 0 && (
            <>
              <div className="pt-3 pb-1 px-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Admin
                </p>
              </div>
              {adminLinks.map((link) => {
                const Icon = link.icon;
                const isActive = location.startsWith(link.href);
                return (
                  <Link key={link.href} href={link.href} className="block">
                    <Button
                      variant={isActive ? "secondary" : "ghost"}
                      className="w-full justify-start gap-3"
                    >
                      <Icon className="w-4 h-4" />
                      {link.label}
                    </Button>
                  </Link>
                );
              })}
            </>
          )}
        </div>

        <div className="p-4 border-t space-y-2">
          <Link href="/shop-floor" className="block">
            <Button className="w-full gap-2" size="lg" data-testid="nav-shop-floor">
              <MonitorSmartphone className="w-5 h-5" />
              Shop Floor Kiosk
            </Button>
          </Link>

          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="w-full justify-between px-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-blue-900 text-white text-xs flex items-center justify-center shrink-0 font-semibold">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="truncate text-sm">{user.name}</span>
                  </div>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user.name}</p>
                    <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                    <p className="text-xs leading-none text-muted-foreground mt-0.5">
                      {user.companyName}
                    </p>
                  </div>
                </DropdownMenuLabel>

                {user.superAdmin && companies.length > 1 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-muted-foreground font-normal pb-0">
                      Switch company
                    </DropdownMenuLabel>
                    {companies.map((co) => (
                      <DropdownMenuItem
                        key={co.id}
                        onClick={() => handleSwitchCompany(co.id)}
                        className={co.id === user.companyId ? "font-semibold" : undefined}
                      >
                        <RefreshCw className="h-4 w-4 mr-2 text-muted-foreground" />
                        {co.name}
                        {co.id === user.companyId && (
                          <span className="ml-auto text-xs text-muted-foreground">active</span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}

                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </nav>

      <main className="flex-1 overflow-auto flex flex-col">
        {user?.authBypass && (
          <div
            className="bg-amber-500 text-black text-center text-sm font-semibold py-1.5 px-4 shrink-0 print:hidden"
            data-testid="auth-bypass-banner"
          >
            ⚠️ AUTH BYPASSED — TEST MODE (signed in as {user.email} without login)
          </div>
        )}
        <div className="flex-1 overflow-auto">{children}</div>
      </main>
    </div>
  );
}
