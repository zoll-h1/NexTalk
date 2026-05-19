"use client";

import { useState } from "react";

interface LoginScreenProps {
  onLogin: (email: string, password: string) => Promise<unknown>;
  onRegister: (username: string, email: string, password: string, displayName: string) => Promise<unknown>;
}

export function LoginScreen({ onLogin, onRegister }: LoginScreenProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "login") {
        await onLogin(email, password);
      } else {
        await onRegister(username, email, password, displayName);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-nc-bg">
      <div className="w-full max-w-sm bg-nc-surface rounded-2xl p-8 shadow-nc-glow border border-nc-border">
        {/* Logo */}
        <div className="flex items-center justify-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-nc-primary/10 border border-nc-primary/20 flex items-center justify-center shadow-nc-glow">
            <span className="text-nc-primary text-2xl font-bold">N</span>
          </div>
        </div>
        <h1 className="text-nc-text text-xl font-bold text-center mb-1">NexChat</h1>
        <p className="text-nc-muted text-sm text-center mb-6">
          {mode === "login" ? "Sign in to continue" : "Create your account"}
        </p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === "register" && (
            <input
              className="bg-nc-surface2 text-nc-text placeholder-nc-muted rounded-xl px-4 py-3 text-sm outline-none border border-transparent focus:border-nc-primary transition-colors"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          )}
          {mode === "register" && (
            <input
              className="bg-nc-surface2 text-nc-text placeholder-nc-muted rounded-xl px-4 py-3 text-sm outline-none border border-transparent focus:border-nc-primary transition-colors"
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
              required
            />
          )}
          <input
            className="bg-nc-surface2 text-nc-text placeholder-nc-muted rounded-xl px-4 py-3 text-sm outline-none border border-transparent focus:border-nc-primary transition-colors"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <input
            className="bg-nc-surface2 text-nc-text placeholder-nc-muted rounded-xl px-4 py-3 text-sm outline-none border border-transparent focus:border-nc-primary transition-colors"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
          />

          {error && <p className="text-red-400 text-xs text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 bg-nc-primary hover:bg-nc-primary/80 text-white rounded-xl py-3 text-sm font-semibold transition-colors shadow-nc-glow disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <p className="text-nc-muted text-xs text-center mt-5">
          {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
          <button
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
            }}
            className="text-nc-primary hover:underline"
          >
            {mode === "login" ? "Register" : "Sign In"}
          </button>
        </p>
      </div>
    </div>
  );
}
