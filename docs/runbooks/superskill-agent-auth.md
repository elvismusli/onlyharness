# SuperSkill agent authorization broker

## Normal user flow

The project-local `superskill_local` MCP owns sign-in. A protected tool without the required scoped session returns `AUTH_PENDING`, opens the browser, waits through `auth_wait`, then retries the original tool once with the same idempotency key. Users do not copy credentials, run `eval`, open a separate terminal or restart the client after authorization.

The browser URL is `https://superskill.sh/#/superskill/connect?request=...&proof=...`. Both values are inside the URL fragment and therefore do not reach the web server. The page immediately posts the proof to `browser-bind`, receives a short-lived HttpOnly binding cookie, and scrubs the proof from browser history before loading request context.

## HTTP contract

| Method | Route | Credential | Purpose |
| --- | --- | --- | --- |
| `POST` | `/auth/agent/start` | none | Create a scoped ten-minute request for `codex`, `claude-code` or `cli`. |
| `POST` | `/auth/agent/browser-bind` | browser proof in JSON | Consume the browser proof and set the short-lived binding cookie. |
| `GET` | `/auth/agent/context?request_id=...` | binding cookie | Return sanitized client, scopes, state and expiry. |
| `POST` | `/auth/agent/decision` | binding cookie; confirmed Supabase bearer for approval | Explicitly approve or deny. Denial does not require sign-in. |
| `POST` | `/auth/agent/token` | request ID and device proof in JSON | Poll, then consume the approved request exactly once. |
| `POST` | `/auth/agent/refresh` | rotating refresh credential in JSON | Return a new memory-only access token and replacement refresh credential. |
| `POST` | `/auth/agent/revoke` | access bearer or refresh credential | Revoke the whole session family. |

Access tokens use the `ohat_` prefix, last ten minutes, and stay only in the local process. Refresh credentials use `ohrt_`, have a maximum absolute lifetime of 30 days, rotate on every use and may be stored only in the OS credential store. Refresh reuse revokes the whole session.

## Scopes and authorization

- `superskill:managed`: managed recommendation and activation lifecycle.
- `resources:publish`: public resource publishing and immutable updates.
- `workspaces:read`: member workspace/catalog/setup reads.
- `workspaces:write`: workspace creation and authorized member/resource mutations.

Scope is only the first gate. Managed access still requires the current active grant; workspace operations still require current membership, expiry and role checks. Invalid authentication returns 401; insufficient scope, grant, membership or role returns 403.

Protected mutations use a caller-generated `Idempotency-Key`. Completed calls replay the stored response. If response persistence is indeterminate, the key is permanently blocked and must not be retried automatically; reconcile the workspace or resource state instead. This fail-closed behavior prevents duplicate publishing until the transactional outbox follow-up is shipped.

## Production configuration

- Apply `supabase/migrations/20260714170000_agent_first_auth.sql` before enabling the feature.
- Set `SUPERSKILL_AGENT_AUTH_ENABLED=true` only after the migration exists.
- Generate a distinct server-only `SUPERSKILL_AGENT_TOKEN_PEPPER` with at least 32 random bytes.
- Keep `SUPERSKILL_AGENT_ACCESS_TTL_SECONDS=600` and `SUPERSKILL_AGENT_SESSION_TTL_SECONDS=2592000` for the release contract.
- Keep `SUPERSKILL_DEVICE_AUTH_ENABLED=true` during the single compatibility release only.
- Configure Google and GitHub in Supabase Auth and verify both real browser callbacks. Email confirmation remains mandatory.

## Incident response

1. Set `SUPERSKILL_AGENT_AUTH_ENABLED=false` to stop new starts, refresh and token resolution; anonymous catalog routes remain available.
2. Revoke a compromised session through `/auth/agent/revoke`; refresh reuse also revokes it automatically.
3. Rotate `SUPERSKILL_AGENT_TOKEN_PEPPER` only as a global logout event, because all outstanding agent credentials become invalid.
4. Never log request bodies on `/auth/agent/*`. Redact `Authorization`, `Cookie`, `Set-Cookie`, proof, token, state and email fields.
5. Keep `/.well-known/oauth-authorization-server` at 404 until the separate native MCP OAuth release passes clean Codex and Claude verification.
