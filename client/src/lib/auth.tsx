import { createContext, useContext, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "./queryClient";
import type { User } from "@shared/schema";

type AuthUser = Omit<User, "password">;

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

/** Clear client auth cache when the server says the session is gone. */
export function clearClientAuth() {
  queryClient.setQueryData(["/api/auth/user"], null);
  queryClient.removeQueries({ queryKey: ["/api/auth/user"] });
}

async function fetchAuthUser(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/user", { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(`auth check failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Confirm logout only after a second 401. During Amvera rebuilds the first
 * /api/auth/user hit can briefly look unauthenticated (or the tab reconnects
 * mid-restart); a single 401 must not wipe a still-valid cookie session.
 */
async function fetchAuthUserConfirmed(): Promise<AuthUser | null> {
  const first = await fetchAuthUser();
  if (first) return first;
  await new Promise((r) => setTimeout(r, 1200));
  return fetchAuthUser();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const hadUserRef = useRef(false);

  const { data: user, isPending, isFetching } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: async () => {
      // First paint: one request is enough. Later refetches (focus/reconnect/
      // deploy blip) require a confirmed 401 before we clear a known user.
      if (!hadUserRef.current) {
        const u = await fetchAuthUser();
        if (u) hadUserRef.current = true;
        return u;
      }
      const u = await fetchAuthUserConfirmed();
      if (u) hadUserRef.current = true;
      else hadUserRef.current = false;
      return u;
    },
    staleTime: 2 * 60 * 1000,
    // When user returns to the tab after idle, re-check the session cookie.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // Safety net while the tab stays open for a long time.
    refetchInterval: 10 * 60 * 1000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
    // Keep last known user while a transient check fails (not on confirmed 401).
    placeholderData: (prev) => prev,
  });

  if (user) hadUserRef.current = true;

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiRequest("POST", "/api/auth/login", { email, password });
    const userData = await res.json();
    hadUserRef.current = true;
    queryClient.setQueryData(["/api/auth/user"], userData);
  }, []);

  const register = useCallback(async (email: string, password: string, displayName: string) => {
    const res = await apiRequest("POST", "/api/auth/register", { email, password, displayName });
    const userData = await res.json();
    hadUserRef.current = true;
    queryClient.setQueryData(["/api/auth/user"], userData);
  }, []);

  const logout = useCallback(async () => {
    await apiRequest("POST", "/api/auth/logout");
    hadUserRef.current = false;
    clearClientAuth();
    queryClient.clear();
    try { localStorage.removeItem("craft_projects_cache"); } catch {}
  }, []);

  // Spinner while first check / retries run and we don't yet know the user.
  // Never flash "logged out" during a transient failure if we still have a user.
  const authLoading = (isPending || isFetching) && user == null;

  return (
    <AuthContext.Provider value={{ user: user ?? null, isLoading: authLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
