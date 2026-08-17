import {
  db,
  pool,
  jobsTable,
  stagesTable,
  customersTable,
  companiesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import path from "node:path";
import fs from "node:fs";

const TRACKER = path.resolve(
  import.meta.dirname,
  "../../attached_assets/QC-006-F1_Production_Tracker_1783531705656.xlsx",
);

// Production stages in tracker order (Lookups sheet).
const STAGES = [
  "Parts Processing",
  "Sent to Vendor",
  "At Vendor",
  "Ready for Pickup",
  "Cut",
  "Fit",
  "Welded",
  "Inspected",
  "Shipped",
] as const;

const CUSTOMER_NAME = "S&S Steel";

type Assembly = {
  mark: string;
  description: string;
  qty: number;
  path: string;
  stage: string;
  onHold: boolean;
  holdReason: string;
  notes: string;
};

type TrackerJob = {
  customerJob: string; // e.g. "S&S 431"
  emJob: string; // e.g. "EM 25048"
  description: string; // e.g. "Handrail"
  dueDate: string | null; // YYYY-MM-DD
  assemblies: Assembly[];
};

function clean(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\s+/g, " ").trim();
}

function parseDueDate(v: unknown): string | null {
  const s = clean(v);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  if (typeof v === "number") {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v);
    if (d)
      return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  return null;
}

function extract(): TrackerJob[] {
  const wb = XLSX.read(fs.readFileSync(TRACKER), { type: "buffer" });

  // Dashboard: customer job -> EM job/description + due date
  const dashRows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets.Dashboard, {
    header: 1,
  });
  const dashHeaderIdx = dashRows.findIndex(
    (r) => Array.isArray(r) && r.includes("Customer Job"),
  );
  if (dashHeaderIdx === -1)
    throw new Error(
      "Dashboard sheet: header row with 'Customer Job' not found — tracker format changed?",
    );
  const jobs = new Map<string, TrackerJob>();
  for (const row of dashRows.slice(dashHeaderIdx + 1)) {
    if (!Array.isArray(row)) continue;
    const customerJob = clean(row[1]);
    const emField = clean(row[2]); // "EM 25048  Handrail"
    if (!customerJob || !emField) continue;
    const m = emField.match(/^(EM\s*\d+)\s+(.*)$/);
    jobs.set(customerJob, {
      customerJob,
      emJob: m ? m[1].replace(/\s+/, " ") : emField,
      description: m ? m[2] : emField,
      dueDate: parseDueDate(row[3]),
      assemblies: [],
    });
  }

  // Detail: per-assembly rows
  const detailRows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets.Detail, {
    header: 1,
  });
  const detailHeaderIdx = detailRows.findIndex(
    (r) => Array.isArray(r) && r.includes("Mark / Assy"),
  );
  if (detailHeaderIdx === -1)
    throw new Error(
      "Detail sheet: header row with 'Mark / Assy' not found — tracker format changed?",
    );
  for (const row of detailRows.slice(detailHeaderIdx + 1)) {
    if (!Array.isArray(row)) continue;
    const customerJob = clean(row[1]);
    const mark = clean(row[2]);
    const stage = clean(row[6]);
    if (!customerJob || !mark || !STAGES.includes(stage as never)) continue;
    const job = jobs.get(customerJob);
    if (!job) continue;
    job.assemblies.push({
      mark,
      description: clean(row[3]),
      qty: Number(row[4]) || 1,
      path: clean(row[5]),
      stage,
      onHold: clean(row[7]).toLowerCase() === "yes",
      holdReason: clean(row[8]),
      notes: clean(row[10]),
    });
  }

  return [...jobs.values()].filter((j) => j.assemblies.length > 0);
}

// A job stage is complete when every assembly has reached at least that
// stage (an assembly's "Current Stage" means work through that stage is
// done). The first incomplete stage is in_progress.
function stageStatuses(job: TrackerJob): string[] {
  const minReached = Math.min(
    ...job.assemblies.map((a) => STAGES.indexOf(a.stage as never)),
  );
  return STAGES.map((_, i) => {
    if (i <= minReached) return "complete";
    if (i === minReached + 1) return "in_progress";
    return "not_started";
  });
}

function buildNotes(job: TrackerJob): string {
  const held = job.assemblies.filter((a) => a.onHold);
  const lines = [
    `Imported from production tracker (QC-006-F1). Customer job ${job.customerJob} — ${job.assemblies.length} assemblies, total qty ${job.assemblies.reduce((s, a) => s + a.qty, 0)}.`,
    "",
    "Assemblies:",
    ...job.assemblies.map(
      (a) =>
        `- ${a.mark} ${a.description} (qty ${a.qty}, ${a.path}) — ${a.stage}${a.onHold ? ` [ON HOLD: ${a.holdReason || "no reason given"}]` : ""}${a.notes ? ` — ${a.notes}` : ""}`,
    ),
  ];
  if (held.length > 0)
    lines.push("", `${held.length} assembly(ies) on hold — see above.`);
  return lines.join("\n");
}

async function main() {
  // Jobs in the tracker belong to S&S Steel
  const [ssSteelCo] = await db
    .select({ id: companiesTable.id })
    .from(companiesTable)
    .where(eq(companiesTable.slug, "ss-steel"))
    .limit(1);
  if (!ssSteelCo) {
    throw new Error("S&S Steel company not found. Run `pnpm --filter @workspace/scripts run seed:companies` first.");
  }
  const companyId = ssSteelCo.id;

  const trackerJobs = extract();
  console.log(
    `Extracted ${trackerJobs.length} jobs from tracker: ${trackerJobs.map((j) => `${j.emJob} (${j.customerJob})`).join(", ")}`,
  );

  const [customer] = await db
    .select()
    .from(customersTable)
    .where(eq(customersTable.name, CUSTOMER_NAME));
  if (!customer) {
    throw new Error(
      `Customer "${CUSTOMER_NAME}" not found — run import:customers first.`,
    );
  }

  const existingJobs = await db.select().from(jobsTable);
  const byNumber = new Map(
    existingJobs.map((j) => [j.jobNumber.toLowerCase(), j]),
  );

  let created = 0;
  let skipped = 0;

  // Note: legacy jobs keep their real "EM ####" numbers from the tracker;
  // the app's normal create flow auto-assigns "J-####" and is unaffected.
  for (const tj of trackerJobs) {
    const numKey = tj.emJob.toLowerCase();
    if (byNumber.has(numKey)) {
      skipped++;
      continue;
    }

    const statuses = stageStatuses(tj);
    const allShipped = statuses.every((s) => s === "complete");
    const anyHold = tj.assemblies.some((a) => a.onHold);

    await db.transaction(async (tx) => {
      const [job] = await tx
        .insert(jobsTable)
        .values({
          companyId,
          jobNumber: tj.emJob,
          name: `${tj.description} — ${tj.customerJob}`,
          customer: customer.name,
          customerId: customer.id,
          status: allShipped ? "complete" : anyHold ? "on_hold" : "active",
          dueDate: tj.dueDate,
          notes: buildNotes(tj),
        })
        .returning();

      for (let i = 0; i < STAGES.length; i++) {
        await tx.insert(stagesTable).values({
          jobId: job.id,
          name: STAGES[i],
          orderIndex: i,
          status: statuses[i],
          estimatedHours: 0,
        });
      }
    });
    byNumber.set(numKey, { jobNumber: tj.emJob } as never);
    created++;
    console.log(
      `Created ${tj.emJob} "${tj.description} — ${tj.customerJob}" (${tj.assemblies.length} assemblies, due ${tj.dueDate ?? "n/a"})`,
    );
  }

  console.log(`Done. Created ${created} job(s), skipped ${skipped} existing.`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
