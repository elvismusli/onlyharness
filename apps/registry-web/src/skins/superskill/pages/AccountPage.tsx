import { useEffect, useState, type FormEvent } from "react";

import { useHarness } from "../../../core/store";
import { PageHeading, ShellLink, SSButton } from "../primitives";

type AuthMode = "sign-in" | "sign-up";

export function AccountPage() {
  const h = useHarness();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => setPassword(""), [mode]);

  if (h.user) {
    const displayName = typeof h.user.user_metadata?.display_name === "string" ? h.user.user_metadata.display_name : "";
    const confirmed = Boolean(h.user.email_confirmed_at);
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
            <ShellLink href="#/superskill/workspaces">Open workspaces</ShellLink>
            <SSButton variant="secondary" type="button" disabled={h.authBusy} onClick={() => void h.signOut()}>Sign out</SSButton>
          </div>
        </section>
      </main>
    );
  }

  const disabled = h.authBusy || !h.configured;
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
      <p className="ss-page-lede">Create one account for confirmed access and private workspaces. New accounts must confirm their email before managed access is granted.</p>
      <section className="ss-auth-card" aria-labelledby="ss-auth-title">
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
            ) : <span className="ss-auth-confirm-copy">We will send a confirmation link to this address.</span>}
            <SSButton type="submit" disabled={disabled}>{h.authBusy ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}</SSButton>
          </div>
        </form>
      </section>
    </main>
  );
}
