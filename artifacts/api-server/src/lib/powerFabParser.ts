/**
 * Parser for Tekla PowerFab / FabSuiteDataExchange XML exports
 * (namespace http://www.fabsuite.com/XML_Schemas/TeklaPowerFabDataFile0109.xsd,
 * exported from Tekla Structures).
 *
 * Maps `ProjectData > ContractData > Assembly` / `AssemblyPart` rows into the
 * same ParsedBom shape the KISS parser produces so both feed the SAME
 * catalog-matching / needs_quote pipeline downstream — unmatched materials
 * are flagged, never guessed.
 *
 * Lengths carry a UOM attribute ("in" or "mm"); the app stores inches.
 */
import { XMLParser } from "fast-xml-parser";
import {
  KissParseError,
  type ParsedBom,
  type ParsedBomAssembly,
  type ParsedBomPart,
} from "./kissParser";

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "object") {
    // Element with attributes: value under #text
    const t = (v as Record<string, unknown>)["#text"];
    return t === undefined || t === null ? null : String(t).trim() || null;
  }
  const s = String(v).trim();
  return s === "" ? null : s;
}

function toNumber(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Length element: value + UOM attribute ("in" | "mm"). Returns inches. */
function lengthIn(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  let raw: string | null;
  let uom = "in";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    raw = text(o["#text"]);
    uom = String(o["@_UOM"] ?? "in").toLowerCase();
  } else {
    raw = text(v);
  }
  const n = toNumber(raw);
  if (n === null) return null;
  const inches = uom === "mm" ? n / 25.4 : n;
  return Math.round(inches * 100) / 100;
}

export function parsePowerFabXml(content: string): ParsedBom {
  if (!content.includes("FabSuiteDataExchange")) {
    throw new KissParseError(
      "This does not look like a Tekla PowerFab XML export (missing FabSuiteDataExchange root element).",
    );
  }

  let doc: Record<string, unknown>;
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      // Only parse the elements we need; keep everything as strings
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
    });
    doc = parser.parse(content);
  } catch {
    throw new KissParseError("The XML file could not be parsed (malformed XML).");
  }

  const root = doc["FabSuiteDataExchange"] as Record<string, unknown> | undefined;
  if (!root) {
    throw new KissParseError(
      "This does not look like a Tekla PowerFab XML export (missing FabSuiteDataExchange root element).",
    );
  }

  const projectData = root["ProjectData"] as Record<string, unknown> | undefined;
  const contracts = asArray(projectData?.["ContractData"] as unknown);

  let jobRef: string | null = null;
  let jobName: string | null = null;
  const assemblies: ParsedBomAssembly[] = [];

  for (const contractRaw of contracts) {
    const contract = contractRaw as Record<string, unknown>;
    const projectId = contract["ProjectId"] as Record<string, unknown> | undefined;
    jobRef = jobRef ?? text(projectId?.["ProjectNumber"]);
    jobName = jobName ?? text(projectId?.["ProjectName"]);

    // Assemblies live under ContractData > AssemblyData > Assembly (some
    // exports may place them directly under ContractData).
    const assemblyContainers = [
      ...asArray(contract["AssemblyData"] as unknown).flatMap((ad) =>
        asArray((ad as Record<string, unknown>)["Assembly"] as unknown),
      ),
      ...asArray(contract["Assembly"] as unknown),
    ];
    for (const asmRaw of assemblyContainers) {
      const asm = asmRaw as Record<string, unknown>;
      const mark = text(asm["AssemblyMark"]);
      if (!mark) continue;

      const parts: ParsedBomPart[] = [];
      let finish: string | null = null;
      for (const partRaw of asArray(asm["AssemblyPart"] as unknown)) {
        const part = partRaw as Record<string, unknown>;
        const isMain = text(part["MainMember"]) === "true";
        const partFinish = text(part["Finish"]);
        if (isMain && partFinish) finish = partFinish;
        parts.push({
          partMark: text(part["PartMark"]),
          quantity: Math.max(1, Math.round(toNumber(text(part["PartQuantity"])) ?? 1)),
          profileType: text(part["Shape"]),
          profileSize: text(part["Dimensions"]),
          grade: text(part["Grade"]),
          lengthIn: lengthIn(part["Length"]),
          description: text(part["Remark"]),
        });
      }

      assemblies.push({
        mark,
        quantity: Math.max(
          1,
          Math.round(toNumber(text(asm["AssemblyQuantity"])) ?? 1),
        ),
        description: text(asm["AssemblyName"]),
        finish: finish ?? text(asm["Finish"]),
        parts,
      });
    }
  }

  if (assemblies.length === 0) {
    throw new KissParseError(
      "No assemblies found in the PowerFab XML file (expected ProjectData > ContractData > Assembly records).",
    );
  }

  return { jobRef, jobName, assemblies };
}
