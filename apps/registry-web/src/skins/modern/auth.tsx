import { useEffect, useState } from "react";

import { useHarness } from "../../core/store";
import { Btn } from "./primitives";

/**
 * Modern logon modal — the skin-agnostic auth flow (`useHarness()` auth state)
 * rendered in the Modern idiom so the star/thread/remix gates actually surface a
 * dialog here. The Win98 skin renders the same handlers as a 98-style
 * `LogonDialog`; this rebuilds that UI (sign-in / sign-up modes, the note prompt,
 * `authStatus` line, `configured`/`authBusy` gating, Enter-to-submit, resend
 * confirmation) on the Modern token system.
 *
 * Only renders when `logon.open`. Credentials are a no-joke zone, so the copy
 * stays plain — no frontier puns in the auth surface.
 *
 * Mounted once at the skin root (next to `<ModernChrome/>`), above every surface.
 */
export function ModernLogon() {
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

  /* Escape closes the logon (matches ModernChrome's overlay behaviour). */
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

  const title = mode === "in" ? "Log on to OnlyHarness" : "Create your account";

  return (
    <div className="ohc-scrim" role="presentation" onClick={h.closeLogon}>
      <div
        className="ohc-modal oh-logon"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ohc-modal-head">
          <span className="ohc-modal-icon" aria-hidden>🔑</span>
          <h2 className="ohc-modal-title">{title}</h2>
        </div>

        <p className="ohc-modal-body">
          {h.logon.note || "Type your email and password to log on to OnlyHarness."}
        </p>

        <div className="oh-logon-form">
          {mode === "up" && (
            <label className="oh-logon-field">
              <span className="oh-logon-label">Display name</span>
              <input
                className="oh-logon-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="nickname"
              />
            </label>
          )}
          <label className="oh-logon-field">
            <span className="oh-logon-label">Email</span>
            <input
              className="oh-logon-input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              autoFocus={mode === "in"}
            />
          </label>
          <label className="oh-logon-field">
            <span className="oh-logon-label">Password</span>
            <input
              className="oh-logon-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) submit();
              }}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
            />
          </label>
        </div>

        {!h.configured && <p className="oh-logon-warn">Auth backend not configured in this environment.</p>}
        {h.authStatus && <p className="oh-logon-status">{h.authStatus}</p>}

        {mode === "in" && (
          <button
            type="button"
            className="oh-logon-link"
            disabled={disabled}
            onClick={() => h.resendConfirmation(email)}
          >
            Resend confirmation email
          </button>
        )}

        <p className="oh-logon-fine">Your account stores stars and thread posts. Remix recipes stay local.</p>

        <div className="ohc-modal-actions oh-logon-actions">
          <button
            type="button"
            className="oh-logon-toggle"
            onClick={() => setMode(mode === "in" ? "up" : "in")}
          >
            {mode === "in" ? "Need an account? Sign up" : "Have an account? Log on"}
          </button>
          <span style={{ flex: 1 }} />
          <Btn variant="ghost" onClick={h.closeLogon}>Cancel</Btn>
          <Btn variant="primary" onClick={submit} disabled={disabled}>
            {h.authBusy ? "…" : "OK"}
          </Btn>
        </div>
      </div>
    </div>
  );
}
