/**
 * Imperial length helpers. Lengths are stored as inches everywhere;
 * they display as feet-and-inches, e.g. 12'-6 1/2".
 */

/** Format a length in inches as feet-and-inches, e.g. 150.5 → `12'-6 1/2"`. */
export function formatFeetInches(inches: number | null | undefined): string {
  if (inches === null || inches === undefined) return "—";
  const negative = inches < 0;
  // Round to nearest 1/16".
  let sixteenths = Math.round(Math.abs(inches) * 16);
  const feet = Math.floor(sixteenths / (12 * 16));
  sixteenths -= feet * 12 * 16;
  const wholeInches = Math.floor(sixteenths / 16);
  sixteenths -= wholeInches * 16;

  let frac = "";
  if (sixteenths > 0) {
    let num = sixteenths;
    let den = 16;
    while (num % 2 === 0) {
      num /= 2;
      den /= 2;
    }
    frac = ` ${num}/${den}`;
  }
  const sign = negative ? "-" : "";
  return `${sign}${feet.toLocaleString()}'-${wholeInches}${frac}"`;
}

/**
 * Parse a feet-and-inches string into inches. Accepts:
 *  - `12'-6 1/2"`, `12' 6"`, `12 ft 6 in`
 *  - `12'` (feet only), `6"` or `6 1/2"` (inches only)
 *  - a bare number, treated as inches (e.g. `150`)
 * Returns null for blank input; NaN for unparseable input.
 */
export function parseFeetInches(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;

  const s = text
    .toLowerCase()
    .replace(/feet|foot|ft\.?/g, "'")
    .replace(/inches|inch|in\.?/g, '"')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"');

  const m = s.match(
    /^\s*(?:(\d+(?:\.\d+)?)\s*')?\s*[-, ]*\s*(?:(\d+(?:\.\d+)?)(?:\s+(\d+)\s*\/\s*(\d+))?\s*"?|(\d+)\s*\/\s*(\d+)\s*"?)?\s*$/,
  );
  if (!m) return NaN;
  const [, ftStr, inStr, numStr, denStr, loneNumStr, loneDenStr] = m;
  if (!ftStr && !inStr && !loneNumStr) return NaN;

  let inches = 0;
  if (ftStr) inches += parseFloat(ftStr) * 12;
  if (inStr) {
    // A bare number with no feet part is plain inches.
    inches += parseFloat(inStr);
    if (numStr && denStr && Number(denStr) !== 0) {
      inches += Number(numStr) / Number(denStr);
    }
  } else if (loneNumStr && loneDenStr && Number(loneDenStr) !== 0) {
    inches += Number(loneNumStr) / Number(loneDenStr);
  }
  return inches;
}
