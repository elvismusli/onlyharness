import { useEffect, useState } from "react";

import { useHarness } from "../../core/store";
import { Btn } from "./primitives";
import "./auth.css";

/**
 * Fans logon modal — the skin-agnostic auth flow (`useHarness()` auth state)
 * rendered in the Fans idiom so the subscribe / fork / publish gates actually
 * surface a dialog on the bright blue page. The Win98 skin renders the same
 * handlers as a 98-style `LogonDialog` and Modern rebuilds it on its tokens;
 * this rebuilds the identical behaviour (sign-in / sign-up modes, the `note`
 * prompt, `authStatus` line, `configured` / `authBusy` gating, Enter-to-submit,
 * resend confirmation) as the landing's sign-up card, focused.
 *
 * Only renders when `logon.open`. Credentials are a no-joke zone, so the copy
 * stays plain — no cowboy puns in the auth surface.
 *
 * Mounted once at the skin root (next to `<FansChrome/>`), above every surface.
 */
export function FansLogon() {
  const h = useHarness();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const open = h.logon.open;

  /* Reset the transient form/mode each time the dialog is (re)opened so a fresh
     gate never shows a stale password or sign-up state from a previous open. */
  useEffect(() => {
    if (!open) return;
    setMode("in");
    setName("");
    setEmail("");
    setPassword("");
  }, [open]);

  /* Escape closes the logon (matches FansChrome's overlay behaviour). */
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") h.closeLogon();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, h]);

  if (!open) return null;

  const disabled = h.authBusy || !h.configured;

  function submit() {
    if (disabled) return;
    if (mode === "in") h.signIn(email, password);
    else h.signUp(name, email, password);
  }

  const title = mode === "in" ? "Log in" : "Create your account";

  return (
    <div className="fans-auth-scrim" role="presentation" onClick={h.closeLogon}>
      <div
        className="fans-auth-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="fans-auth-head">
          <span className="fans-auth-icon" aria-hidden>💙</span>
          <h2 className="fans-auth-title">{title}</h2>
        </div>

        <p className="fans-auth-note">
          {h.logon.note ||
            (mode === "in"
              ? "Log in to subscribe to and fork your favorite harnesses."
              : "Create your account to start supporting harnesses.")}
        </p>

        <div className="fans-auth-form">
          {mode === "up" && (
            <label className="fans-auth-field">
              <span className="fans-auth-label">Display name</span>
              <input
                className="fans-auth-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="nickname"
                placeholder="Your name"
              />
            </label>
          )}
          <label className="fans-auth-field">
            <span className="fans-auth-label">Email</span>
            <input
              className="fans-auth-input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              autoFocus={mode === "in"}
            />
          </label>
          <label className="fans-auth-field">
            <span className="fans-auth-label">Password</span>
            <input
              className="fans-auth-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) submit();
              }}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              placeholder="••••••••"
            />
          </label>
        </div>

        {!h.configured && (
          <p className="fans-auth-warn">Auth backend not configured in this environment.</p>
        )}
        {h.authStatus && <p className="fans-auth-status">{h.authStatus}</p>}

        {mode === "in" && (
          <button
            type="button"
            className="fans-auth-resend"
            disabled={disabled}
            onClick={() => h.resendConfirmation(email)}
          >
            Resend confirmation email
          </button>
        )}

        <p className="fans-auth-fine">
          Your account stores your subscriptions and thread posts. Forks stay local.
        </p>

        <div className="fans-auth-actions">
          <button
            type="button"
            className="fans-auth-toggle"
            onClick={() => setMode(mode === "in" ? "up" : "in")}
          >
            {mode === "in" ? "Need an account? Sign up" : "Have an account? Log in"}
          </button>
          <span className="fans-auth-spacer" aria-hidden />
          <Btn variant="outline" onClick={h.closeLogon}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={submit} disabled={disabled}>
            {h.authBusy ? "…" : mode === "in" ? "Log in" : "Create account"}
          </Btn>
        </div>
      </div>
    </div>
  );
}
