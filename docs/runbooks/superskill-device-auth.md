# SuperSkill CLI device authorization

## User flow

From a trusted terminal, after installing the pinned CLI:

```bash
eval "$(hh auth login --shell --client codex)"
```

Use `--client claude-code` for Claude Code. The command writes only the static verification URL and a one-time human code to stderr. Open the Account page, sign in with a confirmed email, enter the code, and approve the terminal. Successful stdout is exactly one `export HH_TOKEN='…'` command for the current shell; no token is written to disk.

Start the agent client from that terminal so `superskill_local` inherits `HH_TOKEN`. The HMAC bearer is scoped to `superskill:managed` and expires in at most 30 minutes.

## HTTP contract

| Method | Route | Credential | Purpose |
| --- | --- | --- | --- |
| `POST` | `/auth/device/start` | none | Create a 10-minute one-time session and static verification URL. |
| `POST` | `/auth/device/approve` | live Supabase browser bearer | Confirm email, apply the audited short-lived managed grant, and approve the user code. |
| `POST` | `/auth/device/token` | high-entropy device code in JSON body | Poll, then consume the approved session exactly once. |

User and device codes are never accepted in URLs. Sessions keep only HMAC hashes of both codes, have bounded storage and request rates, and disappear on expiry or process restart. Restart invalidation is intentional and fail-closed.

The browser never receives the terminal bearer. The terminal never receives the Supabase session. Managed requests verify the device token HMAC and then live-check both the confirmed Supabase user and current `superskill:managed` grant. A suspended, revoked, expired, malformed or replayed credential fails closed.

## Server configuration

Device auth uses the existing server-only values:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPERSKILL_SUBJECT_SALT` (at least 32 bytes)

The signing key is derived from `SUPERSKILL_SUBJECT_SALT` with the domain separator `superskill-device-auth-signing:v1`; the subject HMAC and device-token HMAC do not reuse the same derived key. Self-service approval calls `upsert_superskill_access_grant` as `self-service:device-auth`. Existing stronger active grants are not shortened or rewritten; suspended and revoked rows are not reopened.

## Security checks

- Do not run `hh auth login --shell` through an agent tool, CI log, or captured transcript.
- Do not paste `HH_TOKEN` into chat, config, localStorage, URLs, or project files.
- Keep API and CLI clocks synchronized; expiry is enforced server-side.
- A lost exchange response cannot be replayed. Start a new login.
- A server restart invalidates pending device sessions but not already issued short-lived tokens; token validity still depends on live user and grant checks.
