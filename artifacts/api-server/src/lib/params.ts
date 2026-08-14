/** Parse a required integer path/query param. Returns null if invalid. */
export function parseIntParam(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Parse a query-string boolean. Query values arrive as strings, so treat only
 * "true"/"1" as true and "false"/"0" as false. Generated `zod.coerce.boolean()`
 * treats any non-empty string (including "false") as true, which inverts intent.
 */
export function parseQueryBool(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) value = value[0];
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}
