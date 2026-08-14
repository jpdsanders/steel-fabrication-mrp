import { useMemo, useState } from "react";
import {
  useGetDashboardSummary,
  useGetDashboardJobs,
  getGetDashboardSummaryQueryKey,
  getGetDashboardJobsQueryKey,
} from "@workspace/api-client-react";
import { PackageCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, X, LayoutGrid, Table2 } from "lucide-react";
import ProductionGrid from "@/components/dashboard/ProductionGrid";

type DueWindow = "any" | "week" | "two_weeks" | "month";

function dueWindowLimit(window: Exclude<DueWindow, "any">): Date {
  const limit = new Date();
  if (window === "month") {
    return new Date(limit.getFullYear(), limit.getMonth() + 1, 0);
  }
  limit.setDate(limit.getDate() + (window === "week" ? 7 : 14));
  return limit;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary({
    query: {
      refetchInterval: 15000,
      queryKey: getGetDashboardSummaryQueryKey(),
    },
  });

  const { data: jobs, isLoading: loadingJobs } = useGetDashboardJobs({
    query: {
      refetchInterval: 15000,
      queryKey: getGetDashboardJobsQueryKey(),
    },
  });

  const [view, setView] = useState<"grid" | "cards">("grid");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("all");
  const [status, setStatus] = useState("active");
  const [customer, setCustomer] = useState("all");
  const [assignedTo, setAssignedTo] = useState("all");
  const [dueWindow, setDueWindow] = useState<DueWindow>("any");
  const [pastDueOnly, setPastDueOnly] = useState(false);
  const [overBudget, setOverBudget] = useState(false);
  const [onFloorNow, setOnFloorNow] = useState(false);

  const stageOptions = useMemo(() => {
    const set = new Set<string>();
    for (const job of jobs ?? []) {
      if (job.currentStageName) set.add(job.currentStageName);
    }
    return [...set].sort();
  }, [jobs]);

  const customerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const job of jobs ?? []) set.add(job.customer);
    return [...set].sort();
  }, [jobs]);

  const assigneeOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const job of jobs ?? []) {
      for (const emp of job.assignedEmployees ?? []) map.set(emp.id, emp.name);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [jobs]);

  const activeFilterCount =
    (search.trim() ? 1 : 0) +
    (stage !== "all" ? 1 : 0) +
    (status !== "all" ? 1 : 0) +
    (customer !== "all" ? 1 : 0) +
    (assignedTo !== "all" ? 1 : 0) +
    (dueWindow !== "any" ? 1 : 0) +
    (pastDueOnly ? 1 : 0) +
    (overBudget ? 1 : 0) +
    (onFloorNow ? 1 : 0);

  const clearFilters = () => {
    setSearch("");
    setStage("all");
    setStatus("all");
    setCustomer("all");
    setAssignedTo("all");
    setDueWindow("any");
    setPastDueOnly(false);
    setOverBudget(false);
    setOnFloorNow(false);
  };

  const filteredJobs = useMemo(() => {
    if (!jobs) return [];
    const term = search.trim().toLowerCase();
    const todayStr = toDateStr(new Date());
    const dueLimitStr =
      dueWindow === "any" ? null : toDateStr(dueWindowLimit(dueWindow));
    return jobs.filter((job) => {
      if (
        term &&
        !job.jobNumber.toLowerCase().includes(term) &&
        !job.name.toLowerCase().includes(term) &&
        !job.customer.toLowerCase().includes(term)
      )
        return false;
      if (stage !== "all" && job.currentStageName !== stage) return false;
      if (status !== "all" && job.status !== status) return false;
      if (customer !== "all" && job.customer !== customer) return false;
      if (
        assignedTo !== "all" &&
        !(job.assignedEmployees ?? []).some((e) => String(e.id) === assignedTo)
      )
        return false;
      if (dueLimitStr) {
        if (!job.dueDate) return false;
        if (job.dueDate < todayStr || job.dueDate > dueLimitStr) return false;
      }
      if (pastDueOnly && !job.isPastDue) return false;
      if (
        overBudget &&
        !(job.estimatedHours > 0 && job.actualHours > job.estimatedHours * 0.9)
      )
        return false;
      if (onFloorNow && job.clockedInCount === 0) return false;
      return true;
    });
  }, [jobs, search, stage, status, customer, assignedTo, dueWindow, pastDueOnly, overBudget, onFloorNow]);

  return (
    <div className="p-8 space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {loadingSummary || !summary ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
        ) : (
          <>
            <KpiCard title="Active Jobs" value={summary.activeJobs} />
            <KpiCard title="On Hold" value={summary.onHoldJobs} />
            <KpiCard title="Complete" value={summary.completeJobs} />
            <KpiCard title="Past Due" value={summary.pastDueJobs} className="text-destructive" />
            <KpiCard title="On Floor Now" value={summary.clockedInCount} className="text-primary" />
            <KpiCard 
              title="Hours (Act/Est)" 
              value={`${summary.totalActualHours.toFixed(1)} / ${summary.totalEstimatedHours.toFixed(1)}`} 
            />
          </>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Active Production</h2>
          <div className="flex items-center rounded-md border bg-card p-0.5" role="group" aria-label="View">
            <ViewToggleButton
              active={view === "grid"}
              onClick={() => setView("grid")}
              icon={<Table2 className="w-3.5 h-3.5" />}
              label="Grid"
              testId="button-view-grid"
            />
            <ViewToggleButton
              active={view === "cards"}
              onClick={() => setView("cards")}
              icon={<LayoutGrid className="w-3.5 h-3.5" />}
              label="Cards"
              testId="button-view-cards"
            />
          </div>
        </div>

        <div className="space-y-3 border rounded-lg bg-card p-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search job number, name, or customer..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={stage} onValueChange={setStage}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Stage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stages</SelectItem>
                {stageOptions.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={customer} onValueChange={setCustomer}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Customers</SelectItem>
                {customerOptions.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={assignedTo} onValueChange={setAssignedTo}>
              <SelectTrigger className="w-[170px]" data-testid="select-assigned-to">
                <SelectValue placeholder="Assigned to" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Anyone Assigned</SelectItem>
                {assigneeOptions.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={dueWindow} onValueChange={(v) => setDueWindow(v as DueWindow)}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Due date" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any Due Date</SelectItem>
                <SelectItem value="week">Due This Week</SelectItem>
                <SelectItem value="two_weeks">Due in 2 Weeks</SelectItem>
                <SelectItem value="month">Due This Month</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <FilterChip
              label="Past Due Only"
              active={pastDueOnly}
              onClick={() => setPastDueOnly((v) => !v)}
            />
            <FilterChip
              label="Over Labor Budget"
              active={overBudget}
              onClick={() => setOverBudget((v) => !v)}
            />
            <FilterChip
              label="On the Floor Now"
              active={onFloorNow}
              onClick={() => setOnFloorNow((v) => !v)}
            />
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-muted-foreground">
                  {activeFilterCount} {activeFilterCount === 1 ? "filter" : "filters"} active
                </span>
                <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={clearFilters}>
                  <X className="w-3.5 h-3.5" /> Clear filters
                </Button>
              </div>
            )}
          </div>
        </div>

        {loadingJobs || !jobs ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center p-12 border rounded-lg bg-card text-muted-foreground">
            No active jobs in production.
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="text-center p-12 border rounded-lg bg-card text-muted-foreground space-y-2">
            <p>No jobs match the current filters.</p>
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        ) : view === "grid" ? (
          <ProductionGrid jobs={filteredJobs} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredJobs.map((job) => (
              <Link key={job.id} href={`/jobs/${job.id}`}>
                <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-lg">{job.jobNumber}</CardTitle>
                        <p className="text-sm text-muted-foreground line-clamp-1">{job.name}</p>
                      </div>
                      <div className="flex flex-col gap-1 items-end">
                        <Badge variant={job.status === "active" ? "default" : "secondary"}>
                          {job.status}
                        </Badge>
                        {job.isPastDue && <Badge variant="destructive">Past Due</Badge>}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <p className="text-sm font-medium">{job.customer}</p>
                      <p className="text-sm text-muted-foreground">
                        {job.currentStageName || "Not Started"} {job.currentStageStatus ? `(${job.currentStageStatus.replace('_', ' ')})` : ""}
                      </p>
                    </div>
                    {/* Assembly rollup when job has assemblies, otherwise hours-based */}
                    {(job.assemblyCount ?? 0) > 0 ? (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span>{job.assemblyProgressPct ?? 0}% Stage Progress</span>
                          <span className="text-muted-foreground">{job.assemblyCount} assemblies</span>
                        </div>
                        <Progress value={job.assemblyProgressPct ?? 0} />
                        {job.assemblyStatus && (
                          <div className="pt-0.5">
                            <span
                              className={`inline-flex items-center gap-1 text-xs font-medium ${
                                job.assemblyStatus === "Ready to Ship"
                                  ? "text-green-600 dark:text-green-400"
                                  : job.assemblyStatus === "In Progress"
                                    ? "text-blue-600 dark:text-blue-400"
                                    : "text-muted-foreground"
                              }`}
                            >
                              {job.assemblyStatus === "Ready to Ship" && (
                                <PackageCheck className="w-3 h-3" />
                              )}
                              {job.assemblyStatus}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span>{job.percentComplete}% Complete</span>
                          <span className={job.hoursRemaining < 0 ? "text-destructive" : ""}>
                            {job.actualHours.toFixed(1)} / {job.estimatedHours.toFixed(1)}h
                          </span>
                        </div>
                        <Progress value={job.percentComplete} />
                      </div>
                    )}
                    {job.clockedInCount > 0 && (
                      <p className="text-xs text-primary font-medium">
                        {job.clockedInCount} {job.clockedInCount === 1 ? 'person' : 'people'} on the floor
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ViewToggleButton({
  active,
  onClick,
  icon,
  label,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background text-muted-foreground border-input hover:border-primary/50 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function KpiCard({ title, value, className = "" }: { title: string; value: string | number; className?: string }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-2 text-center">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <p className={`text-2xl font-bold ${className}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
