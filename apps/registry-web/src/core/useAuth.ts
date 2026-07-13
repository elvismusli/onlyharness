import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "./supabase";

type AuthAction = "sign-in" | "sign-up" | "resend";

export const RESEND_CONFIRMATION_REQUESTED_MESSAGE = "Confirmation email requested. For privacy, this does not prove that an account exists or that delivery succeeded. If nothing arrives, create the account again or try later.";

export function authFailureMessage(error: unknown, action: AuthAction): string {
  const candidate = error && typeof error === "object" ? error as { message?: unknown } : undefined;
  const message = typeof candidate?.message === "string" ? candidate.message.trim() : "";
  if (message && message !== "{}" && message !== "[object Object]") return message;
  if (action === "sign-up") return "Account creation failed because the confirmation email service is unavailable. No account was created. Try again shortly.";
  if (action === "resend") return "The confirmation email request failed. Try again shortly.";
  return "Sign in failed. Check your credentials and try again.";
}

export type UseAuthResult = {
  session: Session | null;
  user: Session["user"] | null;
  accessToken: string | undefined;
  configured: boolean;
  logon: { open: boolean; note: string };
  openLogon: (note?: string) => void;
  closeLogon: () => void;
  authStatus: string;
  authBusy: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  requireUser: (note: string) => boolean;
};

/**
 * Skin-agnostic authentication logic extracted from the Win98 `App()`.
 *
 * Owns the Supabase session (bootstrapped from `getSession()` and kept in sync
 * via `onAuthStateChange`), the logon-dialog `{open,note}` flag, and the
 * `authStatus`/`authBusy` progress state shared by the sign-in/up flows. Only
 * *pure* auth lives here — storefront/social identity (myHandle, myStorefront)
 * stays in the host component.
 *
 * Skin chrome is kept out: instead of calling `flashMsg`/`showDialog` directly,
 * the sign-in/up/out flows invoke `opts.onFlash(msg)` so the host surfaces its
 * own toast. `signOut` performs the bare sign-out; the host keeps whatever
 * confirm-dialog wrapper (`logOff`) it wants around it.
 */
export function useAuth(opts?: { onFlash?: (msg: string) => void }): UseAuthResult {
  const [session, setSession] = useState<Session | null>(null);
  const [logon, setLogon] = useState<{ open: boolean; note: string }>({ open: false, note: "" });
  const [authStatus, setAuthStatus] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  function openLogon(note = "") {
    setAuthStatus("");
    setLogon({ open: true, note });
  }

  function closeLogon() {
    setLogon({ open: false, note: "" });
  }

  function requireUser(note: string) {
    if (session?.user) return true;
    setAuthStatus("");
    setLogon({ open: true, note });
    return false;
  }

  async function signIn(email: string, password: string) {
    if (!supabase) return setAuthStatus("Auth backend is not configured.");
    if (!email || !password) return setAuthStatus("Email and password are required.");
    setAuthBusy(true);
    setAuthStatus("Logging on...");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return setAuthStatus(authFailureMessage(error, "sign-in"));
      setLogon({ open: false, note: "" });
      opts?.onFlash?.(`Logged on as ${email}`);
    } catch (error) {
      setAuthStatus(authFailureMessage(error, "sign-in"));
    } finally {
      setAuthBusy(false);
    }
  }

  async function resendConfirmation(email: string) {
    if (!supabase) return setAuthStatus("Auth backend is not configured.");
    if (!email) return setAuthStatus("Email is required.");
    setAuthBusy(true);
    setAuthStatus("Sending confirmation email...");
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: window.location.origin }
      });
      if (error) return setAuthStatus(authFailureMessage(error, "resend"));
      setAuthStatus(RESEND_CONFIRMATION_REQUESTED_MESSAGE);
    } catch (error) {
      setAuthStatus(authFailureMessage(error, "resend"));
    } finally {
      setAuthBusy(false);
    }
  }

  async function signUp(name: string, email: string, password: string) {
    if (!supabase) return setAuthStatus("Auth backend is not configured.");
    if (!email || !password) return setAuthStatus("Email and password are required.");
    setAuthBusy(true);
    setAuthStatus("Creating account...");
    try {
      const { error, data } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: name || email.split("@")[0] },
          emailRedirectTo: window.location.origin
        }
      });
      if (error) return setAuthStatus(authFailureMessage(error, "sign-up"));
      if (data.session) {
        setLogon({ open: false, note: "" });
        opts?.onFlash?.(`Welcome to the frontier, ${name || email}`);
      } else {
        setAuthStatus("Account created. Check your email to confirm, then log on.");
      }
    } catch (error) {
      setAuthStatus(authFailureMessage(error, "sign-up"));
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    await supabase?.auth.signOut();
    setSession(null);
    opts?.onFlash?.("Logged off");
  }

  return {
    session,
    user: session?.user ?? null,
    accessToken: session?.access_token,
    configured: Boolean(supabase),
    logon,
    openLogon,
    closeLogon,
    authStatus,
    authBusy,
    signIn,
    signUp,
    resendConfirmation,
    signOut,
    requireUser
  };
}
