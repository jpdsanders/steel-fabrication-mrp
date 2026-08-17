import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  poApprovalThresholdsTable,
  type PoApprovalThresholdRow,
} from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { ReplaceApprovalThresholdsBody } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

/**
 * EM's tiers as editable per-company defaults:
 * $0–2,500 auto-approve; $2,500.01–10,000 purchasing approval;
 * over $10,000 admin approval.
 */
const DEFAULT_TIERS = [
  { minTotal: 0, label: "Auto-approve", requiredRole: null as string | null },
  { minTotal: 2500.01, label: "Requires purchasing approval", requiredRole: "purchasing" },
  { minTotal: 10000.01, label: "Requires admin approval", requiredRole: "admin" },
];

function tierView(t: PoApprovalThresholdRow) {
  return { id: t.id, minTotal: t.minTotal, label: t.label, requiredRole: t.requiredRole };
}

/** Load a company's tiers, seeding editable defaults on first access. */
export async function getOrSeedThresholds(companyId: number): Promise<PoApprovalThresholdRow[]> {
  const rows = await db
    .select()
    .from(poApprovalThresholdsTable)
    .where(eq(poApprovalThresholdsTable.companyId, companyId))
    .orderBy(asc(poApprovalThresholdsTable.minTotal));
  if (rows.length > 0) return rows;
  return db
    .insert(poApprovalThresholdsTable)
    .values(DEFAULT_TIERS.map((t) => ({ companyId, ...t })))
    .returning();
}

/** Pick the tier applying to a PO total (highest minTotal <= total). */
export function tierForTotal(
  tiers: PoApprovalThresholdRow[],
  total: number,
): PoApprovalThresholdRow | null {
  let match: PoApprovalThresholdRow | null = null;
  for (const t of [...tiers].sort((a, b) => a.minTotal - b.minTotal)) {
    if (t.minTotal <= total) match = t;
  }
  return match;
}

router.get("/po-approval-thresholds", requireAuth, async (req, res): Promise<void> => {
  const tiers = await getOrSeedThresholds(req.auth!.companyId);
  res.json(tiers.sort((a, b) => a.minTotal - b.minTotal).map(tierView));
});

// Only admins may change the approval matrix — otherwise any user could
// weaken the gates (e.g. make everything auto-approve).
router.put("/po-approval-thresholds", requireAuth, requireRole("admin"), async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const body = ReplaceApprovalThresholdsBody.parse(req.body);
  if (body.tiers.length === 0) {
    res.status(400).json({ error: "At least one tier is required." });
    return;
  }
  const mins = body.tiers.map((t) => t.minTotal);
  if (new Set(mins).size !== mins.length) {
    res.status(400).json({ error: "Tier minimums must be unique." });
    return;
  }
  if (!mins.includes(0)) {
    res.status(400).json({ error: "One tier must start at $0." });
    return;
  }
  const inserted = await db.transaction(async (tx) => {
    await tx.delete(poApprovalThresholdsTable).where(eq(poApprovalThresholdsTable.companyId, companyId));
    return tx
      .insert(poApprovalThresholdsTable)
      .values(body.tiers.map((t) => ({
        companyId,
        minTotal: t.minTotal,
        label: t.label.trim(),
        requiredRole: t.requiredRole ?? null,
      })))
      .returning();
  });
  req.log.info({ companyId, tierCount: inserted.length }, "PO approval thresholds replaced");
  res.json(inserted.sort((a, b) => a.minTotal - b.minTotal).map(tierView));
});

export default router;
