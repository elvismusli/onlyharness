# Agent-first surface for OnlyHarness: research + roadmap

Deep-research run 2026-07-06: 5 search angles, 25 primary sources fetched, 125 claims
extracted, top 25 adversarially verified (3 independent votes each) — **25 confirmed,
0 refuted**. Sources are first-party: GitHub changelog, Stripe docs, Cloudflare & Hugging
Face engineering blogs, the MCP spec and registry, agents.md, Linux Foundation, Anthropic
engineering. Confidence notes inline; the combined recommendation is medium-confidence
synthesis over high-confidence parts.

## The question

If the primary client of OnlyHarness is not a human in a browser but their personal
coding agent (Claude Code, Codex CLI, Cursor…), how should the service be organized so
an agent never gets lost and can use the full functionality?

## What the 2026 canon looks like (verified)

1. **A hosted remote MCP server is THE first-party agent surface.** GitHub (GA
   2025-09-04), Stripe (mcp.stripe.com), Cloudflare (13 public servers, 2025-05-01) and
   Hugging Face (hf.co/mcp) all ship one; every MCP-compatible host (Claude Code, Cursor,
   Copilot, ChatGPT, Windsurf — HF counted **164 distinct client apps in one week**)
   consumes the service through a single endpoint, installable with one command
   (`claude mcp add --transport http …`). The MCP server *layers on top of* the REST API,
   it does not replace it.

2. **Transport: Streamable HTTP, stateless, direct-response.** SSE is deprecated
   (removed in spec 2025-03-26); HF explicitly chose stateless direct-response for
   production because the client zoo is chaotic (old transports, stray pings, ~100
   control messages per tool call).

3. **Tool design: meta-tools, not tool-per-endpoint.** Stripe covers hundreds of
   endpoints with ~a dozen tools: `search` → `details` → `read`/`write`, plus a few
   curated high-frequency tools. Rationale: full API access without blowing the agent's
   context window. Cloudflare converged on the same shape (Code Mode: search()/execute()
   over ~2,500 endpoints). This ladder — search → inspect → execute — is the proven
   anti-lost pattern, and it maps 1:1 onto our existing API.

4. **Discovery: the official MCP Registry.** registry.modelcontextprotocol.io (preview
   2025-09-08, API frozen at v0.1 since 2025-10-24, live and receiving publishes in
   2026, backed by Anthropic/GitHub/Microsoft). You publish a `server.json` once;
   clients, subregistries and marketplaces pick it up. Bonus strategic fact: the
   registry is a **metaregistry** — metadata only, consumed via an OpenAPI spec that
   private registries can also implement. OnlyHarness already mirrors this
   metaregistry+archive architecture for harnesses.

5. **Repo-level guidance: AGENTS.md won.** 60k+ open-source projects (a verifier
   independently reproduced ~109k root-level files via GitHub code search), 23 tools
   (Codex, Jules, Gemini CLI, Copilot, Cursor, Devin, Aider, Zed, Warp…), stewarded by
   the Agentic AI Foundation (Linux Foundation) since 2025-12. **Claude Code does NOT
   read it** — it reads CLAUDE.md — so ship both, cross-referencing.

6. **Docs as a live tool.** Cloudflare ships a dedicated Documentation MCP server
   ("up-to-date documentation in real-time, rather than … outdated information from the
   model's training data") *alongside* llms.txt — the two complement each other.

7. **Auth: OAuth 2.1-first with API-key Bearer fallback; env keys for CLIs.** The MCP
   spec (2025-11-25) makes authorization OPTIONAL; HTTP servers SHOULD use the OAuth
   subset (OAuth 2.1 + RFC 8414 + RFC 9728), STDIO servers SHOULD NOT — they take
   credentials from the environment (env-var keys stay correct for `hh`). A protected
   HTTP MCP server **MUST publish RFC 9728 Protected Resource Metadata** at
   `/.well-known/oauth-protected-resource` (and/or `WWW-Authenticate: … resource_metadata`
   on 401) so the agent self-discovers the auth flow without a human. Since 2025-11-25,
   Dynamic Client Registration is demoted to MAY; Client ID Metadata Documents are the
   SHOULD path. In production: GitHub = OAuth 2.1 + PKCE recommended, PAT fully
   supported; Stripe = OAuth primary, restricted API key as Bearer for clients without
   OAuth — and restricted keys explicitly recommended for autonomous agents.

8. **Skills/plugins as distribution (weaker evidence, primary sources only).**
   Anthropic's skills directory (claude.com/connectors) hosts official vendor skills
   from Stripe, Cloudflare, Vercel, Netlify, Supabase, HF, Sentry и др.; a Claude Code
   plugin packages skills+MCP+hooks as one installable artifact; the SKILL.md format is
   an open standard adopted beyond Claude. This leg didn't survive top-25 verification
   cuts as "dominant practice" — treat as cheap, sensible, unproven-impact.

9. **Not verified / open:** whether agents actually fetch llms.txt at runtime (it's
   cheap insurance, not proven load-bearing); agent-friendly CLI conventions (--json,
   exit-code taxonomies, next-command errors) — practitioner blogs exist (Arcjet: exit
   codes 0/1=general/2=auth/3=validation/4=needs-confirmation, JSON errors on stderr,
   CLI-as-API-contract) but nothing survived as an industry standard.

## Gap analysis: OnlyHarness today vs the canon

| Leg | Status |
|---|---|
| HTTP API (search/detail/archive/publish) | ✅ have, shape already matches the meta-tool ladder |
| CLI (`hh` with env-key auth via HH_TOKEN) | ✅ have; spec-correct for local agents |
| llms.txt | ✅ have |
| **Remote MCP server** | ❌ missing — the single highest-impact gap |
| **server.json in the official MCP Registry** | ❌ missing |
| **RFC 9728 .well-known + OAuth-first auth on the remote surface** | ❌ missing (Supabase JWT Bearer only) |
| **AGENTS.md (+ CLAUDE.md)** | ❌ missing |
| docs_search live tool | ❌ missing (llms.txt is static) |
| OpenAPI spec for the REST API | ❌ missing (nice-to-have; registry consumers use it) |
| Vendor skill / Claude Code plugin | ❌ missing (P2, cheap) |

## Roadmap (priority = impact on "agent never gets lost")

**P0 — Remote MCP server at `https://onlyharness.com/mcp`.**
Streamable HTTP, stateless, direct-response. Meta-tools mirroring the REST API:
`search_harnesses`, `harness_details`, `pull_harness` (archive), `publish_harness`
(authed), `docs_search` (serves llms-full/README/harness docs live). Reads anonymous,
publish behind Bearer. Fastify already hosts the API — mount the MCP endpoint in the
same app (official TypeScript SDK supports stateless Streamable HTTP). One-command
install story: `claude mcp add --transport http onlyharness https://onlyharness.com/mcp`.

**P0 — AGENTS.md + CLAUDE.md** at repo root and served on the site; cross-link every
surface (API ↔ CLI ↔ MCP ↔ llms.txt) so any entry point names all the others. Also add
AGENTS.md to the harness scaffold (`hh import-md`) so *published harnesses* are
agent-readable too.

**P1 — server.json → official MCP Registry** (registry.modelcontextprotocol.io,
namespace e.g. `com.onlyharness/registry`). Publish once; 160+ clients' discovery
surfaces pick it up.

**P1 — Auth discovery:** `/.well-known/oauth-protected-resource` (RFC 9728) +
`WWW-Authenticate: resource_metadata` on 401 for the MCP surface. Keep
Supabase-JWT/HH_TOKEN Bearer as the fallback (Stripe pattern). Full OAuth 2.1 flow
(Supabase as AS or a thin proxy) can come later; .well-known + Bearer already unblocks
autonomous agents. Note: email confirmation is now enabled — document the token path
("log on at onlyharness.com → copy access token") in llms.txt/AGENTS.md until we ship
proper PATs.

**P1 — OpenAPI spec** at `/api/openapi.json`, linked from llms.txt (and reusable if we
later expose the harness registry itself via the MCP-registry OpenAPI shape — the
"subregistry" strategic option from finding 4).

**P2 — CLI polish** per practitioner consensus (unverified leg): `--json` on every
command (pull/run/doctor/publish still lack it), exit-code taxonomy, errors that name
the next command ("Not a harness directory. Try `hh pull <owner>/<name>` first." —
partially done).

**P2 — Vendor skill + Claude Code plugin** ("onlyharness" plugin: SKILL.md teaching
search→pull→run→eval→gate, bundling the MCP server config). Submit to the Anthropic
skills directory when open.

**Anti-goals:** no SSE transport; no tool-per-endpoint MCP; no A2A; don't replace the
REST API with MCP — layer.

## Open questions

- Is llms.txt actually fetched by major agents at runtime, or is the live docs_search
  tool doing the real work? (Ship both; measure.)
- When the MCP Registry GAs and the 2026-07-28 spec RC ratifies, re-check the auth
  requirements (verifiers report the RC *tightens* RFC 9728).
- Will Claude Code adopt AGENTS.md? Until then ship both files.
