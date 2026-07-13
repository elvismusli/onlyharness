import { useEffect, useState, type FormEvent } from "react";

import { apiUrl } from "../../../core/constants";
import { useHarness } from "../../../core/store";
import { safeSuperskillAuthContinuation, workspaceInviteFromContinuation, type SuperskillOAuthProvider } from "../../../core/useAuth";
import { PageHeading, ShellLink, SSButton } from "../primitives";

type AuthMode = "sign-in" | "sign-up";

export function AccountPage() {
  const h = useHarness();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [deviceCode, setDeviceCode] = useState("");
  const [deviceStatus, setDeviceStatus] = useState("");
  const [deviceBusy, setDeviceBusy] = useState(false);

  useEffect(() => setPassword(""), [mode]);

  if (h.user) {
    const displayName = typeof h.user.user_metadata?.display_name === "string" ? h.user.user_metadata.display_name : "";
    const confirmed = Boolean(h.user.email_confirmed_at);
    const workspaceContinuation = workspaceContinuationHref(window.location.hash);
    const approveDevice = async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!confirmed || !h.accessToken || deviceBusy) return;
      const userCode = normalizeDeviceCode(deviceCode);
      if (!userCode) {
        setDeviceStatus("Enter the 8-character code shown in your terminal.");
        return;
      }
      setDeviceBusy(true);
      setDeviceStatus("Approving this terminal…");
      try {
        const response = await fetch(`${apiUrl}/auth/device/approve`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${h.accessToken}`
          },
          body: JSON.stringify({ user_code: userCode })
        });
        const body = await response.json().catch(() => undefined) as { code?: unknown } | undefined;
        if (!response.ok) {
          setDeviceStatus(deviceApprovalMessage(typeof body?.code === "string" ? body.code : undefined));
          return;
        }
        setDeviceCode("");
        setDeviceStatus("Terminal approved. Return to it to finish sign-in.");
      } catch {
        setDeviceStatus("Could not reach the device authorization service. Try again.");
      } finally {
        setDeviceBusy(false);
      }
    };
    return (
      <main className="ss-content ss-page ss-account-page">
        <PageHeading eyebrow="Account">Your SuperSkill account</PageHeading>
        <p className="ss-page-lede">Registration and workspace access use your existing account. Session credentials are never displayed here.</p>
        <section className="ss-account-card" aria-labelledby="ss-account-identity">
          <div>
            <span className="ss-evidence-label">Signed in</span>
            <h2 id="ss-account-identity">{displayName || h.user.email || "SuperSkill member"}</h2>
            {displayName && h.user.email ? <p>{h.user.email}</p> : null}
          </div>
          <span className={`ss-account-state ss-account-state--${confirmed ? "confirmed" : "pending"}`}>
            {confirmed ? "Email confirmed" : "Confirmation required"}
          </span>
          {!confirmed ? <p className="ss-auth-notice">Confirm your email before relying on managed SuperSkill access.</p> : null}
          <div className="ss-account-actions">
            <div className="ss-account-links">
              <ShellLink href={workspaceContinuation ?? "#/superskill/workspaces"}>{workspaceContinuation ? "Continue to workspace" : "Open workspaces"}</ShellLink>
              <ShellLink href="#/superskill/publish">Publish a skill</ShellLink>
            </div>
            <SSButton variant="secondary" type="button" disabled={h.authBusy} onClick={() => void h.signOut()}>Sign out</SSButton>
          </div>
        </section>
        <section className="ss-device-auth-card" aria-labelledby="ss-device-auth-title">
          <span className="ss-evidence-label">Terminal authorization</span>
          <h2 id="ss-device-auth-title">Connect the SuperSkill CLI</h2>
          <p>Run <code>eval &quot;$(hh auth login --shell)&quot;</code> in your terminal, then enter its one-time code here. The browser session and resulting token are never displayed or stored by this page.</p>
          {!confirmed ? <p className="ss-auth-notice">Confirm your email before approving a terminal.</p> : (
            <form className="ss-device-auth-form" onSubmit={(event) => void approveDevice(event)}>
              <label htmlFor="ss-device-code">One-time code</label>
              <input
                id="ss-device-code"
                value={deviceCode}
                onChange={(event) => setDeviceCode(formatDeviceCode(event.target.value))}
                autoComplete="one-time-code"
                inputMode="text"
                spellCheck={false}
                maxLength={9}
                placeholder="ABCD-2345"
                aria-describedby={deviceStatus ? "ss-device-status" : undefined}
              />
              <SSButton type="submit" disabled={deviceBusy || !deviceCode}>{deviceBusy ? "Approving…" : "Approve terminal"}</SSButton>
            </form>
          )}
          {deviceStatus ? <p id="ss-device-status" className="ss-auth-status" role="status" aria-live="polite">{deviceStatus}</p> : null}
        </section>
      </main>
    );
  }

  const disabled = h.authBusy || !h.configured;
  const privateInvite = workspaceInviteFromContinuation(window.location.hash);
  const enabledOAuthProviders = privateInvite ? [] : (["google", "github"] as const).filter((provider) => h.oauthProviders[provider]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;
    const submittedPassword = password;
    setPassword("");
    if (mode === "sign-in") void h.signIn(email, submittedPassword);
    else void h.signUp(name, email, submittedPassword);
  };

  return (
    <main className="ss-content ss-page ss-account-page">
      <PageHeading eyebrow="Account">Sign in to SuperSkill</PageHeading>
      <p className="ss-page-lede">Create one account for confirmed access and private workspaces. New accounts must confirm their email before managed access is granted. If you opened a workspace invite, confirm in the email tab and then return to this original tab.</p>
      <section className="ss-auth-card" aria-labelledby="ss-auth-title">
        {privateInvite ? <p className="ss-auth-notice">For invite privacy, social sign-in is disabled on this link. Use email in this original tab, confirm in the email tab, then return here.</p> : null}
        {enabledOAuthProviders.length ? (
          <div className="ss-oauth-actions" aria-label="Social sign in">
            {enabledOAuthProviders.map((provider) => (
              <SSButton key={provider} variant="secondary" type="button" disabled={disabled} onClick={() => void h.signInWithOAuth(provider)}>
                Continue with {oauthProviderName(provider)}
              </SSButton>
            ))}
          </div>
        ) : null}
        <div className="ss-auth-tabs" role="tablist" aria-label="Account action">
          <button type="button" role="tab" aria-selected={mode === "sign-in"} onClick={() => setMode("sign-in")}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === "sign-up"} onClick={() => setMode("sign-up")}>Create account</button>
        </div>
        <h2 id="ss-auth-title">{mode === "sign-in" ? "Welcome back" : "Create your account"}</h2>
        <form className="ss-auth-form" onSubmit={submit}>
          {mode === "sign-up" ? (
            <label>Display name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="nickname" /></label>
          ) : null}
          <label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
          <label>Password<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} /></label>
          {!h.configured ? <p className="ss-auth-notice ss-auth-notice--error">Account service is not configured in this environment.</p> : null}
          {h.authStatus ? <p className="ss-auth-status" role="status" aria-live="polite">{h.authStatus}</p> : null}
          <div className="ss-auth-actions">
            {mode === "sign-in" ? (
              <button className="ss-auth-text-button" type="button" disabled={disabled || !email} onClick={() => void h.resendConfirmation(email)}>Resend confirmation email</button>
            ) : <span className="ss-auth-confirm-copy">We will send a confirmation link. Return to this original tab afterward so the private invite code never leaves it.</span>}
            <SSButton type="submit" disabled={disabled}>{h.authBusy ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}</SSButton>
          </div>
        </form>
      </section>
    </main>
  );
}

function oauthProviderName(provider: SuperskillOAuthProvider): string {
  return provider === "google" ? "Google" : "GitHub";
}

export function workspaceContinuationHref(hash: string): string | undefined {
  const continuation = safeSuperskillAuthContinuation(hash);
  if (!continuation.startsWith("#/superskill/account?")) return undefined;
  const query = continuation.slice("#/superskill/account?".length);
  const params = new URLSearchParams(query);
  if (!params.get("workspace")) return undefined;
  return `#/superskill/workspaces?${params.toString()}`;
}

const DEVICE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function normalizeDeviceCode(value: string): string | undefined {
  const normalized = value.toUpperCase().replace(/[\s-]+/g, "");
  return normalized.length === 8 && [...normalized].every((character) => DEVICE_CODE_ALPHABET.includes(character))
    ? `${normalized.slice(0, 4)}-${normalized.slice(4)}`
    : undefined;
}

function formatDeviceCode(value: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z2-9]/g, "").split("").filter((character) => DEVICE_CODE_ALPHABET.includes(character)).join("").slice(0, 8);
  return normalized.length > 4 ? `${normalized.slice(0, 4)}-${normalized.slice(4)}` : normalized;
}

function deviceApprovalMessage(code: string | undefined): string {
  if (code === "DEVICE_CODE_EXPIRED") return "This code expired. Start a new terminal login.";
  if (code === "DEVICE_CODE_USED") return "This code was already used. Start a new terminal login.";
  if (code === "DEVICE_AUTH_EMAIL_UNCONFIRMED") return "Confirm your email before approving a terminal.";
  if (code === "DEVICE_AUTH_ACCESS_DENIED") return "Managed access is suspended or revoked for this account.";
  if (code === "DEVICE_AUTH_RATE_LIMITED") return "Too many attempts. Wait before trying again.";
  return "The one-time code is invalid. Check the terminal and try again.";
}
