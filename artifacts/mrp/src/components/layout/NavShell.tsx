import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Briefcase, Clock, Users, Library, MonitorSmartphone, FileText, Building2, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NavShellProps {
  children: ReactNode;
}

export default function NavShell({ children }: NavShellProps) {
  const [location] = useLocation();

  const links = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/estimates", label: "Estimates", icon: FileText },
    { href: "/jobs", label: "Jobs", icon: Briefcase },
    { href: "/customers", label: "Customers", icon: Building2 },
    { href: "/purchasing", label: "Purchasing", icon: ShoppingCart },
    { href: "/time", label: "Time", icon: Clock },
    { href: "/employees", label: "Employees", icon: Users },
    { href: "/stage-library", label: "Stage Library", icon: Library },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <nav className="w-64 flex flex-col border-r bg-card shrink-0 print:hidden">
        <div className="p-6">
          <h1 className="text-xl font-bold tracking-tight text-primary">Steel MRP</h1>
        </div>
        
        <div className="flex-1 px-4 space-y-1">
          {links.map((link) => {
            const Icon = link.icon;
            const isActive = location === link.href || (link.href !== "/" && location.startsWith(link.href));
            
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
        </div>

        <div className="p-4 border-t">
          <Link href="/shop-floor" className="block">
            <Button className="w-full gap-2" size="lg" data-testid="nav-shop-floor">
              <MonitorSmartphone className="w-5 h-5" />
              Shop Floor Kiosk
            </Button>
          </Link>
        </div>
      </nav>
      
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
