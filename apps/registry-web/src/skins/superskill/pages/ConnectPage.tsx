import { useEffect, useMemo, useState, type FormEvent } from "react";

import { apiUrl } from "../../../core/constants";
import { useHarness } from "../../../core/store";
import type { SuperskillOAuthProvider } from "../../../core/useAuth";
import { PageHeading, SSButton } from "../primitives";
import "./ConnectPage.css";

type AuthMode = "sign-in" | "sign-up";
type ConnectPhase = "binding" | "loading" | "ready" | "approved" | "denied" | "expired" | "error";
type AgentClient = "codex" | "claude-code" | "cli";
type AgentScope = "superskill:managed" | "resources:publish" | "workspaces:read" | "workspaces:write";

type AgentConnectContext = {
  id: string;
  client: AgentClient;
  clientName: string;
  scopes: AgentScope[];
  expiresAt: string;
  status: "pending" | "approved" | "denied" | "expired" | "consumed";
};

export function ConnectPage({ requestId, browserProof }: { requestId: string; browserProof?: string }) {
  const h = useHarness();
  const [phase, setPhase] = useState<ConnectPhase>(browserProof ? "binding" : "loading");
  const [context, setContext] = useState<AgentConnectContext>();
  const [status, setStatus] = useState("");
  const [decisionBusy, setDecisionBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      try {
        if (browserProof) {
          setPhase("binding");
          const bindRequest = fetch(`${apiUrl}/auth/agent/browser-bind`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ request_id: requestId, browser_proof: browserProof }),
            credentials: "include",
            cache: "no-store",
            signal: controller.signal
          });
          scrubBrowserProof(requestId);
          const bindResponse = await bindRequest;
          if (!bindResponse.ok) throw await connectApiError(bindResponse, "This connection link is invalid or was already used.");
        }

        setPhase("loading");
        const response = await fetch(`${apiUrl}/auth/agent/context?request_id=${encodeURIComponent(requestId)}`, {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw await connectApiError(response, "This connection request is unavailable.");
        const nextContext = parseConnectContext(await response.json(), requestId);
        if (!active) return;
        setContext(nextContext);
        if (nextContext.status === "pending" && Date.parse(nextContext.expiresAt) > Date.now()) setPhase("ready");
        else if (nextContext.status === "approved" || nextContext.status === "consumed") setPhase("approved");
        else if (nextContext.status === "denied") setPhase("denied");
        else setPhase("expired");
      } catch (error) {
        if (!active || isAbortError(error)) return;
        setStatus(connectErrorMessage(error));
        setPhase("error");
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [requestId, browserProof]);

  async function decide(decision: "approve" | "deny") {
    if (decisionBusy || phase !== "ready") return;
    if (decision === "approve" && (!h.user || !h.accessToken || !h.user.email_confirmed_at)) return;
    setDecisionBusy(true);
    setStatus(decision === "approve" ? "Connecting your agent…" : "Denying this request…");
    try {
      const response = await fetch(`${apiUrl}/auth/agent/decision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(h.accessToken ? { Authorization: `Bearer ${h.accessToken}` } : {})
        },
        body: JSON.stringify({ request_id: requestId, decision }),
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) throw await connectApiError(response, decision === "approve" ? "SuperSkill could not connect this agent." : "SuperSkill could not deny this request.");
      setPhase(decision === "approve" ? "approved" : "denied");
      setStatus(decision === "approve" ? "Connected. Return to your agent; the original task will continue automatically." : "Connection denied. No agent session was created.");
    } catch (error) {
      setStatus(connectErrorMessage(error));
    } finally {
      setDecisionBusy(false);
    }
  }

  async function useAnotherAccount() {
    if (decisionBusy || h.authBusy) return;
    setStatus("");
    await h.signOut();
  }

  if (phase === "binding" || phase === "loading") {
    return (
      <main className="ss-content ss-page ss-connect-page">
        <PageHeading eyebrow="Agent connection">Checking this SuperSkill request</PageHeading>
        <section className="ss-connect-card" aria-live="polite"><p>{phase === "binding" ? "Securing the browser handoff…" : "Loading the requested permissions…"}</p></section>
      </main>
    );
  }

  if (phase === "error" || !context) {
    return (
      <main className="ss-content ss-page ss-connect-page">
        <PageHeading eyebrow="Agent connection">Connection unavailable</PageHeading>
        <section className="ss-connect-card ss-connect-card--error"><p role="alert">{status || "This connection request is unavailable."}</p><p>Return to your agent and start sign-in again.</p></section>
      </main>
    );
  }

  if (phase === "approved" || phase === "denied" || phase === "expired") {
    const title = phase === "approved" ? "Agent connected" : phase === "denied" ? "Connection denied" : "Connection expired";
    const message = status || (phase === "approved"
      ? "Return to your agent. It can now continue the original task automatically."
      : phase === "denied"
        ? "No agent session was created. You can close this tab."
        : "Return to your agent and start a new connection request.");
    return (
      <main className="ss-content ss-page ss-connect-page">
        <PageHeading eyebrow="Agent connection">{title}</PageHeading>
        <section className={`ss-connect-card ss-connect-card--${phase}`}><ClientSummary context={context} /><p role="status">{message}</p></section>
      </main>
    );
  }

  const confirmed = Boolean(h.user?.email_confirmed_at);
  return (
    <main className="ss-content ss-page ss-connect-page">
      <PageHeading eyebrow="Agent connection">Connect {context.clientName} to SuperSkill</PageHeading>
      <p className="ss-page-lede">Review the exact permissions. SuperSkill sends the result directly back to your agent and never displays its session credential.</p>
      <div className="ss-connect-layout">
        <section className="ss-connect-card" aria-labelledby="ss-connect-request-title">
          <span className="ss-evidence-label">Requested access</span>
          <h2 id="ss-connect-request-title">{context.clientName}</h2>
          <ClientSummary context={context} />
          <ul className="ss-connect-scopes">
            {context.scopes.map((scope) => <li key={scope}><strong>{scopeLabel(scope)}</strong><code>{scope}</code></li>)}
          </ul>
          <p className="ss-connect-expiry">Request expires {formatExpiry(context.expiresAt)}.</p>
        </section>

        <section className="ss-connect-card" aria-labelledby="ss-connect-account-title">
          <span className="ss-evidence-label">Your account</span>
          {h.user ? (
            <>
              <h2 id="ss-connect-account-title">{displayAccountName(h.user)}</h2>
              {displayAccountName(h.user) !== h.user.email && h.user.email ? <p className="ss-connect-email">{h.user.email}</p> : null}
              <span className={`ss-account-state ss-account-state--${confirmed ? "confirmed" : "pending"}`}>{confirmed ? "Confirmed account" : "Confirmation required"}</span>
              {!confirmed ? <p className="ss-auth-notice">Confirm your email, then return to this page before connecting the agent.</p> : null}
              {status ? <p className="ss-auth-status" role="status" aria-live="polite">{status}</p> : null}
              <div className="ss-connect-actions">
                <SSButton variant="secondary" type="button" disabled={decisionBusy || h.authBusy} onClick={() => void useAnotherAccount()}>Use another account</SSButton>
                <SSButton variant="secondary" type="button" disabled={decisionBusy} onClick={() => void decide("deny")}>Deny</SSButton>
                <SSButton type="button" disabled={decisionBusy || !confirmed} onClick={() => void decide("approve")}>{decisionBusy ? "Working…" : "Continue"}</SSButton>
              </div>
            </>
          ) : (
            <ConnectSignIn titleId="ss-connect-account-title" onDeny={() => void decide("deny")} />
          )}
        </section>
      </div>
    </main>
  );
}

function ConnectSignIn({ titleId, onDeny }: { titleId: string; onDeny: () => void }) {
  const h = useHarness();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const enabledProviders = useMemo(() => (["google", "github"] as const).filter((provider) => h.oauthProviders[provider]), [h.oauthProviders]);
  const disabled = h.authBusy || !h.configured;

  useEffect(() => setPassword(""), [mode]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const submittedPassword = password;
    setPassword("");
    if (mode === "sign-in") void h.signIn(email, submittedPassword);
    else void h.signUp(name, email, submittedPassword);
  }

  return (
    <>
      <h2 id={titleId}>Sign in to continue</h2>
      <p className="ss-connect-signin-copy">Signing in does not approve the request. You will review it again before SuperSkill connects your agent.</p>
      {enabledProviders.length ? <div className="ss-oauth-actions" aria-label="Social sign in">{enabledProviders.map((provider) => (
        <SSButton key={provider} variant="secondary" type="button" disabled={disabled} onClick={() => void h.signInWithOAuth(provider)}>Continue with {providerName(provider)}</SSButton>
      ))}</div> : null}
      <div className="ss-auth-tabs" role="tablist" aria-label="Account action">
        <button type="button" role="tab" aria-selected={mode === "sign-in"} onClick={() => setMode("sign-in")}>Sign in</button>
        <button type="button" role="tab" aria-selected={mode === "sign-up"} onClick={() => setMode("sign-up")}>Create account</button>
      </div>
      <form className="ss-auth-form" onSubmit={submit}>
        {mode === "sign-up" ? <label>Display name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="nickname" /></label> : null}
        <label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
        <label>Password<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} /></label>
        {!h.configured ? <p className="ss-auth-notice ss-auth-notice--error">Account service is not configured in this environment.</p> : null}
        {h.authStatus ? <p className="ss-auth-status" role="status" aria-live="polite">{h.authStatus}</p> : null}
        <div className="ss-auth-actions">
          {mode === "sign-in" ? <button className="ss-auth-text-button" type="button" disabled={disabled || !email} onClick={() => void h.resendConfirmation(email)}>Resend confirmation email</button> : <span className="ss-auth-confirm-copy">We will return you to this pending connection after email confirmation.</span>}
          <SSButton type="submit" disabled={disabled}>{h.authBusy ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}</SSButton>
        </div>
      </form>
      <div className="ss-connect-deny"><SSButton variant="secondary" type="button" onClick={onDeny}>Deny request</SSButton></div>
    </>
  );
}

function ClientSummary({ context }: { context: AgentConnectContext }) {
  return <dl className="ss-connect-summary"><div><dt>Client</dt><dd>{context.client}</dd></div><div><dt>Return to</dt><dd>{context.clientName}</dd></div><div><dt>Return domain</dt><dd>{connectReturnDomain()}</dd></div></dl>;
}

function connectReturnDomain(): string {
  try {
    return new URL(apiUrl).hostname;
  } catch {
    return "superskill.sh";
  }
}

function scrubBrowserProof(requestId: string) {
  const params = new URLSearchParams({ request: requestId });
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#/superskill/connect?${params.toString()}`);
}

function parseConnectContext(value: unknown, requestId: string): AgentConnectContext {
  if (!value || typeof value !== "object") throw new Error("The connection service returned an invalid request.");
  const request = (value as { request?: unknown }).request;
  if (!request || typeof request !== "object") throw new Error("The connection service returned an invalid request.");
  const row = request as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  const client = isAgentClient(row.client) ? row.client : undefined;
  const clientName = typeof row.client_name === "string" ? row.client_name.trim() : "";
  const scopes = Array.isArray(row.scopes) && row.scopes.every(isAgentScope) ? row.scopes as AgentScope[] : undefined;
  const expiresAt = typeof row.expires_at === "string" ? row.expires_at : "";
  const status = row.status;
  if (id !== requestId || !client || clientName !== clientNameFor(client) || !scopes?.length || !Number.isFinite(Date.parse(expiresAt)) || !isContextStatus(status)) {
    throw new Error("The connection service returned an invalid request.");
  }
  return { id, client, clientName, scopes: [...new Set(scopes)], expiresAt, status };
}

function isContextStatus(value: unknown): value is AgentConnectContext["status"] {
  return value === "pending" || value === "approved" || value === "denied" || value === "expired" || value === "consumed";
}

function isAgentClient(value: unknown): value is AgentClient {
  return value === "codex" || value === "claude-code" || value === "cli";
}

function clientNameFor(client: AgentClient): string {
  return client === "codex" ? "Codex" : client === "claude-code" ? "Claude Code" : "SuperSkill CLI";
}

function isAgentScope(value: unknown): value is AgentScope {
  return value === "superskill:managed" || value === "resources:publish" || value === "workspaces:read" || value === "workspaces:write";
}

async function connectApiError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => undefined) as { code?: unknown; error?: unknown } | undefined;
  const code = typeof body?.code === "string" ? body.code : "";
  if (response.status === 404 || code === "AGENT_AUTH_REQUEST_NOT_FOUND") return new Error("This connection request was not found. Return to your agent and start again.");
  if (response.status === 410 || code.includes("EXPIRED")) return new Error("This connection request expired. Return to your agent and start again.");
  if (code.includes("PROOF") || code.includes("BOUND") || code.includes("USED")) return new Error("This connection link is invalid or was already used. Return to your agent and start again.");
  if (response.status === 403) return new Error("This account cannot approve the requested access.");
  return new Error(fallback);
}

function connectErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The connection service is unavailable. Return to your agent and try again.";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function providerName(provider: SuperskillOAuthProvider): string {
  return provider === "google" ? "Google" : "GitHub";
}

function displayAccountName(user: { email?: string; user_metadata?: Record<string, unknown> }): string {
  const displayName = typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name.trim() : "";
  return displayName || user.email || "SuperSkill member";
}

function formatExpiry(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function scopeLabel(scope: AgentScope): string {
  switch (scope) {
    case "superskill:managed": return "Use managed recommendations";
    case "resources:publish": return "Publish and update resources";
    case "workspaces:read": return "Read your workspaces";
    case "workspaces:write": return "Create and change workspaces";
  }
}
