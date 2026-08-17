import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { getApiUrl } from "@/lib/api";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  superAdmin: boolean;
  companyId: number;
  companyName: string;
  companySlug: string;
  roles: string[];
  companies?: { id: number; name: string; slug: string }[];
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  switchCompany: (companyId: number) => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchAuthDto(url: string, opts?: RequestInit): Promise<AuthUser | null> {
  const res = await fetch(url, { credentials: "include", ...opts });
  if (!res.ok) return null;
  const data = await res.json();
  // Validate the shape — must have companyId and companyName
  if (!data || typeof data.id !== "number" || typeof data.companyId !== "number") return null;
  return data as AuthUser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const dto = await fetchAuthDto(getApiUrl("auth/me"));
    setUser(dto);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(getApiUrl("auth/login"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Login failed" }));
      throw new Error(err.error ?? "Login failed");
    }
    const data = await res.json();
    if (!data || typeof data.id !== "number" || typeof data.companyId !== "number") {
      throw new Error("Invalid server response");
    }
    setUser(data as AuthUser);
  }, []);

  const logout = useCallback(async () => {
    await fetch(getApiUrl("auth/logout"), {
      method: "POST",
      credentials: "include",
    });
    setUser(null);
  }, []);

  const switchCompany = useCallback(async (companyId: number) => {
    const res = await fetch(getApiUrl("auth/switch-company"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Switch failed" }));
      throw new Error(err.error ?? "Switch failed");
    }
    const data = await res.json();
    if (!data || typeof data.id !== "number" || typeof data.companyId !== "number") {
      throw new Error("Invalid server response");
    }
    setUser(data as AuthUser);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, switchCompany, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
