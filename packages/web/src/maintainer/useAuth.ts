import { useCallback, useEffect, useState } from "react";

export interface AuthUser {
  login: string;
  avatarUrl: string;
}

export interface AuthState {
  /** Whether this server has GitHub sign-in configured at all. */
  isEnabled: boolean;
  user: AuthUser | null;
  isLoading: boolean;
  /** A sign-in error GitHub's redirect brought back (?auth_error=…). */
  error: string | null;
  signOut: () => Promise<void>;
}

/** Who is signed in. The GitHub token never reaches the browser; only login and avatar do. */
export function useAuth(): AuthState {
  const [state, setState] = useState<{ isEnabled: boolean; user: AuthUser | null; isLoading: boolean }>({
    isEnabled: false,
    user: null,
    isLoading: true,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Read and clear ?auth_error so a reload doesn't show it again.
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("auth_error");
    if (authError) {
      setError(authError);
      params.delete("auth_error");
      const rest = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
    }
    fetch("/api/auth/me")
      .then((r) => r.json() as Promise<{ enabled: boolean; user: AuthUser | null }>)
      .then((me) => setState({ isEnabled: me.enabled, user: me.user, isLoading: false }))
      .catch(() => setState({ isEnabled: false, user: null, isLoading: false }));
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setState((s) => ({ ...s, user: null }));
  }, []);

  return { ...state, error, signOut };
}
