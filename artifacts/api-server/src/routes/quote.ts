import { Router, type IRouter } from "express";
import PDFDocument from "pdfkit";
import { db } from "@workspace/db";
import {
  estimatesTable,
  companiesTable,
  estimateLaborLinesTable,
} from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { parseIntParam } from "../lib/params";
import { requireAuth } from "../middlewares/auth";
import {
  buildEstimateBomView,
  buildPricingSummary,
} from "./estimateBom";

const router: IRouter = Router();

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Branded quote PDF. Format (itemized | summary) is a per-estimate setting
 * (estimates.quote_format), overridable with ?format= for preview.
 */
router.get(
  "/estimates/:estimateId/quote.pdf",
  requireAuth,
  async (req, res): Promise<void> => {
    const estimateId = parseIntParam(req.params.estimateId);
    if (estimateId === null) {
      res.status(400).json({ error: "Invalid estimate id" });
      return;
    }
    const companyId = req.auth!.companyId;
    const [estimate] = await db
      .select()
      .from(estimatesTable)
      .where(
        and(
          eq(estimatesTable.id, estimateId),
          eq(estimatesTable.companyId, companyId),
        ),
      );
    if (!estimate) {
      res.status(404).json({ error: "Estimate not found" });
      return;
    }
    const [company] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId));
    const queryFormat = typeof req.query.format === "string" ? req.query.format : null;
    const format =
      queryFormat === "itemized" || queryFormat === "summary"
        ? queryFormat
        : estimate.quoteFormat === "itemized"
          ? "itemized"
          : "summary";

    const bom = await buildEstimateBomView(estimateId);
    const labor = await db
      .select()
      .from(estimateLaborLinesTable)
      .where(eq(estimateLaborLinesTable.estimateId, estimateId))
      .orderBy(asc(estimateLaborLinesTable.sortIndex));
    const pricing = await buildPricingSummary(estimate);

    const primary = company?.primaryColor ?? "#1f2937";
    const doc = new PDFDocument({ size: "LETTER", margin: 54 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="quote-${estimate.bidNumber.replace(/[^A-Za-z0-9-]/g, "_")}.pdf"`,
    );
    doc.pipe(res);

    // ---- Branded header
    doc.rect(0, 0, doc.page.width, 90).fill(primary);
    doc
      .fill("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(20)
      .text(company?.name ?? "Quote", 54, 30);
    doc
      .font("Helvetica")
      .fontSize(11)
      .text(`Quotation ${estimate.bidNumber}`, 54, 58);
    doc
      .fontSize(10)
      .text(
        new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
        doc.page.width - 254,
        62,
        { width: 200, align: "right" },
      );
    doc.fill("#111111");
    doc.y = 116;
    doc.x = 54;

    // ---- Quote metadata
    doc.font("Helvetica-Bold").fontSize(12).text(estimate.name);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#444444")
      .text(`Prepared for: ${estimate.customer}`);
    if (estimate.dueDate) doc.text(`Requested by: ${estimate.dueDate}`);
    doc.fillColor("#111111").moveDown(1);

    const tableLeft = 54;
    const tableRight = doc.page.width - 54;

    function hr() {
      doc
        .moveTo(tableLeft, doc.y)
        .lineTo(tableRight, doc.y)
        .strokeColor("#dddddd")
        .lineWidth(0.7)
        .stroke();
      doc.moveDown(0.35);
    }

    function row(label: string, value: string, bold = false) {
      const y = doc.y;
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(10)
        .text(label, tableLeft, y, { width: tableRight - tableLeft - 110 });
      doc.text(value, tableRight - 110, y, { width: 110, align: "right" });
      doc.moveDown(0.25);
    }

    if (format === "itemized") {
      // ---- Itemized: material lines then labor lines
      doc.font("Helvetica-Bold").fontSize(12).text("Materials", tableLeft);
      doc.moveDown(0.4);
      hr();
      for (const asm of bom.assemblies) {
        for (const part of asm.parts) {
          const desc = [
            part.profileType,
            part.profileSize,
            part.grade,
            part.lengthIn != null ? `${part.lengthIn}"` : null,
          ]
            .filter(Boolean)
            .join(" ");
          const label = `${asm.mark}${part.partMark ? `/${part.partMark}` : ""} — ${desc || part.description || "Item"} × ${part.quantity * asm.quantity}`;
          row(label, part.lineCost != null ? money(part.lineCost) : "TBD");
          if (doc.y > doc.page.height - 140) doc.addPage();
        }
      }
      hr();
      row("Material subtotal", money(pricing.materialCost), true);
      doc.moveDown(0.8);

      doc.font("Helvetica-Bold").fontSize(12).text("Labor", tableLeft);
      doc.moveDown(0.4);
      hr();
      for (const l of labor) {
        row(
          `${l.trade} — ${l.hours} hrs @ ${money(l.hourlyRate)}/hr`,
          money(Math.round(l.hours * l.hourlyRate * 100) / 100),
        );
        if (doc.y > doc.page.height - 140) doc.addPage();
      }
      hr();
      row("Labor subtotal", money(pricing.laborCost), true);
    } else {
      // ---- Summary: material / fabrication / other + terms
      doc.font("Helvetica-Bold").fontSize(12).text("Summary", tableLeft);
      doc.moveDown(0.4);
      hr();
      row("Material", money(pricing.materialCost));
      row("Fabrication & labor", money(pricing.laborCost));
      hr();
    }

    doc.moveDown(0.8);
    row("Subtotal", money(pricing.subtotal), true);
    row(`Margin (${pricing.marginPercent}%)`, money(pricing.marginAmount));
    doc.moveDown(0.2);
    const y = doc.y;
    doc
      .rect(tableRight - 220, y - 4, 220, 26)
      .fill(primary);
    doc
      .fill("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Total", tableRight - 210, y + 2);
    doc.text(money(pricing.total), tableRight - 120, y + 2, {
      width: 110,
      align: "right",
    });
    doc.fill("#111111");
    doc.moveDown(2);
    doc.x = tableLeft;

    if (pricing.needsQuoteCount > 0) {
      doc
        .font("Helvetica-Oblique")
        .fontSize(9)
        .fillColor("#b45309")
        .text(
          `Note: ${pricing.needsQuoteCount} material line(s) are pending vendor quotes and are not included in the total.`,
        );
      doc.fillColor("#111111");
    }

    doc.moveDown(1);
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .text("Terms");
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#444444")
      .text(
        estimate.notes?.trim()
          ? estimate.notes
          : "Pricing valid for 30 days. Subject to review of final construction documents.",
        { width: tableRight - tableLeft },
      );

    doc.end();
  },
);

export default router;
