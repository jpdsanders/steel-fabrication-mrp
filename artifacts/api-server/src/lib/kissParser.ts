/**
 * Parser for KISS (Keep It Simple Steel) bill-of-materials exports
 * (Tekla Structures and similar detailing tools).
 *
 * Format: comma-delimited records, one per line.
 *  - "KISS,<version>,<source>" optional signature line
 *  - H,<jobRef>,<jobName>,...            header
 *  - *                                    assembly separator
 *  - D,<asmMark>,<asmQty>,<mainMark>,<partMark>,<qty>,<type>,<size>,<grade>,<length>,<finish>,<remark>
 *    (a D row whose part mark equals the assembly mark starts a new assembly)
 *
 * The KISS length column is in millimeters (Tekla export convention); the
 * parser converts it to inches, which is the unit stored and displayed
 * throughout the app.
 *  - L,... labor operations (welds/cuts/holes) — ignored
 *  - S,... sequence info — ignored
 */

export interface ParsedBomPart {
  partMark: string | null;
  quantity: number;
  profileType: string | null;
  profileSize: string | null;
  grade: string | null;
  lengthIn: number | null;
  description: string | null;
}

export interface ParsedBomAssembly {
  mark: string;
  quantity: number;
  description: string | null;
  finish: string | null;
  parts: ParsedBomPart[];
}

export interface ParsedBom {
  jobRef: string | null;
  jobName: string | null;
  assemblies: ParsedBomAssembly[];
}

export class KissParseError extends Error {}

function field(cols: string[], i: number): string | null {
  const v = (cols[i] ?? "").trim();
  return v === "" ? null : v;
}

function num(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseKissFile(content: string): ParsedBom {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new KissParseError("File is empty.");
  }

  const hasSignature = lines[0].toUpperCase().startsWith("KISS,");
  const hasHeader = lines.some((l) => /^H,/i.test(l));
  const hasParts = lines.some((l) => /^D,/i.test(l));
  if (!hasParts || !(hasSignature || hasHeader)) {
    throw new KissParseError(
      "This does not look like a KISS bill-of-materials file. Expected a KISS/H header and D part records.",
    );
  }

  let jobRef: string | null = null;
  let jobName: string | null = null;
  const assemblies: ParsedBomAssembly[] = [];
  let current: ParsedBomAssembly | null = null;

  for (const line of lines) {
    const cols = line.split(",");
    const rec = cols[0].trim().toUpperCase();

    if (rec === "H") {
      jobRef = jobRef ?? field(cols, 1);
      jobName = jobName ?? field(cols, 2);
      continue;
    }
    if (rec === "D") {
      const asmMark = field(cols, 1);
      const asmQty = num(field(cols, 2)) ?? 1;
      const partMark = field(cols, 4);
      const qty = num(field(cols, 5)) ?? 1;
      const profileType = field(cols, 6);
      const profileSize = field(cols, 7);
      const grade = field(cols, 8);
      const lengthMm = num(field(cols, 9));
      // KISS lengths are millimeters; the app stores inches.
      const lengthIn =
        lengthMm === null ? null : Math.round((lengthMm / 25.4) * 100) / 100;
      const finish = field(cols, 10);
      const remark = field(cols, 11);

      if (asmMark === null) {
        throw new KissParseError(
          `Malformed D record (missing assembly mark): "${line}"`,
        );
      }

      const isAssemblyRow =
        partMark !== null && partMark.toUpperCase() === asmMark.toUpperCase();

      if (isAssemblyRow || current === null || current.mark !== asmMark) {
        // Start a new assembly (either an explicit assembly main row, or a
        // part row for an assembly we have not seen yet).
        current = {
          mark: asmMark,
          quantity: Math.max(1, Math.round(asmQty)),
          description: isAssemblyRow ? remark : null,
          finish: isAssemblyRow ? finish : null,
          parts: [],
        };
        assemblies.push(current);
        if (isAssemblyRow) continue;
      }

      current.parts.push({
        partMark,
        quantity: Math.max(1, Math.round(qty)),
        profileType,
        profileSize,
        grade,
        lengthIn,
        description: remark,
      });
      continue;
    }
    // KISS signature, *, L, S, and anything else: skipped.
  }

  if (assemblies.length === 0) {
    throw new KissParseError("No assemblies found in the KISS file.");
  }

  return { jobRef, jobName, assemblies };
}
