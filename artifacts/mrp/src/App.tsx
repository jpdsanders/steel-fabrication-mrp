import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import NotFound from "@/pages/not-found";
import NavShell from "@/components/layout/NavShell";
import Login from "@/pages/Login";

import Dashboard from "@/pages/Dashboard";
import JobsList from "@/pages/JobsList";
import EstimatesList from "@/pages/EstimatesList";
import EstimateDetail from "@/pages/EstimateDetail";
import JobDetail from "@/pages/JobDetail";
import ShopFloor from "@/pages/ShopFloor";
import Employees from "@/pages/Employees";
import TimeEntries from "@/pages/TimeEntries";
import StageLibrary from "@/pages/StageLibrary";
import Customers from "@/pages/Customers";
import CustomerDetail from "@/pages/CustomerDetail";
import PurchasingList from "@/pages/PurchasingList";
import PurchasingSettings from "@/pages/PurchasingSettings";
import PurchaseOrderDetail from "@/pages/PurchaseOrderDetail";
import Vendors from "@/pages/Vendors";
import AdminCompanies from "@/pages/admin/Companies";
import AdminUsers from "@/pages/admin/Users";
import AdminMaterialCatalog from "@/pages/admin/MaterialCatalog";
import AdminLaborRates from "@/pages/admin/LaborRates";
import Inventory from "@/pages/Inventory";
import MaterialReports from "@/pages/MaterialReports";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: false,
    },
  },
});

/** Redirects /drawings to /jobs (Drawing Log moved into each job's Documents tab). */
function DrawingsRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/jobs", { replace: true });
  }, [navigate]);
  return null;
}

/** Redirects to /login when the user is not authenticated. */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  // Use an effect so we don't call navigate during render
  useEffect(() => {
    if (!loading && !user) {
      navigate("/login", { replace: true });
    }
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">
        Loading…
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />

      <Route>
        <ProtectedRoute>
          <NavShell>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/estimates" component={EstimatesList} />
              <Route path="/estimates/:id" component={EstimateDetail} />
              <Route path="/jobs" component={JobsList} />
              <Route path="/drawings" component={DrawingsRedirect} />
              <Route path="/jobs/:id" component={JobDetail} />
              <Route path="/purchasing" component={PurchasingList} />
              <Route path="/purchasing/settings" component={PurchasingSettings} />
              <Route path="/purchasing/:id" component={PurchaseOrderDetail} />
              <Route path="/vendors" component={Vendors} />
              <Route path="/inventory" component={Inventory} />
              <Route path="/reports/materials" component={MaterialReports} />
              <Route path="/customers" component={Customers} />
              <Route path="/customers/:id" component={CustomerDetail} />
              <Route path="/employees" component={Employees} />
              <Route path="/time" component={TimeEntries} />
              <Route path="/stage-library" component={StageLibrary} />
              <Route path="/admin/companies" component={AdminCompanies} />
              <Route path="/admin/users" component={AdminUsers} />
              <Route path="/admin/labor-rates" component={AdminLaborRates} />
              <Route path="/admin/material-catalog" component={AdminMaterialCatalog} />
              {/* /shop-floor: kiosk PIN auth deferred to task #67; rendered inside ProtectedRoute until then */}
              <Route path="/shop-floor" component={ShopFloor} />
              <Route component={NotFound} />
            </Switch>
          </NavShell>
        </ProtectedRoute>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
