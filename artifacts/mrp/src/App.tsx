import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import NavShell from "@/components/layout/NavShell";

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
import PurchaseOrderDetail from "@/pages/PurchaseOrderDetail";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/shop-floor" component={ShopFloor} />
      
      <Route>
        <NavShell>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/estimates" component={EstimatesList} />
            <Route path="/estimates/:id" component={EstimateDetail} />
            <Route path="/jobs" component={JobsList} />
            <Route path="/jobs/:id" component={JobDetail} />
            <Route path="/purchasing" component={PurchasingList} />
            <Route path="/purchasing/:id" component={PurchaseOrderDetail} />
            <Route path="/customers" component={Customers} />
            <Route path="/customers/:id" component={CustomerDetail} />
            <Route path="/employees" component={Employees} />
            <Route path="/time" component={TimeEntries} />
            <Route path="/stage-library" component={StageLibrary} />
            <Route component={NotFound} />
          </Switch>
        </NavShell>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
