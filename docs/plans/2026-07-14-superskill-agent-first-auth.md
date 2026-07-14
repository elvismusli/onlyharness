# SuperSkill Agent-First Auth

Дата: 2026-07-14
Статус: IMPLEMENTATION SOURCE OF TRUTH

## Product contract

Primary flow:

`one link -> one new client task -> anonymous browse -> first protected action -> browser sign-in -> same-task resume`

- Public search, detail and public hosted-resource installation stay anonymous.
- Interactive Codex and Claude Code flows never require `eval`, a copied bearer, a second terminal, or another restart after sign-in.
- The project-local `superskill_local` MCP owns account authorization and protected operations. The remote `/mcp` remains browse-only for new clients.
- Agent credentials never appear in a tool argument/result, prompt, project file, URL query, analytics event or log.
- Google, GitHub and confirmed email/password share one Daylight connect page. Approval is explicit after sign-in.

## Transition-release contract

- `POST /auth/agent/start` creates independent device and browser proofs. Only the browser proof is placed in the `#/superskill/connect` URL fragment; only the local process receives the device proof.
- `browser-bind` exchanges the fragment proof for a short-lived HttpOnly, Secure, SameSite browser binding and the page immediately scrubs the fragment.
- Approval creates a scoped account session. Access tokens are opaque, memory-only and live for 10 minutes. Rotating refresh tokens live in the OS credential store and have a 30-day absolute lifetime.
- Required scopes are `superskill:managed`, `resources:publish`, `workspaces:read` and `workspaces:write`. Scope never replaces workspace membership or role checks.
- Local MCP tools are `auth_status`, `auth_start`, `auth_wait`, `auth_logout`, the managed lifecycle tools, and protected publish/workspace wrappers. `AUTH_PENDING` carries no server secret; the exact mutation idempotency key survives authorization and one automatic retry.
- `HH_TOKEN` remains supported only for existing non-interactive/paid compatibility paths. New plugin config does not inherit it. `HH_SUPERSKILL_TOKEN` and `/auth/device/*` are hidden one-release compatibility only.

## Durable security contract

- Supabase service-role-only tables store authorization requests, sessions, token hashes, refresh generations and consents. Raw tokens and proofs are never stored.
- Request state is `pending -> approved|denied|expired -> consumed`; approval, exchange and rotation are atomic. Replay fails closed and refresh reuse revokes the token family.
- A single server-side principal resolver accepts confirmed Supabase browser JWTs, scoped agent tokens and explicit service-token compatibility. It always returns the real user ID for account membership checks.
- Missing/invalid authentication is HTTP 401. Valid authentication without scope, active membership or role is HTTP 403. Completed protected mutations replay the exact stored result through `Idempotency-Key`; reusing a key with another payload returns 409.
- Transition-release fail-closed deviation: if a mutation may have completed but its durable replay receipt cannot be confirmed, the key becomes a permanent `IDEMPOTENCY_INDETERMINATE` tombstone. The server never re-executes that mutation after a lease or restart; the agent must reconcile resource/workspace state. A transactional operation outbox is required before claiming exact crash-window replay.
- Production is fail-closed behind `SUPERSKILL_AGENT_AUTH_ENABLED`; enabling requires a strong `SUPERSKILL_AGENT_TOKEN_PEPPER` and the durable migration.

## Native OAuth follow-up

The transition release does not advertise an authorization server. `/.well-known/oauth-authorization-server` stays 404.

After clean Codex and Claude proof, add a separate protected `/mcp/account` endpoint using Authorization Code + PKCE S256, exact redirects, resource indicators, DCR, rotating refresh tokens and real HTTP 401 `WWW-Authenticate` challenges. The anonymous `/mcp` endpoint remains read-only. Do not enable OAuth metadata before both clients pass.

## Release gates

Before the transition release:

1. Unit/integration coverage for atomic exchange, replay, rotation, revocation, client/scope binding, membership expiry and idempotent mutations.
2. Browser coverage for Google, GitHub, confirmed email, denial, expiry, refresh and fragment scrubbing.
3. Clean Codex and Claude Code E2E: install, one new task, anonymous search, browser sign-in, same-task protected retry, workspace create, publish/update, install and revoke.
4. All repository check, smoke, MCP, plugin and SuperSkill gates pass.
5. An independent reviewer compares runtime behavior to this document; all actionable findings are fixed before deploy and production is reviewed again after deploy.

The final compatibility removal release is gated by at least 14 days of production observation, two consecutive clean-client passes, auth success at or above 95%, no legacy device starts for 72 hours and no open security findings.
