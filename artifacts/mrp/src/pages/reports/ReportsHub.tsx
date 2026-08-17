import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import {
  BarChart3,
  Clock,
  ShoppingCart,
  Calculator,
  DollarSign,
  Scissors,
  MessageSquareText,
  Package,
  FileCheck2,
} from "lucide-react";

const sections = [
  {
    title: "Labor",
    reports: [
      {
        href: "/reports/labor",
        icon: Clock,
        label: "Labor detail",
        description: "Hours per employee, job, and stage over a date range",
      },
    ],
  },
  {
    title: "Estimating & Sales",
    reports: [
      {
        href: "/reports/estimating",
        icon: Calculator,
        label: "Estimating reports",
        description: "Estimate vs actual, job margin, bid win/loss, backlog, and estimate recap",
      },
    ],
  },
  {
    title: "Purchasing & Vendors",
    reports: [
      {
        href: "/reports/purchasing",
        icon: ShoppingCart,
        label: "Purchasing reports",
        description: "Outstanding POs with due-in status and vendor performance",
      },
    ],
  },
  {
    title: "Costing & Inventory",
    reports: [
      {
        href: "/reports/costing",
        icon: DollarSign,
        label: "Job costing / WIP",
        description: "Labor, material, and PO cost rollup per job",
      },
      {
        href: "/reports/materials",
        icon: Package,
        label: "Material reports",
        description: "Monthly material movement per job and inventory cost/usage trend",
      },
    ],
  },
  {
    title: "Nesting & Material Yield",
    reports: [
      {
        href: "/reports/nesting",
        icon: Scissors,
        label: "Yield & cut lists",
        description: "Material yield/scrap from accepted nesting plans, printable cut lists",
      },
    ],
  },
  {
    title: "Documents & Quality",
    reports: [
      {
        href: "/reports/rfis",
        icon: MessageSquareText,
        label: "RFI turnaround",
        description: "Open and overdue RFIs, response turnaround time",
      },
      {
        href: "/reports/closeout",
        icon: FileCheck2,
        label: "Traceability / closeout",
        description: "Per-job material traceability and closeout package downloads",
      },
    ],
  },
];

export default function ReportsHub() {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="w-6 h-6" /> Reports
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Company-wide reporting across estimating, purchasing, production, and quality
        </p>
      </div>

      {sections.map((section) => (
        <div key={section.title}>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            {section.title}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {section.reports.map((r) => {
              const Icon = r.icon;
              return (
                <Link key={r.href} href={r.href} className="block">
                  <Card
                    className="h-full hover:border-primary/50 transition-colors cursor-pointer"
                    data-testid={`report-card-${r.href.split("/").pop()}`}
                  >
                    <CardContent className="p-5 flex gap-4">
                      <Icon className="w-6 h-6 text-primary shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold">{r.label}</div>
                        <div className="text-sm text-muted-foreground mt-1">{r.description}</div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
