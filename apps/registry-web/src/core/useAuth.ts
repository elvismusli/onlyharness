import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "./supabase";

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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setAuthBusy(false);
    if (error) return setAuthStatus(error.message);
    setLogon({ open: false, note: "" });
    opts?.onFlash?.(`Logged on as ${email}`);
  }

  async function resendConfirmation(email: string) {
    if (!supabase) return setAuthStatus("Auth backend is not configured.");
    if (!email) return setAuthStatus("Email is required.");
    setAuthBusy(true);
    setAuthStatus("Sending confirmation email...");
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: window.location.origin }
    });
    setAuthBusy(false);
    if (error) return setAuthStatus(error.message);
    setAuthStatus("Confirmation email sent. Check your inbox, then log on.");
  }

  async function signUp(name: string, email: string, password: string) {
    if (!supabase) return setAuthStatus("Auth backend is not configured.");
    if (!email || !password) return setAuthStatus("Email and password are required.");
    setAuthBusy(true);
    setAuthStatus("Creating account...");
    const { error, data } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name || email.split("@")[0] },
        emailRedirectTo: window.location.origin
      }
    });
    setAuthBusy(false);
    if (error) return setAuthStatus(error.message);
    if (data.session) {
      setLogon({ open: false, note: "" });
      opts?.onFlash?.(`Welcome to the frontier, ${name || email}`);
    } else {
      setAuthStatus("Account created. Check your email to confirm, then log on.");
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
