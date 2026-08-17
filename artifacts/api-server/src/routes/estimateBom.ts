import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  estimatesTable,
  estimateBomAssembliesTable,
  estimateBomPartsTable,
  estimateLaborLinesTable,
  laborRatesTable,
  materialCatalogTable,
} from "@workspace/db";
import { eq, and, inArray, asc, sql } from "drizzle-orm";
import multer from "multer";
import path from "path";
import {
  parseKissFile,
  KissParseError,
  type ParsedBom,
} from "../lib/kissParser";
import { parseIntParam } from "../lib/params";
import {
  CommitEstimateBomImportBody,
  CreateEstimateBomAssemblyBody,
  UpdateEstimateBomAssemblyBody,
  CreateEstimateBomPartBody,
  UpdateEstimateBomPartBody,
  CreateEstimateLaborLineBody,
  UpdateEstimateLaborLineBody,
} from "@workspace/api-zod";
import { MAX_DOCUMENT_SIZE_BYTES } from "./documents";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
});

type EstimateRow = typeof estimatesTable.$inferSelect;
type AsmRow = typeof estimateBomAssembliesTable.$inferSelect;
type PartRow = typeof estimateBomPartsTable.$inferSelect;

async function loadEstimate(
  estimateId: number,
  companyId: number,
): Promise<EstimateRow | null> {
  const [estimate] = await db
    .select()
    .from(estimatesTable)
    .where(
      and(
        eq(estimatesTable.id, estimateId),
        eq(estimatesTable.companyId, companyId),
      ),
    );
  return estimate ?? null;
}

export function materialKey(
  profileType: string | null,
  profileSize: string | null,
  grade: string | null,
): string {
  return `${(profileType ?? "").trim().toUpperCase()}|${(profileSize ?? "")
    .trim()
    .toUpperCase()}|${(grade ?? "").trim().toUpperCase()}`;
}

/**
 * Compute the extended cost of a part line, when priceable.
 * per_foot uses lengthIn; per_piece uses quantities; per_lb cannot be
 * computed (no weight data) and returns null — explicit, not guessed.
 */
export function computeLineCost(
  part: {
    quantity: number;
    lengthIn: number | null;
    pricingStatus: string;
    catalogUnitPrice: number | null;
    catalogPriceUnit: string | null;
    quotedUnitPrice: number | null;
    quotedPriceUnit: string | null;
  },
  assemblyQuantity: number,
): number | null {
  const price = part.quotedUnitPrice ?? part.catalogUnitPrice;
  const unit = part.quotedUnitPrice != null
    ? (part.quotedPriceUnit ?? "per_piece")
    : (part.catalogPriceUnit ?? "per_foot");
  if (price == null) return null;
  if (part.pricingStatus === "needs_quote" && part.quotedUnitPrice == null) {
    return null;
  }
  const pieces = part.quantity * assemblyQuantity;
  if (unit === "per_piece") return round2(price * pieces);
  if (unit === "per_foot") {
    if (part.lengthIn == null) return null;
    return round2(price * (part.lengthIn / 12) * pieces);
  }
  // per_lb: no weight data available — cannot compute.
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function partToView(p: PartRow, assemblyQuantity: number) {
  return {
    id: p.id,
    partMark: p.partMark,
    quantity: p.quantity,
    profileType: p.profileType,
    profileSize: p.profileSize,
    grade: p.grade,
    lengthIn: p.lengthIn,
    description: p.description,
    pricingStatus: p.pricingStatus,
    catalogItemId: p.catalogItemId,
    catalogUnitPrice: p.catalogUnitPrice,
    catalogPriceUnit: p.catalogPriceUnit,
    quotedUnitPrice: p.quotedUnitPrice,
    quotedPriceUnit: p.quotedPriceUnit,
    quoteSource: p.quoteSource,
    isMisc: p.isMisc,
    lineCost: computeLineCost(p, assemblyQuantity),
  };
}

export async function loadEstimateBom(estimateId: number) {
  const asmRows = await db
    .select()
    .from(estimateBomAssembliesTable)
    .where(eq(estimateBomAssembliesTable.estimateId, estimateId))
    .orderBy(asc(estimateBomAssembliesTable.sortIndex));
  const partRows = asmRows.length
    ? await db
        .select()
        .from(estimateBomPartsTable)
        .where(
          inArray(
            estimateBomPartsTable.assemblyId,
            asmRows.map((a) => a.id),
          ),
        )
        .orderBy(asc(estimateBomPartsTable.sortIndex))
    : [];
  const partsByAsm = new Map<number, PartRow[]>();
  for (const p of partRows) {
    const list = partsByAsm.get(p.assemblyId) ?? [];
    list.push(p);
    partsByAsm.set(p.assemblyId, list);
  }
  return { asmRows, partsByAsm };
}

function assemblyToView(a: AsmRow, parts: PartRow[]) {
  return {
    id: a.id,
    mark: a.mark,
    quantity: a.quantity,
    description: a.description,
    finish: a.finish,
    parts: parts.map((p) => partToView(p, a.quantity)),
  };
}

export async function buildEstimateBomView(estimateId: number) {
  const { asmRows, partsByAsm } = await loadEstimateBom(estimateId);
  const assemblies = asmRows.map((a) =>
    assemblyToView(a, partsByAsm.get(a.id) ?? []),
  );
  const totalsMap = new Map<
    string,
    {
      profileType: string | null;
      profileSize: string | null;
      grade: string | null;
      pieces: number;
      totalLengthIn: number | null;
    }
  >();
  let partCount = 0;
  let totalPieces = 0;
  let materialCost = 0;
  let needsQuoteCount = 0;
  let manualCount = 0;
  for (const a of asmRows) {
    for (const p of partsByAsm.get(a.id) ?? []) {
      partCount += 1;
      const pieces = p.quantity * a.quantity;
      totalPieces += pieces;
      if (p.pricingStatus === "needs_quote") needsQuoteCount += 1;
      if (p.pricingStatus === "manual") manualCount += 1;
      const cost = computeLineCost(p, a.quantity);
      if (cost != null) materialCost += cost;
      const key = materialKey(p.profileType, p.profileSize, p.grade);
      const entry = totalsMap.get(key) ?? {
        profileType: p.profileType,
        profileSize: p.profileSize,
        grade: p.grade,
        pieces: 0,
        totalLengthIn: null as number | null,
      };
      entry.pieces += pieces;
      if (p.lengthIn !== null) {
        entry.totalLengthIn = round2(
          (entry.totalLengthIn ?? 0) + p.lengthIn * pieces,
        );
      }
      totalsMap.set(key, entry);
    }
  }
  const totals = [...totalsMap.values()].sort(
    (x, y) =>
      (x.profileType ?? "").localeCompare(y.profileType ?? "") ||
      (x.profileSize ?? "").localeCompare(y.profileSize ?? ""),
  );
  return {
    assemblyCount: assemblies.length,
    partCount,
    totalPieces,
    materialCost: round2(materialCost),
    needsQuoteCount,
    manualCount,
    assemblies,
    totals,
  };
}

/** Case-insensitive exact match of (profileType, profileSize, grade) against the catalog. */
async function matchCatalog(
  keys: {
    profileType: string | null;
    profileSize: string | null;
    grade: string | null;
  }[],
) {
  const catalog = await db.select().from(materialCatalogTable);
  const byKey = new Map(
    catalog.map((c) => [materialKey(c.profileType, c.profileSize, c.grade), c]),
  );
  return keys.map((k) => {
    // Only a fully-specified material can be confidently matched.
    if (!k.profileType || !k.profileSize || !k.grade) return null;
    return byKey.get(materialKey(k.profileType, k.profileSize, k.grade)) ?? null;
  });
}

/**
 * Detailed-BOM absorption: replaces an estimate's BOM with a job's freshly
 * imported KISS BOM. Each material auto-matches against the catalog (matched
 * only when fully specified and a catalog price exists); everything else is
 * flagged needs_quote — never silently guessed. Runs when a job that was
 * created from a (preliminary) estimate receives a real detailed package,
 * so the estimate's pricing/quote reflects the detailed BOM while the
 * job/customer/PO history is preserved.
 */
export async function absorbJobBomIntoEstimate(
  estimateId: number,
  parsed: {
    assemblies: {
      mark: string;
      quantity: number;
      description: string | null;
      finish: string | null;
      parts: {
        partMark: string | null;
        quantity: number;
        profileType: string | null;
        profileSize: string | null;
        grade: string | null;
        lengthIn: number | null;
        description: string | null;
      }[];
    }[];
  },
): Promise<void> {
  const allParts = parsed.assemblies.flatMap((a) => a.parts);
  const matches = await matchCatalog(
    allParts.map((p) => ({
      profileType: p.profileType,
      profileSize: p.profileSize,
      grade: p.grade,
    })),
  );
  const matchByIndex = new Map(allParts.map((p, i) => [p, matches[i]]));

  await db.transaction(async (tx) => {
    await tx
      .delete(estimateBomAssembliesTable)
      .where(eq(estimateBomAssembliesTable.estimateId, estimateId));
    for (let i = 0; i < parsed.assemblies.length; i++) {
      const a = parsed.assemblies[i];
      const [asm] = await tx
        .insert(estimateBomAssembliesTable)
        .values({
          estimateId,
          mark: a.mark,
          quantity: a.quantity,
          description: a.description,
          finish: a.finish,
          sortIndex: i,
        })
        .returning();
      if (a.parts.length === 0) continue;
      await tx.insert(estimateBomPartsTable).values(
        a.parts.map((p, j) => {
          const match = matchByIndex.get(p) ?? null;
          const matched = match != null && match.unitPrice != null;
          return {
            assemblyId: asm.id,
            partMark: p.partMark,
            quantity: p.quantity,
            profileType: p.profileType,
            profileSize: p.profileSize,
            grade: p.grade,
            lengthIn: p.lengthIn,
            description: p.description,
            sortIndex: j,
            pricingStatus: matched ? ("matched" as const) : ("needs_quote" as const),
            catalogItemId: matched ? match.id : null,
            catalogUnitPrice: matched ? match.unitPrice : null,
            catalogPriceUnit: matched ? match.priceUnit : null,
          };
        }),
      );
    }
  });
}

// ---------- BOM view ----------

router.get(
  "/estimates/:estimateId/bom",
  requireAuth,
  async (req, res): Promise<void> => {
    const estimateId = parseIntParam(req.params.estimateId);
    if (estimateId === null) {
      res.status(400).json({ error: "Invalid estimate id" });
      return;
    }
    const estimate = await loadEstimate(estimateId, req.auth!.companyId);
    if (!estimate) {
      res.status(404).json({ error: "Estimate not found" });
      return;
    }
    res.json(await buildEstimateBomView(estimateId));
  },
);

// ---------- KISS import: parse + preview with catalog matching ----------

router.post(
  "/estimates/:estimateId/bom/parse",
  requireAuth,
  upload.single("file"),
  async (req, res): Promise<void> => {
    const estimateId = parseIntParam(req.params.estimateId);
    if (estimateId === null) {
      res.status(400).json({ error: "Invalid estimate id" });
      return;
    }
    const estimate = await loadEstimate(estimateId, req.auth!.companyId);
    if (!estimate) {
      res.status(404).json({ error: "Estimate not found" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No file provided. Attach a file in the 'file' field." });
      return;
    }
    const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    const ext = path.extname(originalName).toLowerCase();
    if (ext !== ".kss") {
      res.status(400).json({
        error: `File type "${ext || "unknown"}" is not allowed. Upload a KISS (.kss) file.`,
      });
      return;
    }
    let parsed: ParsedBom;
    try {
      parsed = parseKissFile(req.file.buffer.toString("utf8"));
    } catch (err) {
      if (err instanceof KissParseError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    // Aggregate distinct materials and match against the shared catalog.
    const matMap = new Map<
      string,
      {
        profileType: string | null;
        profileSize: string | null;
        grade: string | null;
        pieces: number;
        totalLengthIn: number | null;
      }
    >();
    for (const a of parsed.assemblies) {
      for (const p of a.parts) {
        const key = materialKey(p.profileType, p.profileSize, p.grade);
        const entry = matMap.get(key) ?? {
          profileType: p.profileType,
          profileSize: p.profileSize,
          grade: p.grade,
          pieces: 0,
          totalLengthIn: null as number | null,
        };
        const pieces = p.quantity * a.quantity;
        entry.pieces += pieces;
        if (p.lengthIn !== null) {
          entry.totalLengthIn = round2((entry.totalLengthIn ?? 0) + p.lengthIn * pieces);
        }
        matMap.set(key, entry);
      }
    }
    const entries = [...matMap.entries()];
    const matches = await matchCatalog(entries.map(([, v]) => v));
    const materials = entries.map(([key, v], i) => {
      const m = matches[i];
      return {
        key,
        profileType: v.profileType,
        profileSize: v.profileSize,
        grade: v.grade,
        pieces: v.pieces,
        totalLengthIn: v.totalLengthIn,
        matched: m != null && m.unitPrice != null,
        catalogItemId: m?.id ?? null,
        catalogUnitPrice: m?.unitPrice ?? null,
        catalogPriceUnit: m?.priceUnit ?? null,
      };
    });
    const unmatchedCount = materials.filter((m) => !m.matched).length;

    // Reuse the shape of the job BOM preview for the parsed content.
    const assemblies = parsed.assemblies.map((a) => ({
      mark: a.mark,
      quantity: a.quantity,
      description: a.description,
      finish: a.finish,
      processingPath: null,
      currentStage: null,
      onHold: false,
      notes: null,
      inspectedOn: null,
      station: null,
      inspector: null,
      parts: a.parts.map((p) => ({ ...p, heatNumber: null })),
    }));
    let partCount = 0;
    let totalPieces = 0;
    for (const a of parsed.assemblies)
      for (const p of a.parts) {
        partCount += 1;
        totalPieces += p.quantity * a.quantity;
      }
    res.json({
      bom: {
        jobRef: parsed.jobRef,
        jobName: parsed.jobName,
        assemblyCount: assemblies.length,
        partCount,
        totalPieces,
        assemblies,
        totals: materials.map((m) => ({
          profileType: m.profileType,
          profileSize: m.profileSize,
          grade: m.grade,
          pieces: m.pieces,
          totalLengthIn: m.totalLengthIn,
        })),
      },
      materials,
      unmatchedCount,
    });
  },
);

// ---------- KISS import: commit with mandatory resolutions ----------

router.post(
  "/estimates/:estimateId/bom/import",
  requireAuth,
  async (req, res): Promise<void> => {
    const estimateId = parseIntParam(req.params.estimateId);
    if (estimateId === null) {
      res.status(400).json({ error: "Invalid estimate id" });
      return;
    }
    const estimate = await loadEstimate(estimateId, req.auth!.companyId);
    if (!estimate) {
      res.status(404).json({ error: "Estimate not found" });
      return;
    }
    const parsedBody = CommitEstimateBomImportBody.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        error: parsedBody.error.issues[0]?.message ?? "Invalid input",
      });
      return;
    }
    const { assemblies, resolutions } = parsedBody.data;
    if (assemblies.length === 0) {
      res.status(400).json({ error: "No assemblies to import" });
      return;
    }

    const resByKey = new Map(resolutions.map((r) => [r.key, r]));

    // Every distinct material must carry an explicit resolution — never guess.
    const missing: string[] = [];
    const keys = new Set<string>();
    for (const a of assemblies) {
      for (const p of a.parts) {
        keys.add(materialKey(p.profileType ?? null, p.profileSize ?? null, p.grade ?? null));
      }
    }
    for (const key of keys) {
      const r = resByKey.get(key);
      if (!r) {
        missing.push(key);
        continue;
      }
      if (r.action === "match" && r.catalogItemId == null) missing.push(key);
      if (r.action === "manual" && r.manualUnitPrice == null) missing.push(key);
    }
    if (missing.length > 0) {
      res.status(400).json({
        error: `Unresolved materials: ${missing
          .map((k) => k.split("|").filter(Boolean).join(" ") || "(unspecified)")
          .join(", ")}. Every material must be matched to the catalog, marked for quote, or given a manual price before the BOM is committed.`,
      });
      return;
    }

    // Validate + snapshot catalog prices for "match" resolutions.
    const catalogIds = resolutions
      .filter((r) => r.action === "match" && r.catalogItemId != null)
      .map((r) => r.catalogItemId as number);
    const catalogRows = catalogIds.length
      ? await db
          .select()
          .from(materialCatalogTable)
          .where(inArray(materialCatalogTable.id, catalogIds))
      : [];
    const catalogById = new Map(catalogRows.map((c) => [c.id, c]));
    for (const r of resolutions) {
      if (r.action === "match" && !catalogById.get(r.catalogItemId as number)) {
        res.status(400).json({ error: `Catalog item ${r.catalogItemId} not found` });
        return;
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(estimateBomAssembliesTable)
        .where(eq(estimateBomAssembliesTable.estimateId, estimateId));
      for (let i = 0; i < assemblies.length; i++) {
        const a = assemblies[i];
        const [asm] = await tx
          .insert(estimateBomAssembliesTable)
          .values({
            estimateId,
            mark: a.mark,
            quantity: a.quantity,
            description: a.description ?? null,
            finish: a.finish ?? null,
            sortIndex: i,
          })
          .returning();
        if (a.parts.length === 0) continue;
        await tx.insert(estimateBomPartsTable).values(
          a.parts.map((p, j) => {
            const key = materialKey(
              p.profileType ?? null,
              p.profileSize ?? null,
              p.grade ?? null,
            );
            const r = resByKey.get(key)!;
            const cat =
              r.action === "match"
                ? catalogById.get(r.catalogItemId as number)!
                : null;
            return {
              assemblyId: asm.id,
              partMark: p.partMark ?? null,
              quantity: p.quantity,
              profileType: p.profileType ?? null,
              profileSize: p.profileSize ?? null,
              grade: p.grade ?? null,
              lengthIn: p.lengthIn ?? null,
              description: p.description ?? null,
              sortIndex: j,
              pricingStatus:
                r.action === "match"
                  ? "matched"
                  : r.action === "manual"
                    ? "manual"
                    : "needs_quote",
              catalogItemId: cat?.id ?? null,
              catalogUnitPrice: cat?.unitPrice ?? null,
              catalogPriceUnit: cat?.priceUnit ?? null,
              quotedUnitPrice:
                r.action === "manual" ? (r.manualUnitPrice ?? null) : null,
              quotedPriceUnit:
                r.action === "manual" ? (r.manualPriceUnit ?? "per_piece") : null,
              quoteSource: r.quoteSource ?? null,
              isMisc: r.isMisc ?? false,
            };
          }),
        );
      }
    });

    req.log.info(
      { estimateId, assemblies: assemblies.length },
      "Estimate BOM imported from reviewed KISS data",
    );
    res.status(201).json(await buildEstimateBomView(estimateId));
  },
);

// ---------- Manual BOM editing ----------

router.post(
  "/estimates/:estimateId/bom/assemblies",
  requireAuth,
  async (req, res): Promise<void> => {
    const estimateId = parseIntParam(req.params.estimateId);
    if (estimateId === null) {
      res.status(400).json({ error: "Invalid estimate id" });
      return;
    }
    const estimate = await loadEstimate(estimateId, req.auth!.companyId);
    if (!estimate) {
      res.status(404).json({ error: "Estimate not found" });
      return;
    }
    const parsed = CreateEstimateBomAssemblyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }
    const [{ maxSort }] = await db
      .select({ maxSort: sql<number>`coalesce(max(${estimateBomAssembliesTable.sortIndex}), -1)` })
      .from(estimateBomAssembliesTable)
      .where(eq(estimateBomAssembliesTable.estimateId, estimateId));
    const [asm] = await db
      .insert(estimateBomAssembliesTable)
      .values({
        estimateId,
        mark: parsed.data.mark,
        quantity: parsed.data.quantity ?? 1,
        description: parsed.data.description ?? null,
        finish: parsed.data.finish ?? null,
        sortIndex: maxSort + 1,
      })
      .returning();
    res.status(201).json(assemblyToView(asm, []));
  },
);

async function loadOwnedAssembly(assemblyId: number, companyId: number) {
  const rows = await db
    .select({ asm: estimateBomAssembliesTable })
    .from(estimateBomAssembliesTable)
    .innerJoin(
      estimatesTable,
      eq(estimateBomAssembliesTable.estimateId, estimatesTable.id),
    )
    .where(
      and(
        eq(estimateBomAssembliesTable.id, assemblyId),
        eq(estimatesTable.companyId, companyId),
      ),
    );
  return rows[0]?.asm ?? null;
}

async function loadOwnedPart(partId: number, companyId: number) {
  const rows = await db
    .select({ part: estimateBomPartsTable, asm: estimateBomAssembliesTable })
    .from(estimateBomPartsTable)
    .innerJoin(
      estimateBomAssembliesTable,
      eq(estimateBomPartsTable.assemblyId, estimateBomAssembliesTable.id),
    )
    .innerJoin(
      estimatesTable,
      eq(estimateBomAssembliesTable.estimateId, estimatesTable.id),
    )
    .where(
      and(
        eq(estimateBomPartsTable.id, partId),
        eq(estimatesTable.companyId, companyId),
      ),
    );
  return rows[0] ?? null;
}

router.patch(
  "/estimate-bom/assemblies/:assemblyId",
  requireAuth,
  async (req, res): Promise<void> => {
    const assemblyId = parseIntParam(req.params.assemblyId);
    if (assemblyId === null) {
      res.status(400).json({ error: "Invalid assembly id" });
      return;
    }
    const asm = await loadOwnedAssembly(assemblyId, req.auth!.companyId);
    if (!asm) {
      res.status(404).json({ error: "Assembly not found" });
      return;
    }
    const parsed = UpdateEstimateBomAssemblyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }
    const body = parsed.data;
    if (body.quantity !== undefined && body.quantity < 1) {
      res.status(400).json({ error: "Quantity must be at least 1" });
      return;
    }
    const updates: Partial<typeof estimateBomAssembliesTable.$inferInsert> = {};
    if (body.mark !== undefined) updates.mark = body.mark;
    if (body.quantity !== undefined) updates.quantity = body.quantity;
    if (body.description !== undefined) updates.description = body.description;
    if (body.finish !== undefined) updates.finish = body.finish;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    const [updated] = await db
      .update(estimateBomAssembliesTable)
      .set(updates)
      .where(eq(estimateBomAssembliesTable.id, assemblyId))
      .returning();
    const parts = await db
      .select()
      .from(estimateBomPartsTable)
      .where(eq(estimateBomPartsTable.assemblyId, assemblyId))
      .orderBy(asc(estimateBomPartsTable.sortIndex));
    res.json(assemblyToView(updated, parts));
  },
);

router.delete(
  "/estimate-bom/assemblies/:assemblyId",
  requireAuth,
  async (req, res): Promise<void> => {
    const assemblyId = parseIntParam(req.params.assemblyId);
    if (assemblyId === null) {
      res.status(400).json({ error: "Invalid assembly id" });
      return;
    }
    const asm = await loadOwnedAssembly(assemblyId, req.auth!.companyId);
    if (!asm) {
      res.status(404).json({ error: "Assembly not found" });
      return;
    }
    await db
      .delete(estimateBomAssembliesTable)
      .where(eq(estimateBomAssembliesTable.id, assemblyId));
    res.status(204).send();
  },
);

router.post(
  "/estimate-bom/assemblies/:assemblyId/parts",
  requireAuth,
  async (req, res): Promise<void> => {
    const assemblyId = parseIntParam(req.params.assemblyId);
    if (assemblyId === null) {
      res.status(400).json({ error: "Invalid assembly id" });
      return;
    }
    const asm = await loadOwnedAssembly(assemblyId, req.auth!.companyId);
    if (!asm) {
      res.status(404).json({ error: "Assembly not found" });
      return;
    }
    const parsed = CreateEstimateBomPartBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }
    const body = parsed.data;
    // Auto-match a fully-specified material against the catalog; anything
    // else starts as needs_quote — never silently guessed.
    const [match] = await matchCatalog([
      {
        profileType: body.profileType ?? null,
        profileSize: body.profileSize ?? null,
        grade: body.grade ?? null,
      },
    ]);
    const [{ maxSort }] = await db
      .select({ maxSort: sql<number>`coalesce(max(${estimateBomPartsTable.sortIndex}), -1)` })
      .from(estimateBomPartsTable)
      .where(eq(estimateBomPartsTable.assemblyId, assemblyId));
    const [part] = await db
      .insert(estimateBomPartsTable)
      .values({
        assemblyId,
        partMark: body.partMark ?? null,
        quantity: body.quantity,
        profileType: body.profileType ?? null,
        profileSize: body.profileSize ?? null,
        grade: body.grade ?? null,
        lengthIn: body.lengthIn ?? null,
        description: body.description ?? null,
        isMisc: body.isMisc ?? false,
        sortIndex: maxSort + 1,
        pricingStatus: match && match.unitPrice != null ? "matched" : "needs_quote",
        catalogItemId: match?.id ?? null,
        catalogUnitPrice: match?.unitPrice ?? null,
        catalogPriceUnit: match?.priceUnit ?? null,
      })
      .returning();
    res.status(201).json(partToView(part, asm.quantity));
  },
);

router.patch(
  "/estimate-bom/parts/:partId",
  requireAuth,
  async (req, res): Promise<void> => {
    const partId = parseIntParam(req.params.partId);
    if (partId === null) {
      res.status(400).json({ error: "Invalid part id" });
      return;
    }
    const owned = await loadOwnedPart(partId, req.auth!.companyId);
    if (!owned) {
      res.status(404).json({ error: "Part not found" });
      return;
    }
    const parsed = UpdateEstimateBomPartBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }
    const body = parsed.data;
    if (body.quantity !== undefined && body.quantity < 1) {
      res.status(400).json({ error: "Quantity must be at least 1" });
      return;
    }
    const updates: Partial<typeof estimateBomPartsTable.$inferInsert> = {};
    if (body.partMark !== undefined) updates.partMark = body.partMark;
    if (body.quantity !== undefined) updates.quantity = body.quantity;
    if (body.profileType !== undefined) updates.profileType = body.profileType;
    if (body.profileSize !== undefined) updates.profileSize = body.profileSize;
    if (body.grade !== undefined) updates.grade = body.grade;
    if (body.lengthIn !== undefined) updates.lengthIn = body.lengthIn;
    if (body.description !== undefined) updates.description = body.description;
    if (body.isMisc !== undefined) updates.isMisc = body.isMisc;
    if (body.quotedUnitPrice !== undefined) updates.quotedUnitPrice = body.quotedUnitPrice;
    if (body.quotedPriceUnit !== undefined) updates.quotedPriceUnit = body.quotedPriceUnit;
    if (body.quoteSource !== undefined) updates.quoteSource = body.quoteSource;
    if (body.pricingStatus !== undefined) {
      updates.pricingStatus = body.pricingStatus;
      if (body.pricingStatus === "matched") {
        const catalogItemId = body.catalogItemId ?? owned.part.catalogItemId;
        if (catalogItemId == null) {
          res.status(400).json({ error: "catalogItemId is required to mark a part as matched" });
          return;
        }
        const [cat] = await db
          .select()
          .from(materialCatalogTable)
          .where(eq(materialCatalogTable.id, catalogItemId));
        if (!cat) {
          res.status(400).json({ error: `Catalog item ${catalogItemId} not found` });
          return;
        }
        updates.catalogItemId = cat.id;
        updates.catalogUnitPrice = cat.unitPrice;
        updates.catalogPriceUnit = cat.priceUnit;
      }
    } else if (body.catalogItemId !== undefined) {
      if (body.catalogItemId === null) {
        updates.catalogItemId = null;
        updates.catalogUnitPrice = null;
        updates.catalogPriceUnit = null;
      } else {
        const [cat] = await db
          .select()
          .from(materialCatalogTable)
          .where(eq(materialCatalogTable.id, body.catalogItemId));
        if (!cat) {
          res.status(400).json({ error: `Catalog item ${body.catalogItemId} not found` });
          return;
        }
        updates.catalogItemId = cat.id;
        updates.catalogUnitPrice = cat.unitPrice;
        updates.catalogPriceUnit = cat.priceUnit;
        updates.pricingStatus = "matched";
      }
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    const [updated] = await db
      .update(estimateBomPartsTable)
      .set(updates)
      .where(eq(estimateBomPartsTable.id, partId))
      .returning();
    res.json(partToView(updated, owned.asm.quantity));
  },
);

router.delete(
  "/estimate-bom/parts/:partId",
  requireAuth,
  async (req, res): Promise<void> => {
    const partId = parseIntParam(req.params.partId);
    if (partId === null) {
      res.status(400).json({ error: "Invalid part id" });
      return;
    }
    const owned = await loadOwnedPart(partId, req.auth!.companyId);
    if (!owned) {
      res.status(404).json({ error: "Part not found" });
      return;
    }
    await db.delete(estimateBomPartsTable).where(eq(estimateBomPartsTable.id, partId));
    res.status(204).send();
  },
);

// ---------- RFQ export ----------

export async function buildRfqItems(estimateId: number) {
  const { asmRows, partsByAsm } = await loadEstimateBom(estimateId);
  const map = new Map<
    string,
    {
      profileType: string | null;
      profileSize: string | null;
      grade: string | null;
      description: string | null;
      pieces: number;
      totalLengthIn: number | null;
      isMisc: boolean;
      quoteSource: string | null;
    }
  >();
  for (const a of asmRows) {
    for (const p of partsByAsm.get(a.id) ?? []) {
      // RFQ list = needs-quote materials plus ALL misc/hardware items —
      // misc items are never filtered out of the export.
      if (p.pricingStatus !== "needs_quote" && !p.isMisc) continue;
      const key = `${materialKey(p.profileType, p.profileSize, p.grade)}|${p.isMisc ? "misc" : ""}|${p.description ?? ""}`;
      const entry = map.get(key) ?? {
        profileType: p.profileType,
        profileSize: p.profileSize,
        grade: p.grade,
        description: p.description,
        pieces: 0,
        totalLengthIn: null as number | null,
        isMisc: p.isMisc,
        quoteSource: p.quoteSource,
      };
      const pieces = p.quantity * a.quantity;
      entry.pieces += pieces;
      if (p.lengthIn !== null) {
        entry.totalLengthIn = round2((entry.totalLengthIn ?? 0) + p.lengthIn * pieces);
      }
      map.set(key, entry);
    }
  }
  return [...map.values()].sort(
    (x, y) =>
      Number(x.isMisc) - Number(y.isMisc) ||
      (x.profileType ?? "").localeCompare(y.profileType ?? ""),
  );
}

router.get(
  "/estimates/:estimateId/rfq",
  requireAuth,
  async (req, res): Promise<void> => {
    const estimateId = parseIntParam(req.params.estimateId);
    if (estimateId === null) {
      res.status(400).json({ error: "Invalid estimate id" });
      return;
    }
    const estimate = await loadEstimate(estimateId, req.auth!.companyId);
    if (!estimate) {
      res.status(404).json({ error: "Estimate not found" });
      return;
    }
    res.json(await buildRfqItems(estimateId));
  },
);

router.get(
  "/estimates/:estimateId/rfq.csv",
  requireAuth,
  async (req, res): Promise<void> => {
    const estimateId = parseIntParam(req.params.estimateId);
    if (estimateId === null) {
      res.status(400).json({ error: "Invalid estimate id" });
      return;
    }
    const estimate = await loadEstimate(estimateId, req.auth!.companyId);
    if (!estimate) {
      res.status(404).json({ error: "Estimate not found" });
      return;
    }
    const items = await buildRfqItems(estimateId);
    const esc = (v: string | number | null) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      "Profile Type,Profile Size,Grade,Description,Pieces,Total Length (in),Total Length (ft),Misc/Hardware",
      ...items.map((i) =>
        [
          esc(i.profileType),
          esc(i.profileSize),
          esc(i.grade),
          esc(i.description),
          i.pieces,
          i.totalLengthIn ?? "",
          i.totalLengthIn != null ? round2(i.totalLengthIn / 12) : "",
          i.isMisc ? "yes" : "no",
        ].join(","),
      ),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="rfq-${estimate.bidNumber.replace(/[^A-Za-z0-9-]/g, "_")}.csv"`,
    );
    res.send(lines.join("\n") + "\n");
  },
);

// ---------- Labor lines ----------

function laborToView(l: typeof estimateLaborLinesTable.$inferSelect) {
  return {
    id: l.id,
    trade: l.trade,
    hours: l.hours,
    hourlyRate: l.hourlyRate,
    cost: round2(l.hours * l.hourlyRate),
    notes: l.notes,
    sortIndex: l.sortIndex,
  };
}

router.get(
  "/estimates/:estimateId/labor-lines",
  requireAuth,
  async (req, res): Promise<void> => {
    const estimateId = parseIntParam(req.params.estimateId);
    if (estimateId === null) {
      res.status(400).json({ error: "Invalid estimate id" });
      return;
    }
    const estimate = await loadEstimate(estimateId, req.auth!.companyId);
    if (!estimate) {
      res.status(404).json({ error: "Estimate not found" });
      return;
    }
    const rows = await db
      .select()
      .from(estimateLaborLinesTable)
      .where(eq(estimateLaborLinesTable.estimateId, estimateId))
      .orderBy(asc(estimateLaborLinesTable.sortIndex));
    res.json(rows.map(laborToView));
  },
);

router.post(
  "/estimates/:estimateId/labor-lines",
  requireAuth,
  async (req, res): Promise<void> => {
    const estimateId = parseIntParam(req.params.estimateId);
    if (estimateId === null) {
      res.status(400).json({ error: "Invalid estimate id" });
      return;
    }
    const estimate = await loadEstimate(estimateId, req.auth!.companyId);
    if (!estimate) {
      res.status(404).json({ error: "Estimate not found" });
      return;
    }
    const parsed = CreateEstimateLaborLineBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }
    const body = parsed.data;
    let hourlyRate = body.hourlyRate ?? null;
    if (hourlyRate == null) {
      // Default from the company's configured rate for this trade.
      const [rate] = await db
        .select()
        .from(laborRatesTable)
        .where(
          and(
            eq(laborRatesTable.companyId, req.auth!.companyId),
            sql`lower(${laborRatesTable.trade}) = lower(${body.trade})`,
          ),
        );
      hourlyRate = rate?.hourlyRate ?? 0;
    }
    const [{ maxSort }] = await db
      .select({ maxSort: sql<number>`coalesce(max(${estimateLaborLinesTable.sortIndex}), -1)` })
      .from(estimateLaborLinesTable)
      .where(eq(estimateLaborLinesTable.estimateId, estimateId));
    const [line] = await db
      .insert(estimateLaborLinesTable)
      .values({
        estimateId,
        trade: body.trade,
        hours: body.hours,
        hourlyRate,
        notes: body.notes ?? null,
        sortIndex: maxSort + 1,
      })
      .returning();
    res.status(201).json(laborToView(line));
  },
);

async function loadOwnedLaborLine(lineId: number, companyId: number) {
  const rows = await db
    .select({ line: estimateLaborLinesTable })
    .from(estimateLaborLinesTable)
    .innerJoin(
      estimatesTable,
      eq(estimateLaborLinesTable.estimateId, estimatesTable.id),
    )
    .where(
      and(
        eq(estimateLaborLinesTable.id, lineId),
        eq(estimatesTable.companyId, companyId),
      ),
    );
  return rows[0]?.line ?? null;
}

router.patch(
  "/estimate-labor-lines/:lineId",
  requireAuth,
  async (req, res): Promise<void> => {
    const lineId = parseIntParam(req.params.lineId);
    if (lineId === null) {
      res.status(400).json({ error: "Invalid line id" });
      return;
    }
    const line = await loadOwnedLaborLine(lineId, req.auth!.companyId);
    if (!line) {
      res.status(404).json({ error: "Labor line not found" });
      return;
    }
    const parsed = UpdateEstimateLaborLineBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }
    const body = parsed.data;
    const updates: Partial<typeof estimateLaborLinesTable.$inferInsert> = {};
    if (body.trade !== undefined) updates.trade = body.trade;
    if (body.hours !== undefined) updates.hours = body.hours;
    if (body.hourlyRate !== undefined) updates.hourlyRate = body.hourlyRate;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    const [updated] = await db
      .update(estimateLaborLinesTable)
      .set(updates)
      .where(eq(estimateLaborLinesTable.id, lineId))
      .returning();
    res.json(laborToView(updated));
  },
);

router.delete(
  "/estimate-labor-lines/:lineId",
  requireAuth,
  async (req, res): Promise<void> => {
    const lineId = parseIntParam(req.params.lineId);
    if (lineId === null) {
      res.status(400).json({ error: "Invalid line id" });
      return;
    }
    const line = await loadOwnedLaborLine(lineId, req.auth!.companyId);
    if (!line) {
      res.status(404).json({ error: "Labor line not found" });
      return;
    }
    await db
      .delete(estimateLaborLinesTable)
      .where(eq(estimateLaborLinesTable.id, lineId));
    res.status(204).send();
  },
);

// ---------- Pricing rollup ----------

export async function buildPricingSummary(estimate: EstimateRow) {
  const bom = await buildEstimateBomView(estimate.id);
  const labor = await db
    .select()
    .from(estimateLaborLinesTable)
    .where(eq(estimateLaborLinesTable.estimateId, estimate.id));
  const laborCost = round2(
    labor.reduce((sum, l) => sum + l.hours * l.hourlyRate, 0),
  );
  const subtotal = round2(bom.materialCost + laborCost);
  const marginAmount = round2(subtotal * (estimate.marginPercent / 100));
  return {
    materialCost: bom.materialCost,
    laborCost,
    subtotal,
    marginPercent: estimate.marginPercent,
    marginAmount,
    total: round2(subtotal + marginAmount),
    needsQuoteCount: bom.needsQuoteCount,
  };
}

router.get(
  "/estimates/:estimateId/pricing",
  requireAuth,
  async (req, res): Promise<void> => {
    const estimateId = parseIntParam(req.params.estimateId);
    if (estimateId === null) {
      res.status(400).json({ error: "Invalid estimate id" });
      return;
    }
    const estimate = await loadEstimate(estimateId, req.auth!.companyId);
    if (!estimate) {
      res.status(404).json({ error: "Estimate not found" });
      return;
    }
    res.json(await buildPricingSummary(estimate));
  },
);

export default router;
