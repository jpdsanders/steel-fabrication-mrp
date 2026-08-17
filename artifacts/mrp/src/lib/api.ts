const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Build an absolute URL for the API server.
 * Usage: getApiUrl("auth/me") → "<base>/api/auth/me"
 */
export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `${BASE}/api/${cleanPath}`;
}
