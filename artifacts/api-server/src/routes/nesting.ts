import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  vendorStockLengthsTable,
  vendorsTable,
  nestingPlansTable,
  nestingPlanBarsTable,
  nestingPlanCutsTable,
  bomAssembliesTable,
  bomPartsTable,
} from "@workspace/db";
import { eq, and, inArray, asc, isNull } from "drizzle-orm";
import {
  CreateVendorStockLengthBody,
  ComputeNestingBody,
  AcceptNestingOptionBody,
} from "@workspace/api-zod";
import { parseIntParam } from "../lib/params";
import { requireAuth, requireRole } from "../middlewares/auth";
import {
  nestBom,
  type NestingInput,
  type GroupNestingResult,
  type NestingOption,
} from "../lib/nesting";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Helper: verify vendor belongs to company
// ---------------------------------------------------------------------------
async function loadVendor(vendorId: number, companyId: number) {
  const [v] = await db
    .select()
    .from(vendorsTable)
    .where(and(eq(vendorsTable.id, vendorId), eq(vendorsTable.companyId, companyId)));
  return v ?? null;
}

// ---------------------------------------------------------------------------
// Helper: verify job belongs to company (re-usable pattern from purchaseOrders)
// ---------------------------------------------------------------------------
async function loadJob(jobId: number, companyId: number) {
  const { jobsTable } = await import("@workspace/db");
  const [j] = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, companyId)));
  return j ?? null;
}

// ---------------------------------------------------------------------------
// Vendor stock lengths
// ---------------------------------------------------------------------------

router.get(
  "/vendors/:vendorId/stock-lengths",
  requireAuth,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const vendorId = parseIntParam(req.params.vendorId);
    if (vendorId === null) { res.status(400).json({ error: "Invalid vendor id" }); return; }
    const vendor = await loadVendor(vendorId, companyId);
    if (!vendor) { res.status(404).json({ error: "Vendor not found" }); return; }
    const rows = await db
      .select()
      .from(vendorStockLengthsTable)
      .where(eq(vendorStockLengthsTable.vendorId, vendorId))
      .orderBy(asc(vendorStockLengthsTable.profileType), asc(vendorStockLengthsTable.lengthIn));
    res.json(
      rows.map((r) => ({
        id: r.id,
        vendorId: r.vendorId,
        profileType: r.profileType,
        lengthIn: r.lengthIn,
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  },
);

router.post(
  "/vendors/:vendorId/stock-lengths",
  requireAuth,
  requireRole("admin", "purchasing"),
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const vendorId = parseIntParam(req.params.vendorId);
    if (vendorId === null) { res.status(400).json({ error: "Invalid vendor id" }); return; }
    const vendor = await loadVendor(vendorId, companyId);
    if (!vendor) { res.status(404).json({ error: "Vendor not found" }); return; }
    const body = CreateVendorStockLengthBody.parse(req.body);

    // Check uniqueness — use isNull() when profileType is null because
    // SQL `col = NULL` is always false (only `col IS NULL` matches null rows).
    const [existing] = await db
      .select({ id: vendorStockLengthsTable.id })
      .from(vendorStockLengthsTable)
      .where(
        and(
          eq(vendorStockLengthsTable.vendorId, vendorId),
          body.profileType != null
            ? eq(vendorStockLengthsTable.profileType, body.profileType)
            : isNull(vendorStockLengthsTable.profileType),
          eq(vendorStockLengthsTable.lengthIn, body.lengthIn),
        ),
      );
    if (existing) { res.status(409).json({ error: "That stock length already exists for this vendor/profile" }); return; }

    const [row] = await db
      .insert(vendorStockLengthsTable)
      .values({
        vendorId,
        profileType: body.profileType ?? null,
        lengthIn: body.lengthIn,
        notes: body.notes ?? null,
      })
      .returning();
    res.status(201).json({
      id: row.id,
      vendorId: row.vendorId,
      profileType: row.profileType,
      lengthIn: row.lengthIn,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
    });
  },
);

router.delete(
  "/vendors/:vendorId/stock-lengths/:stockLengthId",
  requireAuth,
  requireRole("admin", "purchasing"),
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const vendorId = parseIntParam(req.params.vendorId);
    const stockLengthId = parseIntParam(req.params.stockLengthId);
    if (vendorId === null || stockLengthId === null) { res.status(400).json({ error: "Invalid id" }); return; }
    const vendor = await loadVendor(vendorId, companyId);
    if (!vendor) { res.status(404).json({ error: "Vendor not found" }); return; }
    const [row] = await db
      .select()
      .from(vendorStockLengthsTable)
      .where(and(eq(vendorStockLengthsTable.id, stockLengthId), eq(vendorStockLengthsTable.vendorId, vendorId)));
    if (!row) { res.status(404).json({ error: "Stock length not found" }); return; }
    await db.delete(vendorStockLengthsTable).where(eq(vendorStockLengthsTable.id, stockLengthId));
    res.status(204).send();
  },
);

// ---------------------------------------------------------------------------
// Nesting compute (stateless)
// ---------------------------------------------------------------------------

router.post(
  "/jobs/:jobId/nesting/compute",
  requireAuth,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const jobId = parseIntParam(req.params.jobId);
    if (jobId === null) { res.status(400).json({ error: "Invalid job id" }); return; }
    const job = await loadJob(jobId, companyId);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

    const body = ComputeNestingBody.parse(req.body);
    const kerfIn: number = body.kerfIn ?? 0.25;

    // Load BOM parts with a length (only nestable shapes)
    const assemblies = await db
      .select()
      .from(bomAssembliesTable)
      .where(eq(bomAssembliesTable.jobId, jobId));
    const assemblyIds = assemblies.map((a) => a.id);

    const parts =
      assemblyIds.length > 0
        ? await db
            .select()
            .from(bomPartsTable)
            .where(
              and(
                inArray(bomPartsTable.assemblyId, assemblyIds),
              ),
            )
        : [];

    // Build assembly quantity map so part demand can be multiplied correctly
    const assemblyQtyMap = new Map<number, number>(assemblies.map((a) => [a.id, a.quantity]));

    // Only nest parts that have profile info and a length
    const nestableParts = parts.filter(
      (p) => p.profileType && p.profileSize && p.grade && p.lengthIn && p.lengthIn > 0,
    );

    // Group by profileType + profileSize + grade
    const groups = new Map<string, typeof nestableParts>();
    for (const p of nestableParts) {
      const key = `${p.profileType}|${p.profileSize}|${p.grade}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }

    // For each group, gather applicable vendor stock lengths
    // Stock lengths with profileType=null apply to all profiles
    const allStockLengths = await db
      .select({
        id: vendorStockLengthsTable.id,
        vendorId: vendorStockLengthsTable.vendorId,
        profileType: vendorStockLengthsTable.profileType,
        lengthIn: vendorStockLengthsTable.lengthIn,
        vendorName: vendorsTable.name,
        vendorStatus: vendorsTable.status,
      })
      .from(vendorStockLengthsTable)
      .innerJoin(vendorsTable, eq(vendorStockLengthsTable.vendorId, vendorsTable.id))
      .where(eq(vendorsTable.companyId, companyId))
      .orderBy(asc(vendorsTable.name), asc(vendorStockLengthsTable.lengthIn));

    const nestingInputs: NestingInput[] = [];

    for (const [key, partList] of groups.entries()) {
      const [profileType, profileSize, grade] = key.split("|");

      // Stock lengths for this profile: null profileType = generic, or matching type
      const stockOptions = allStockLengths
        .filter((s) => s.profileType === null || s.profileType === profileType)
        .map((s) => ({
          vendorId: s.vendorId,
          vendorName: s.vendorName,
          lengthIn: s.lengthIn,
        }));

      // Aggregate parts into demand items.
      // Total quantity = part.quantity × assembly.quantity (assembly may have qty > 1).
      const demandMap = new Map<string, { partId: number; lengthIn: number; quantity: number; label: string }>();
      for (const p of partList) {
        const demandKey = `${p.id}`;
        if (!demandMap.has(demandKey)) {
          const assemblyQty = assemblyQtyMap.get(p.assemblyId) ?? 1;
          demandMap.set(demandKey, {
            partId: p.id,
            lengthIn: p.lengthIn!,
            quantity: p.quantity * assemblyQty,
            label: [p.partMark, p.description].filter(Boolean).join(" — ") || `Part ${p.id}`,
          });
        }
      }

      nestingInputs.push({
        profileType: profileType!,
        profileSize: profileSize!,
        grade: grade!,
        demand: Array.from(demandMap.values()),
        remnants: [], // Phase 4 integration: pass available remnants once inventory module lands
        stockOptions,
        kerfIn,
      });
    }

    const groupResults: GroupNestingResult[] = nestBom(nestingInputs);

    res.json({
      kerfIn,
      groups: groupResults.map((g) => ({
        profileType: g.profileType,
        profileSize: g.profileSize,
        grade: g.grade,
        unnestable: g.unnestable,
        options: g.options.map((o) => ({
          vendorId: o.vendorId,
          vendorName: o.vendorName,
          stockLengthIn: o.stockLengthIn,
          isComplete: o.isComplete,
          missingParts: o.missingParts,
          totalStockIn: o.totalStockIn,
          totalUsedIn: o.totalUsedIn,
          totalWasteIn: o.totalWasteIn,
          wastePercent: o.wastePercent,
          bars: o.bars.map((b) => ({
            source: b.source,
            vendorId: b.vendorId,
            vendorName: b.vendorName,
            stockLengthIn: b.stockLengthIn,
            wasteIn: b.wasteIn,
            remnantRef: b.remnantRef,
            cuts: b.cuts,
          })),
        })),
      })),
    });
  },
);

// ---------------------------------------------------------------------------
// Nesting plan: accept, get, delete
// ---------------------------------------------------------------------------

/** Build full plan view from persisted rows. */
async function buildPlanView(planId: number, jobId: number, kerfIn: number, status: string, createdAt: Date, acceptedAt: Date | null) {
  const bars = await db
    .select()
    .from(nestingPlanBarsTable)
    .where(eq(nestingPlanBarsTable.planId, planId))
    .orderBy(asc(nestingPlanBarsTable.sortIndex));

  const barIds = bars.map((b) => b.id);
  const cuts =
    barIds.length > 0
      ? await db
          .select()
          .from(nestingPlanCutsTable)
          .where(inArray(nestingPlanCutsTable.barId, barIds))
          .orderBy(asc(nestingPlanCutsTable.sortIndex))
      : [];

  const cutsByBar = new Map<number, typeof cuts>();
  for (const c of cuts) {
    if (!cutsByBar.has(c.barId)) cutsByBar.set(c.barId, []);
    cutsByBar.get(c.barId)!.push(c);
  }

  // Group bars by profile
  const groupMap = new Map<string, { profileType: string; profileSize: string; grade: string; bars: typeof bars }>();
  for (const b of bars) {
    const key = `${b.profileType}|${b.profileSize}|${b.grade}`;
    if (!groupMap.has(key)) groupMap.set(key, { profileType: b.profileType, profileSize: b.profileSize, grade: b.grade, bars: [] });
    groupMap.get(key)!.bars.push(b);
  }

  const groups = Array.from(groupMap.values()).map(({ profileType, profileSize, grade, bars: groupBars }) => {
    const totalStockIn = groupBars.reduce((s, b) => s + b.stockLengthIn, 0);
    const totalWasteIn = groupBars.reduce((s, b) => s + b.wasteIn, 0);
    return {
      profileType,
      profileSize,
      grade,
      totalStockIn,
      totalWasteIn,
      wastePercent: totalStockIn > 0 ? (totalWasteIn / totalStockIn) * 100 : 0,
      bars: groupBars.map((b) => ({
        source: b.source,
        vendorId: b.vendorId,
        vendorName: b.vendorName,
        stockLengthIn: b.stockLengthIn,
        wasteIn: b.wasteIn,
        remnantRef: b.remnantRef,
        cuts: (cutsByBar.get(b.id) ?? []).map((c) => ({
          partId: c.bomPartId,
          lengthIn: c.lengthIn,
          quantity: c.quantity,
          label: c.label ?? "",
        })),
      })),
    };
  });

  return {
    id: planId,
    jobId,
    status,
    kerfIn,
    groups,
    createdAt: createdAt.toISOString(),
    acceptedAt: acceptedAt?.toISOString() ?? null,
  };
}

router.get(
  "/jobs/:jobId/nesting/plan",
  requireAuth,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const jobId = parseIntParam(req.params.jobId);
    if (jobId === null) { res.status(400).json({ error: "Invalid job id" }); return; }
    const job = await loadJob(jobId, companyId);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

    const [plan] = await db
      .select()
      .from(nestingPlansTable)
      .where(and(eq(nestingPlansTable.jobId, jobId), eq(nestingPlansTable.status, "accepted")))
      .orderBy(asc(nestingPlansTable.createdAt));

    if (!plan) { res.status(404).json({ error: "No accepted nesting plan for this job" }); return; }

    res.json(await buildPlanView(plan.id, jobId, plan.kerfIn, plan.status, plan.createdAt, plan.acceptedAt ?? null));
  },
);

router.post(
  "/jobs/:jobId/nesting/plan",
  requireAuth,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const jobId = parseIntParam(req.params.jobId);
    if (jobId === null) { res.status(400).json({ error: "Invalid job id" }); return; }
    const job = await loadJob(jobId, companyId);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

    const body = AcceptNestingOptionBody.parse(req.body);
    const { kerfIn, groups: selectedGroups } = body;

    // Validate: submitted group keys must be unique
    const submittedKeys = selectedGroups.map((s) => `${s.profileType}|${s.profileSize}|${s.grade}`);
    if (new Set(submittedKeys).size !== submittedKeys.length) {
      res.status(400).json({ error: "Duplicate group selections are not allowed — each BOM profile group must appear exactly once" });
      return;
    }

    // Load BOM
    const assemblies = await db
      .select()
      .from(bomAssembliesTable)
      .where(eq(bomAssembliesTable.jobId, jobId));
    const assemblyIds = assemblies.map((a) => a.id);
    const acceptAssemblyQtyMap = new Map<number, number>(assemblies.map((a) => [a.id, a.quantity]));
    const parts =
      assemblyIds.length > 0
        ? await db.select().from(bomPartsTable).where(inArray(bomPartsTable.assemblyId, assemblyIds))
        : [];
    const nestableParts = parts.filter(
      (p) => p.profileType && p.profileSize && p.grade && p.lengthIn && p.lengthIn > 0,
    );

    // Build BOM group map
    const bomGroups = new Map<string, typeof nestableParts>();
    for (const p of nestableParts) {
      const key = `${p.profileType}|${p.profileSize}|${p.grade}`;
      if (!bomGroups.has(key)) bomGroups.set(key, []);
      bomGroups.get(key)!.push(p);
    }

    // Validate: every BOM group must be present in the request
    const requestedKeys = new Set(selectedGroups.map((s) => `${s.profileType}|${s.profileSize}|${s.grade}`));
    const missingGroups = [...bomGroups.keys()].filter((k) => !requestedKeys.has(k));
    if (missingGroups.length > 0) {
      res.status(400).json({ error: `The following BOM profile groups are not covered by the selection: ${missingGroups.join(", ")}` });
      return;
    }

    // Load stock lengths
    const allStockLengths = await db
      .select({
        vendorId: vendorStockLengthsTable.vendorId,
        profileType: vendorStockLengthsTable.profileType,
        lengthIn: vendorStockLengthsTable.lengthIn,
        vendorName: vendorsTable.name,
      })
      .from(vendorStockLengthsTable)
      .innerJoin(vendorsTable, eq(vendorStockLengthsTable.vendorId, vendorsTable.id))
      .where(eq(vendorsTable.companyId, companyId));

    // Re-run engine for each requested group and pick the selected option
    const pickedOptions: Array<{ profileType: string; profileSize: string; grade: string; option: NestingOption }> = [];

    for (const sel of selectedGroups) {
      const key = `${sel.profileType}|${sel.profileSize}|${sel.grade}`;
      const partList = bomGroups.get(key);
      if (!partList) { res.status(400).json({ error: `Group ${key} not found in job BOM` }); return; }

      const stockOptions = allStockLengths
        .filter((s) => s.profileType === null || s.profileType === sel.profileType)
        .map((s) => ({ vendorId: s.vendorId, vendorName: s.vendorName, lengthIn: s.lengthIn }));

      const demandMap = new Map<string, { partId: number; lengthIn: number; quantity: number; label: string }>();
      for (const p of partList) {
        const assemblyQty = acceptAssemblyQtyMap.get(p.assemblyId) ?? 1;
        demandMap.set(`${p.id}`, {
          partId: p.id,
          lengthIn: p.lengthIn!,
          quantity: p.quantity * assemblyQty,
          label: [p.partMark, p.description].filter(Boolean).join(" — ") || `Part ${p.id}`,
        });
      }

      const { options } = nestBom([{
        profileType: sel.profileType,
        profileSize: sel.profileSize,
        grade: sel.grade,
        demand: Array.from(demandMap.values()),
        remnants: [],
        stockOptions,
        kerfIn,
      }])[0]!;

      // Find option by stable identity (vendorId + stockLengthIn) rather than array index
      const picked = options.find(
        (o) => o.vendorId === sel.vendorId && Math.abs(o.stockLengthIn - sel.stockLengthIn) < 0.001,
      );
      if (!picked) {
        res.status(400).json({
          error: `No option with vendorId=${sel.vendorId}, stockLengthIn=${sel.stockLengthIn} found for group ${key}. Re-run nesting to get fresh options.`,
        });
        return;
      }

      // Refuse to accept an incomplete option — it would produce a cut list missing required parts
      if (!picked.isComplete) {
        res.status(400).json({
          error: `The selected option for group ${key} cannot be accepted: ${picked.missingParts.length} part(s) are longer than this stock length and would be omitted from the cut list.`,
          missingParts: picked.missingParts,
        });
        return;
      }

      pickedOptions.push({ profileType: sel.profileType, profileSize: sel.profileSize, grade: sel.grade, option: picked });
    }

    // Persist atomically: delete existing plan + insert new one in a transaction.
    // A partial unique index (nesting_plans_one_accepted_per_job) enforces at most one
    // accepted plan per job at the DB level, so concurrent requests will get a conflict error.
    let plan: typeof import("@workspace/db").nestingPlansTable.$inferSelect;
    try {
    plan = await db.transaction(async (tx) => {
      // Delete any existing accepted plan (cascade deletes bars + cuts)
      await tx
        .delete(nestingPlansTable)
        .where(and(eq(nestingPlansTable.jobId, jobId), eq(nestingPlansTable.status, "accepted")));

      // Insert plan
      const [newPlan] = await tx
        .insert(nestingPlansTable)
        .values({
          jobId,
          status: "accepted",
          kerfIn,
          createdBy: req.auth!.user.id,
          acceptedAt: new Date(),
        })
        .returning();

      // Insert bars + cuts
      let barSortIndex = 0;
      for (const { profileType, profileSize, grade, option } of pickedOptions) {
        for (const bar of option.bars) {
          const [barRow] = await tx
            .insert(nestingPlanBarsTable)
            .values({
              planId: newPlan!.id,
              profileType,
              profileSize,
              grade,
              source: bar.source,
              vendorId: bar.vendorId,
              vendorName: bar.vendorName,
              stockLengthIn: bar.stockLengthIn,
              wasteIn: bar.wasteIn,
              remnantRef: bar.remnantRef,
              sortIndex: barSortIndex++,
            })
            .returning();

          let cutSortIndex = 0;
          for (const cut of bar.cuts) {
            await tx.insert(nestingPlanCutsTable).values({
              barId: barRow!.id,
              bomPartId: cut.partId,
              lengthIn: cut.lengthIn,
              quantity: cut.quantity,
              label: cut.label,
              sortIndex: cutSortIndex++,
            });
          }
        }
      }

      return newPlan!;
    });
    } catch (err: unknown) {
      // Unique constraint on nesting_plans_one_accepted_per_job fires when two
      // concurrent requests both deleted the old plan and raced to insert a new one.
      const msg = String((err as { message?: string })?.message ?? "");
      if (msg.includes("nesting_plans_one_accepted_per_job") || msg.includes("unique") || msg.includes("duplicate")) {
        res.status(409).json({ error: "Another nesting plan was just accepted for this job — please reload and try again." });
        return;
      }
      throw err;
    }

    res.status(201).json(await buildPlanView(plan!.id, jobId, plan!.kerfIn, plan!.status, plan!.createdAt, plan!.acceptedAt ?? null));
  },
);

router.delete(
  "/jobs/:jobId/nesting/plan",
  requireAuth,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const jobId = parseIntParam(req.params.jobId);
    if (jobId === null) { res.status(400).json({ error: "Invalid job id" }); return; }
    const job = await loadJob(jobId, companyId);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

    await db
      .delete(nestingPlansTable)
      .where(and(eq(nestingPlansTable.jobId, jobId), eq(nestingPlansTable.status, "accepted")));
    res.status(204).send();
  },
);

// ---------------------------------------------------------------------------
// Cut list
// ---------------------------------------------------------------------------

router.get(
  "/jobs/:jobId/nesting/cut-list",
  requireAuth,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const jobId = parseIntParam(req.params.jobId);
    if (jobId === null) { res.status(400).json({ error: "Invalid job id" }); return; }
    const job = await loadJob(jobId, companyId);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

    const [plan] = await db
      .select()
      .from(nestingPlansTable)
      .where(and(eq(nestingPlansTable.jobId, jobId), eq(nestingPlansTable.status, "accepted")));
    if (!plan) { res.status(404).json({ error: "No accepted nesting plan for this job" }); return; }

    const bars = await db
      .select()
      .from(nestingPlanBarsTable)
      .where(eq(nestingPlanBarsTable.planId, plan.id))
      .orderBy(asc(nestingPlanBarsTable.sortIndex));

    const barIds = bars.map((b) => b.id);
    const cuts =
      barIds.length > 0
        ? await db.select().from(nestingPlanCutsTable).where(inArray(nestingPlanCutsTable.barId, barIds)).orderBy(asc(nestingPlanCutsTable.sortIndex))
        : [];

    const cutsByBar = new Map<number, typeof cuts>();
    for (const c of cuts) {
      if (!cutsByBar.has(c.barId)) cutsByBar.set(c.barId, []);
      cutsByBar.get(c.barId)!.push(c);
    }

    const groupMap = new Map<string, { profileType: string; profileSize: string; grade: string; bars: typeof bars }>();
    for (const b of bars) {
      const key = `${b.profileType}|${b.profileSize}|${b.grade}`;
      if (!groupMap.has(key)) groupMap.set(key, { profileType: b.profileType, profileSize: b.profileSize, grade: b.grade, bars: [] });
      groupMap.get(key)!.bars.push(b);
    }

    const groups = Array.from(groupMap.values()).map(({ profileType, profileSize, grade, bars: groupBars }) => {
      const totalStockIn = groupBars.reduce((s, b) => s + b.stockLengthIn, 0);
      const totalWasteIn = groupBars.reduce((s, b) => s + b.wasteIn, 0);
      return {
        profileType,
        profileSize,
        grade,
        totalBars: groupBars.length,
        totalStockIn,
        totalWasteIn,
        wastePercent: totalStockIn > 0 ? (totalWasteIn / totalStockIn) * 100 : 0,
        bars: groupBars.map((b, idx) => ({
          barIndex: idx + 1,
          source: b.source,
          vendorName: b.vendorName,
          stockLengthIn: b.stockLengthIn,
          wasteIn: b.wasteIn,
          wastePercent: b.stockLengthIn > 0 ? (b.wasteIn / b.stockLengthIn) * 100 : 0,
          remnantRef: b.remnantRef,
          cuts: (cutsByBar.get(b.id) ?? []).map((c) => ({
            partId: c.bomPartId,
            lengthIn: c.lengthIn,
            quantity: c.quantity,
            label: c.label ?? "",
          })),
        })),
      };
    });

    res.json({ planId: plan.id, jobId, kerfIn: plan.kerfIn, groups });
  },
);

export default router;
