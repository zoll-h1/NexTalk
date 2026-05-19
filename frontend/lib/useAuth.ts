"use client";

import { useCallback, useEffect, useState } from "react";

import { apiRequest } from "./api";
import type { AccessTokenResponse, AuthResponse, User } from "./types";

const TOKEN_KEY = "nextalk.access-token";

export function useAuth() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      setLoading(false);
      return;
    }

    async function init() {
      try {
        const u = await apiRequest<User>("/auth/me", { accessToken: stored! });
        setToken(stored);
        setUser(u);
      } catch {
        // Token expired — try refresh via httpOnly cookie
        try {
          const r = await apiRequest<AccessTokenResponse>("/auth/refresh", { method: "POST" });
          localStorage.setItem(TOKEN_KEY, r.access_token);
          setToken(r.access_token);
          const u = await apiRequest<User>("/auth/me", { accessToken: r.access_token });
          setUser(u);
        } catch {
          localStorage.removeItem(TOKEN_KEY);
        }
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiRequest<AuthResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    localStorage.setItem(TOKEN_KEY, res.access_token);
    setToken(res.access_token);
    setUser(res.user);
    return res;
  }, []);

  const register = useCallback(async (username: string, email: string, password: string, display_name: string) => {
    const res = await apiRequest<AuthResponse>("/auth/register", {
      method: "POST",
      body: { username, email, password, display_name },
    });
    localStorage.setItem(TOKEN_KEY, res.access_token);
    setToken(res.access_token);
    setUser(res.user);
    return res;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest("/auth/logout", { method: "POST", accessToken: token ?? undefined });
    } catch {
      // ignore
    }
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, [token]);

  const updateUser = useCallback((nextUser: User) => {
    setUser(nextUser);
  }, []);

  return { token, user, loading, login, register, logout, updateUser };
}
