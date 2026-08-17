export const money = (n: number | null | undefined) =>
  n == null
    ? "—"
    : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const num = (n: number | null | undefined, digits = 2) =>
  n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: digits });

/** Inches formatted as feet-inches, e.g. 246 → 20'-6". */
export const feetIn = (inches: number | null | undefined) => {
  if (inches == null) return "—";
  const ft = Math.floor(inches / 12);
  const rem = Math.round((inches - ft * 12) * 100) / 100;
  return `${ft}'-${rem}"`;
};

/** Escape a CSV cell. */
export const csv = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function downloadCsv(filename: string, lines: string[]) {
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
