import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase, supabaseAnonKey, supabaseUrl } from "./supabase";

type AuthAction = "sign-in" | "sign-up" | "resend";
export type SuperskillOAuthProvider = "google" | "github";

export type SuperskillOAuthProviders = Record<SuperskillOAuthProvider, boolean>;

const NO_OAUTH_PROVIDERS: SuperskillOAuthProviders = { google: false, github: false };
export const RESEND_CONFIRMATION_REQUESTED_MESSAGE = "Confirmation email requested. For privacy, this does not prove that an account exists or that delivery succeeded. If nothing arrives, create the account again or try later.";
export const SIGNUP_CONFIRMATION_CONTINUATION_MESSAGE = "Account created. Check your email; the confirmation link returns you to SuperSkill to continue.";

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
  oauthProviders: SuperskillOAuthProviders;
  oauthProvidersReady: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithOAuth: (provider: SuperskillOAuthProvider) => Promise<void>;
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
  const [oauthProviders, setOauthProviders] = useState<SuperskillOAuthProviders>(NO_OAUTH_PROVIDERS);
  const [oauthProvidersReady, setOauthProvidersReady] = useState(!supabaseUrl || !supabaseAnonKey);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey) return;
    const controller = new AbortController();
    setOauthProvidersReady(false);
    fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/settings`, {
      headers: { apikey: supabaseAnonKey },
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal
    }).then(async (response) => {
      if (!response.ok) throw new Error("Auth provider discovery failed");
      setOauthProviders(oauthProvidersFromSettings(await response.json()));
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setOauthProviders(NO_OAUTH_PROVIDERS);
      }
    }).finally(() => {
      if (!controller.signal.aborted) setOauthProvidersReady(true);
    });
    return () => controller.abort();
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

  async function signInWithOAuth(provider: SuperskillOAuthProvider) {
    if (!supabase) return setAuthStatus("Auth backend is not configured.");
    if (workspaceInviteFromContinuation(window.location.hash)) {
      return setAuthStatus("For invite privacy, social sign-in is disabled on this link. Use email in this original tab, then return here after confirmation.");
    }
    if (!oauthProvidersReady || !oauthProviders[provider]) {
      return setAuthStatus(`${provider === "google" ? "Google" : "GitHub"} sign-in is not enabled.`);
    }
    setAuthBusy(true);
    setAuthStatus(`Opening ${provider === "google" ? "Google" : "GitHub"} sign-in…`);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: oauthRedirectUrl(window.location) }
      });
      if (error) setAuthStatus(authFailureMessage(error, "sign-in"));
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
        options: { emailRedirectTo: oauthRedirectUrl(window.location) }
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
          emailRedirectTo: oauthRedirectUrl(window.location)
        }
      });
      if (error) return setAuthStatus(authFailureMessage(error, "sign-up"));
      if (data.session) {
        setLogon({ open: false, note: "" });
        opts?.onFlash?.(`Welcome to the frontier, ${name || email}`);
      } else {
        setAuthStatus(SIGNUP_CONFIRMATION_CONTINUATION_MESSAGE);
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
    oauthProviders,
    oauthProvidersReady,
    signIn,
    signInWithOAuth,
    signUp,
    resendConfirmation,
    signOut,
    requireUser
  };
}

/** Keep OAuth returns on the SuperSkill surface and reject unrelated hashes. */
export function safeSuperskillAuthContinuation(hash: string): string {
  const connectMatch = hash.match(/^#\/superskill\/connect(?:\?([^#]*))?$/);
  if (connectMatch) {
    const input = new URLSearchParams(connectMatch[1] ?? "");
    const requestIds = input.getAll("request");
    const requestId = requestIds.length === 1 ? requestIds[0]?.trim() : undefined;
    if (requestId && /^ohrq_[A-Za-z0-9_-]{43}$/.test(requestId)) {
      const output = new URLSearchParams({ request: requestId });
      return `#/superskill/connect?${output.toString()}`;
    }
    return "#/superskill/account";
  }
  const match = hash.match(/^#\/superskill\/(account|workspaces)(?:\?([^#]*))?$/);
  if (!match) return "#/superskill/account";
  const route = match[1];
  const input = new URLSearchParams(match[2] ?? "");
  const output = new URLSearchParams();
  const workspace = input.get("workspace")?.trim();
  const invite = input.get("invite")?.trim();
  const resource = input.get("resource")?.trim();
  const approve = input.get("approve") === "1";
  const resourceVersion = input.get("version")?.trim();
  const artifactDigest = input.get("digest")?.trim().toLowerCase();
  const exactApproval = Boolean(
    approve
    && resource
    && validWorkspaceResourceRef(resource)
    && resourceVersion
    && isReleaseVersion(resourceVersion)
    && artifactDigest
    && /^[a-f0-9]{64}$/.test(artifactDigest)
  );
  if (workspace && /^[a-z][a-z0-9_-]{1,48}$/.test(workspace)) output.set("workspace", workspace);
  if (invite && invite.length <= 256 && !/[\u0000-\u001f\u007f]/.test(invite)) output.set("invite", invite);
  if (resource && validWorkspaceResourceRef(resource)) output.set("resource", resource);
  if (exactApproval) {
    output.set("approve", "1");
    output.set("version", resourceVersion!);
    output.set("digest", artifactDigest!);
  }
  const query = output.toString();
  return `#/superskill/${route}${query ? `?${query}` : ""}`;
}

export function oauthRedirectUrl(
  location: Pick<Location, "origin" | "hash">
): string {
  return `${location.origin}/${safeSuperskillExternalAuthContinuation(location.hash)}`;
}

/** External auth systems may receive redirectTo in requests and logs, so raw invite codes are stripped. */
export function safeSuperskillExternalAuthContinuation(hash: string): string {
  const continuation = safeSuperskillAuthContinuation(hash);
  const queryStart = continuation.indexOf("?");
  if (queryStart === -1) return continuation;
  const params = new URLSearchParams(continuation.slice(queryStart + 1));
  params.delete("invite");
  const query = params.toString();
  return `${continuation.slice(0, queryStart)}${query ? `?${query}` : ""}`;
}

function validWorkspaceResourceRef(value: string): boolean {
  return value.length >= 2
    && value.length <= 180
    && /^[A-Za-z0-9@._:+/-]+$/.test(value)
    && !value.includes("..")
    && !value.startsWith("/")
    && !value.endsWith("/");
}

function isReleaseVersion(value: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

export function workspaceInviteFromContinuation(hash: string): string | undefined {
  const continuation = safeSuperskillAuthContinuation(hash);
  const invite = new URLSearchParams(continuation.split("?", 2)[1] ?? "").get("invite")?.trim();
  return invite && /^ohwi_[A-Za-z0-9_-]{20,80}$/.test(invite) ? invite : undefined;
}

export function oauthProvidersFromSettings(value: unknown): SuperskillOAuthProviders {
  const body = value && typeof value === "object" ? value as { external?: unknown } : undefined;
  const external = body?.external && typeof body.external === "object"
    ? body.external as Record<string, unknown>
    : undefined;
  return {
    google: external?.google === true,
    github: external?.github === true
  };
}
