import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const compose = readFileSync(path.join(root, "infra/production-compose.yml"), "utf8");
const envExample = readFileSync(path.join(root, "infra/production.env.example"), "utf8");
const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");
const smokeCompose = readFileSync(path.join(root, "scripts/smoke-production-compose.sh"), "utf8");
const deployProduction = readFileSync(path.join(root, "scripts/deploy-production.sh"), "utf8");
const caddyfile = readFileSync(path.join(root, "infra/Caddyfile"), "utf8");
const apiDockerfile = readFileSync(path.join(root, "infra/api.Dockerfile"), "utf8");
const workspacePreviewSmoke = readFileSync(path.join(root, "scripts/smoke-workspace-preview.mjs"), "utf8");
const sharePngCheck = readFileSync(path.join(root, "scripts/check-share-png.mjs"), "utf8");
const shareFontCheck = readFileSync(path.join(root, "scripts/check-share-fonts.mjs"), "utf8");
const shareUnicodeRenderCheck = readFileSync(path.join(root, "scripts/check-share-unicode-render.mjs"), "utf8");
const standaloneSuperSkillRedirect = sectionBetween(caddyfile, "www.superskill.sh {", "superskill.sh {", "standalone SuperSkill redirect site");
const standaloneMachineRoutes = sectionBetween(caddyfile, "(superskill_machine_routes) {", "www.superskill.sh {", "standalone machine routes");
const standaloneSuperSkillSite = sectionBetween(caddyfile, "superskill.sh {", "onlyharness.com, www.onlyharness.com {", "standalone SuperSkill site");
const systemSuperSkillRedirect = sectionBetween(deployProduction, "www.superskill.sh {", "superskill.sh {", "system SuperSkill redirect site");

const apiRuntimeEnv = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "HARNESS_PUBLIC_API_URL",
  "HARNESS_CHECKOUT_BASE_URL",
  "HARNESS_LOG_LEVEL",
  "PAYMENTS_ENABLED",
  "PAYMENT_PROVIDER",
  "X402_ENABLED",
  "X402_PAY_TO",
  "X402_NETWORK",
  "X402_ASSET",
  "X402_FACILITATOR_URL",
  "X402_FACILITATOR_TOKEN",
  "X402_FACILITATOR_API_KEY",
  "X402_MAX_TIMEOUT_SECONDS",
  "ORGS_ENABLED",
  "WORKSPACES_ENABLED",
  "SUPERSKILL_ENABLED",
  "SUPERSKILL_INDEX_PATH",
  "SUPERSKILL_HISTORY_PATH",
  "SUPERSKILL_REVOCATIONS_PATH",
  "SUPERSKILL_TOKEN_HASHES",
  "SUPERSKILL_TELEMETRY_SALT",
  "SUPERSKILL_TELEMETRY_ENABLED",
  "SUPERSKILL_SUBJECT_SALT",
  "SUPERSKILL_AGENT_AUTH_ENABLED",
  "SUPERSKILL_AGENT_TOKEN_PEPPER",
  "SUPERSKILL_AGENT_ACCESS_TTL_SECONDS",
  "SUPERSKILL_AGENT_SESSION_TTL_SECONDS",
  "SUPERSKILL_DEVICE_AUTH_ENABLED",
  "COMMUNITY_INVITE_SECRET",
  "HARNESS_WEBHOOK_TOKEN",
  "HOSTED_RESOURCE_PUBLISH_ENABLED",
  "RESOURCE_ARCHIVE_DIR",
  "RESOURCE_IMPORT_ARCHIVE_DIR",
  "RESOURCE_IMPORT_READ_ENABLED",
  "RESOURCE_RELEASES_USE_LOCAL_STORE"
] as const;

const exampleEnv = [
  "VITE_HARNESS_API_URL",
  "VITE_DEFAULT_SKIN",
  "VITE_ENABLE_SKIN_SWITCHER",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "HARNESS_PUBLIC_API_URL",
  "HARNESS_CHECKOUT_BASE_URL",
  "HARNESS_LOG_LEVEL",
  "PAYMENTS_ENABLED",
  "PAYMENT_PROVIDER",
  "X402_ENABLED",
  "X402_PAY_TO",
  "X402_NETWORK",
  "X402_ASSET",
  "X402_FACILITATOR_URL",
  "X402_FACILITATOR_TOKEN",
  "X402_FACILITATOR_API_KEY",
  "X402_MAX_TIMEOUT_SECONDS",
  "ORGS_ENABLED",
  "WORKSPACES_ENABLED",
  "SUPERSKILL_ENABLED",
  "SUPERSKILL_INDEX_PATH",
  "SUPERSKILL_HISTORY_PATH",
  "SUPERSKILL_REVOCATIONS_PATH",
  "SUPERSKILL_TOKEN_HASHES",
  "SUPERSKILL_TELEMETRY_SALT",
  "SUPERSKILL_TELEMETRY_ENABLED",
  "SUPERSKILL_SUBJECT_SALT",
  "SUPERSKILL_AGENT_AUTH_ENABLED",
  "SUPERSKILL_AGENT_TOKEN_PEPPER",
  "SUPERSKILL_AGENT_ACCESS_TTL_SECONDS",
  "SUPERSKILL_AGENT_SESSION_TTL_SECONDS",
  "SUPERSKILL_DEVICE_AUTH_ENABLED",
  "COMMUNITY_INVITE_SECRET",
  "GITEA_BASE_URL",
  "HARNESS_WEBHOOK_TOKEN",
  "HOSTED_RESOURCE_PUBLISH_ENABLED",
  "RESOURCE_ARCHIVE_DIR",
  "RESOURCE_IMPORT_ARCHIVE_DIR",
  "RESOURCE_IMPORT_READ_ENABLED",
  "RESOURCE_RELEASES_USE_LOCAL_STORE",
  "ONLYHARNESS_WEB_PORT"
] as const;

for (const name of apiRuntimeEnv) {
  check(compose.includes(`${name}:`), `production-compose.yml must pass ${name} to the API service`);
}

for (const name of exampleEnv) {
  check(new RegExp(`^${name}=`, "m").test(envExample), `production.env.example must document ${name}`);
}

check(compose.includes("PAYMENT_PROVIDER: ${PAYMENT_PROVIDER:-manual}"), "PAYMENT_PROVIDER must default to manual");
check(compose.includes("HARNESS_LOG_LEVEL: ${HARNESS_LOG_LEVEL:-info}"), "production API logging must default to info");
check((compose.match(/driver: local/g) ?? []).length === 2, "production API and web logs must use the bounded Docker local driver");
check((compose.match(/max-size: \"20m\"/g) ?? []).length === 2 && (compose.match(/max-file: \"5\"/g) ?? []).length === 2, "production container logs must keep five bounded 20 MB files");
check(compose.includes("X402_ENABLED: ${X402_ENABLED:-false}"), "X402_ENABLED must default off");
check(compose.includes("SUPERSKILL_ENABLED: ${SUPERSKILL_ENABLED:-false}"), "SUPERSKILL_ENABLED must default off");
check(compose.includes("SUPERSKILL_AGENT_AUTH_ENABLED: ${SUPERSKILL_AGENT_AUTH_ENABLED:-false}"), "agent auth must default off until its durable store and secrets are ready");
check(compose.includes("SUPERSKILL_AGENT_ACCESS_TTL_SECONDS: ${SUPERSKILL_AGENT_ACCESS_TTL_SECONDS:-600}"), "agent access tokens must default to ten minutes");
check(compose.includes("SUPERSKILL_AGENT_SESSION_TTL_SECONDS: ${SUPERSKILL_AGENT_SESSION_TTL_SECONDS:-2592000}"), "agent refresh sessions must have a thirty-day absolute lifetime");
check(compose.includes("SUPERSKILL_DEVICE_AUTH_ENABLED: ${SUPERSKILL_DEVICE_AUTH_ENABLED:-true}"), "the transition release must keep an explicit legacy device rollback flag");
check(compose.includes("HOSTED_RESOURCE_PUBLISH_ENABLED: ${HOSTED_RESOURCE_PUBLISH_ENABLED:-false}"), "hosted public resource publishing must default off");
check(compose.includes("${RESOURCE_ARCHIVE_DIR:-/var/lib/onlyharness/resource-archives}:${RESOURCE_ARCHIVE_DIR:-/var/lib/onlyharness/resource-archives}:ro"), "the existing resource archive mirror must stay read-only during containment");
check(compose.includes("${RESOURCE_IMPORT_ARCHIVE_DIR:-/var/lib/onlyharness/resource-import-archives}:${RESOURCE_IMPORT_ARCHIVE_DIR:-/var/lib/onlyharness/resource-import-archives}:rw"), "public resource imports must use a separate writable persistent archive mount");
check(compose.includes("RESOURCE_IMPORT_READ_ENABLED: ${RESOURCE_IMPORT_READ_ENABLED:-true}"), "import archive read routing must have an explicit rollback switch");
check(compose.includes("RESOURCE_RELEASES_USE_LOCAL_STORE: ${RESOURCE_RELEASES_USE_LOCAL_STORE:-false}"), "production resource releases must default to the Supabase durable store");
check(envExample.includes("RESOURCE_RELEASES_USE_LOCAL_STORE=false"), "production.env.example must keep the local release-store fallback off");
check(readFileSync(path.join(root, "infra/production-smoke.override.yml"), "utf8").includes('RESOURCE_RELEASES_USE_LOCAL_STORE: "true"'), "production compose smoke must isolate resource releases from production Supabase rows");
check(!compose.includes("${RESOURCE_ARCHIVE_DIR:-/var/lib/onlyharness/resource-archives}:${RESOURCE_ARCHIVE_DIR:-/var/lib/onlyharness/resource-archives}:rw"), "legacy resource archive mirror must never become a write target");
check(compose.includes("VITE_DEFAULT_SKIN: ${VITE_DEFAULT_SKIN:-superskill}"), "production web must default to the SuperSkill product surface");
check(apiDockerfile.includes("npm run build -w @harnesshub/capability-schema -w @harnesshub/api"), "API image must build the shared capability runtime before its consumers");
check(apiDockerfile.includes("ENV NODE_OPTIONS=--conditions=runtime-built"), "API runtime must resolve built shared package exports instead of TypeScript source files");
check(compose.includes("VITE_ENABLE_SKIN_SWITCHER: ${VITE_ENABLE_SKIN_SWITCHER:-false}"), "production skin switcher must default off");
check(compose.includes("https://superskill.sh,https://www.superskill.sh"), "production API CORS must allow both SuperSkill hostnames");
check(compose.includes("HARNESS_PUBLIC_API_URL: ${HARNESS_PUBLIC_API_URL:-https://superskill.sh/api}"), "HARNESS_PUBLIC_API_URL must default to the canonical SuperSkill API");
check(compose.includes("HARNESS_CHECKOUT_BASE_URL: ${HARNESS_CHECKOUT_BASE_URL:-https://superskill.sh/checkout}"), "HARNESS_CHECKOUT_BASE_URL must default to the canonical SuperSkill checkout route");
check(envExample.includes("X402_ENABLED=false"), "production.env.example must keep x402 off by default");
check(envExample.includes("PAYMENTS_ENABLED=false"), "production.env.example must keep payments off by default");
check(envExample.includes("HARNESS_LOG_LEVEL=info"), "production.env.example must document the production API log level");
check(envExample.includes("ORGS_ENABLED=false"), "production.env.example must keep orgs off by default");
check(envExample.includes("WORKSPACES_ENABLED=false"), "production.env.example must keep workspaces off by default");
check(envExample.includes("SUPERSKILL_ENABLED=false"), "production.env.example must keep SuperSkill managed routes off by default");
check(envExample.includes("SUPERSKILL_AGENT_AUTH_ENABLED=false"), "production.env.example must keep agent auth off until explicitly enabled");
check(envExample.includes("SUPERSKILL_AGENT_TOKEN_PEPPER=\n"), "production.env.example must document the server-only agent token pepper without a value");
check(envExample.includes("HOSTED_RESOURCE_PUBLISH_ENABLED=false"), "production.env.example must keep hosted public resource publishing off by default");
check(envExample.includes("RESOURCE_IMPORT_ARCHIVE_DIR=/var/lib/onlyharness/resource-import-archives"), "production.env.example must document the dedicated import archive directory");
check(envExample.includes("VITE_DEFAULT_SKIN=superskill"), "production.env.example must default to the SuperSkill product surface");
check(envExample.includes("VITE_HARNESS_API_URL=https://superskill.sh/api"), "production web must use the canonical SuperSkill API origin");
check(envExample.includes("HARNESS_PUBLIC_API_URL=https://superskill.sh/api"), "production API links must use the canonical SuperSkill origin");
check(envExample.includes("VITE_ENABLE_SKIN_SWITCHER=false"), "production.env.example must keep the skin switcher off by default");
check(gitignore.split("\n").includes("infra/production.env"), "infra/production.env must stay gitignored");
check(smokeCompose.includes('VITE_HARNESS_API_URL="${VITE_HARNESS_API_URL:-$BASE_URL/api}"'), "production compose smoke must build the web UI against the local smoke API");
check(smokeCompose.includes('for seed_dir in directories resources'), "production compose smoke must hydrate both directory and resource seed data into the API volume");
check(smokeCompose.includes("probeResourceImportArchiveStorage"), "production compose smoke must execute the real writable import storage probe");
check(smokeCompose.includes('$BASE_URL/api/resources?q=superpowers&limit=1'), "production compose smoke must verify seeded resources");
check(smokeCompose.includes('$BASE_URL/api/showroom/selected?limit=12'), "production compose smoke must verify selected SuperSkill intake cards");
check(smokeCompose.includes('SMOKE_AUTH_RATE_LIMIT_OK="${SMOKE_AUTH_RATE_LIMIT_OK:-1}"'), "production compose smoke must soft-skip external Supabase auth rate limits by default");
check(smokeCompose.includes('$BASE_URL/checkout?owner=harnesses&repo=deep-market-researcher'), "production compose smoke must verify checkout deep links fall back to the SPA");
check(smokeCompose.includes('[[ "$index_html" == *"SuperSkill"* ]]'), "production compose smoke must verify the SuperSkill product identity");
check(smokeCompose.includes('$BASE_URL/r/$share_key') && smokeCompose.includes('$BASE_URL/og/r/$share_key'), "production compose smoke must verify crawler HTML and PNG share previews");
check(smokeCompose.includes('$BASE_URL/c/deep-market-researcher') && smokeCompose.includes('$BASE_URL/og/c/deep-market-researcher'), "production compose smoke must verify managed capability share previews");
check(smokeCompose.includes("check-share-png.mjs") && deployProduction.includes("check-share-png.mjs"), "production preview smokes must verify rendered text rather than PNG dimensions only");
check(sharePngCheck.includes("darkTitlePixels") && sharePngCheck.includes("darkTitlePixels < 600"), "share PNG checker must fail when dynamic title fonts are missing");
check(smokeCompose.includes("check-share-fonts.mjs") && deployProduction.includes("check-share-fonts.mjs"), "production preview smokes must verify bundled Unicode font coverage inside the API container");
check(shareFontCheck.includes('"Arabic"') && shareFontCheck.includes('"Han"') && shareFontCheck.includes('"Hangul"'), "share font checker must cover major non-Latin preview scripts");
check(smokeCompose.includes("check-share-unicode-render.mjs") && deployProduction.includes("check-share-unicode-render.mjs"), "production preview smokes must verify deterministic non-Latin glyph rendering inside the API container");
check(shareUnicodeRenderCheck.includes('"Arabic"') && shareUnicodeRenderCheck.includes('"Han"') && shareUnicodeRenderCheck.includes("tofuPng"), "Unicode share canary must reject tofu glyph output without platform-specific hashes");
check(smokeCompose.includes('$BASE_URL/manifest.webmanifest') && smokeCompose.includes('$BASE_URL/favicon.ico'), "production compose smoke must verify real brand assets");
check(smokeCompose.includes('[[ "$checkout_html" == *"SuperSkill"* ]]'), "production compose smoke must verify SuperSkill checkout identity");
check(!smokeCompose.includes('[[ "$checkout_html" == *"OnlyHarness"* ]]'), "production compose smoke must reject the legacy checkout identity");
check(smokeCompose.includes("oauth-authorization-server") && smokeCompose.includes("= \"404\""), "production compose smoke must prove vanity OAuth AS discovery fails closed");
check(standaloneSuperSkillRedirect.includes("\tredir https://superskill.sh{uri} permanent"), "standalone Caddy must permanently redirect www.superskill.sh to the apex while preserving the URI");
check(standaloneSuperSkillRedirect.includes("Strict-Transport-Security"), "standalone SuperSkill redirect must preserve HSTS");
check(caddyfile.includes("superskill.sh {"), "standalone Caddy must serve the SuperSkill apex");
check(caddyfile.includes("trusted_proxies static private_ranges") && caddyfile.includes("trusted_proxies_strict"), "standalone Caddy must validate the private reverse-proxy chain");
check(standaloneSuperSkillSite.includes("request>uri regexp") && standaloneSuperSkillSite.includes("request>remote_ip ip_mask"), "standalone SuperSkill access logs must strip query values and mask client IPs");
check(standaloneSuperSkillSite.includes("@share_preview path /r/* /c/* /w/* /og/*"), "standalone Caddy must route crawler-visible previews only on the SuperSkill site");
check(!standaloneMachineRoutes.includes("@share_preview"), "standalone Caddy must not expose human share previews through the legacy machine-route import");
check(caddyfile.includes("onlyharness.com, www.onlyharness.com {"), "standalone Caddy must retain legacy machine compatibility hosts");
check(caddyfile.includes("redir https://superskill.sh{uri} permanent"), "standalone Caddy must redirect legacy human pages to SuperSkill");
check(!caddyfile.includes("onlyharness.com, www.onlyharness.com, superskill.sh, www.superskill.sh {"), "standalone Caddy must not serve www.superskill.sh as an HTML origin");
check(deployProduction.includes('RUN_DEPLOY_SMOKE="${RUN_DEPLOY_SMOKE:-1}"'), "deploy-production.sh must run public smoke by default");
check(deployProduction.includes("for required_auth_var in VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY"), "deploy-production.sh must fail before mutation when production auth config is missing");
check(deployProduction.includes('configured_publish_flag="${configured_publish_flag:-false}"'), "deploy-production.sh must fail closed when the containment publish flag is missing");
check(deployProduction.includes('ALLOW_ENABLE_HOSTED_RESOURCE_PUBLISH'), "deploy-production.sh must require an explicit operator opt-in before enabling hosted resource publishing");
check(deployProduction.includes('ALLOW_ENABLE_SUPERSKILL_AGENT_AUTH'), "deploy-production.sh must require an explicit operator opt-in before enabling agent auth");
check(deployProduction.includes('SUPERSKILL_AGENT_TOKEN_PEPPER must contain at least 32'), "deploy-production.sh must reject an enabled agent auth service without a strong server-only pepper");
check(deployProduction.includes('SUPERSKILL_AGENT_ACCESS_TTL_SECONDS must be 600'), "deploy-production.sh must enforce the ten-minute access token contract");
check(deployProduction.includes('SUPERSKILL_AGENT_SESSION_TTL_SECONDS must be 2592000'), "deploy-production.sh must enforce the thirty-day absolute session contract");
check(deployProduction.includes('COMPOSE_AUTH_CONTRACT_READY'), "deploy-production.sh must verify the rendered agent-auth compose contract before mutation");
check(deployProduction.includes('env -u SUPERSKILL_AGENT_AUTH_ENABLED') && deployProduction.includes('-u SUPERSKILL_AGENT_TOKEN_PEPPER'), "deploy-production.sh must prevent caller shell variables from overriding the approved agent-auth env file");
check(deployProduction.includes('actualPepperDigest === pepperDigest'), "deploy-production.sh must verify the exact approved pepper without printing it");
check(deployProduction.includes("SUPERSKILL_SUBJECT_SALT_PATH") && deployProduction.includes("openssl rand -hex 32"), "deploy-production.sh must provision a stable server-only user-subject salt");
check(deployProduction.includes("'^SUPERSKILL_SUBJECT_SALT='") && deployProduction.includes("tr -d '\\r\\n' < \"$SUPERSKILL_SUBJECT_SALT_PATH\""), "deploy-production.sh must inject the persistent subject salt without logging it");
check(deployProduction.includes('RESOURCE_IMPORT_ARCHIVE_DIR must be an absolute traversal-free path'), "deploy-production.sh must validate the writable import archive bind path before mutation");
check(deployProduction.includes(`HOSTED_RESOURCE_PUBLISH_ENABLED='$configured_publish_flag' docker compose`), "deploy-production.sh must pass the reviewed publish mode to compose commands after removing shell auth overrides");
check(deployProduction.includes('environment.HOSTED_RESOURCE_PUBLISH_ENABLED === publish'), "deploy-production.sh must verify the rendered publish mode inside the unified compose contract");
check(deployProduction.includes('for seed_dir in directories resources'), "deploy-production.sh must hydrate both directory and resource seed data into the API volume");
check(deployProduction.includes('$PUBLIC_BASE_URL/api/resources?q=superpowers&limit=1'), "deploy-production.sh must smoke seeded resources after deploy");
check(deployProduction.includes('${process.env.PUBLIC_BASE_URL}/api/auth/agent/start') && deployProduction.includes('AGENT_AUTH_START_READY'), "deploy-production.sh must smoke durable agent-auth start when the feature is enabled");
check(!deployProduction.includes('agent_auth_response="$(mktemp)"'), "deploy-production.sh must never persist raw agent auth proofs during smoke");
check(deployProduction.includes('AGENT_AUTH_UNAVAILABLE'), "deploy-production.sh must verify fail-closed agent auth during a dark deploy");
check(deployProduction.includes('RESOURCE_ARCHIVE_NOT_HOSTED'), "deploy-production.sh must prove external legacy mirrors remain open-only after deploy");
check(deployProduction.includes('$PUBLIC_BASE_URL/api/imports/resource-package'), "deploy-production.sh must smoke the public hosted resource publish containment gate");
check(deployProduction.includes('"code":"AUTH_REQUIRED"'), "deploy-production.sh must prove public publish authenticates before reporting containment state");
check(deployProduction.includes('DEPLOY_SMOKE_ACCESS_TOKEN is required for authenticated containment proof'), "deploy-production.sh must require authenticated publish-route evidence");
check(deployProduction.includes("probeResourceImportArchiveStorage"), "deploy-production.sh must run create/fsync/rename/read/delete import storage probe before traffic switch");
check(deployProduction.includes("verifyResourceReleaseInventory"), "deploy-production.sh must fail closed on active archive digest/size parity before traffic switch");
check(deployProduction.indexOf("probeResourceImportArchiveStorage") < deployProduction.indexOf("up -d --no-build"), "deploy storage preflight must complete before traffic starts");
check(deployProduction.indexOf('DEPLOY_SMOKE_ACCESS_TOKEN is required for authenticated containment proof') < deployProduction.indexOf('ssh -o BatchMode=yes'), "deploy-production.sh must require the authenticated smoke token before the first production mutation");
check(deployProduction.includes('"code":"PUBLISH_DISABLED"') && deployProduction.includes('"code":"VALIDATION_FAILED"'), "deploy-production.sh must prove the authenticated publish route matches the selected rollout mode without creating a release");
check(deployProduction.includes('$PUBLIC_BASE_URL/api/showroom/selected?limit=12'), "deploy-production.sh must smoke selected SuperSkill intake cards after deploy");
check(deployProduction.includes('$PUBLIC_BASE_URL/r/$share_key') && deployProduction.includes('$PUBLIC_BASE_URL/og/r/$share_key'), "deploy-production.sh must smoke crawler HTML and PNG share previews after deploy");
check(deployProduction.includes('$PUBLIC_BASE_URL/c/deep-market-researcher') && deployProduction.includes('$PUBLIC_BASE_URL/og/c/deep-market-researcher'), "deploy-production.sh must smoke managed capability share previews after deploy");
check(deployProduction.includes("scripts/smoke-workspace-preview.mjs"), "deploy-production.sh must smoke a bounded authenticated workspace preview after deploy");
check(workspacePreviewSmoke.includes('name="robots" content="noindex,nofollow,noarchive"') && workspacePreviewSmoke.includes("ohwi_") && workspacePreviewSmoke.includes("private/no-store"), "workspace preview smoke must prove noindex, no-store and raw invite containment");
check(deployProduction.includes('$PUBLIC_BASE_URL/manifest.webmanifest') && deployProduction.includes('$PUBLIC_BASE_URL/favicon.ico'), "deploy-production.sh must smoke the new brand assets after deploy");
check(deployProduction.includes('$PUBLIC_BASE_URL/mcp'), "deploy-production.sh must smoke the public MCP endpoint");
check(systemSuperSkillRedirect.includes("\tredir https://superskill.sh{uri} permanent"), "deploy-production.sh must permanently redirect www.superskill.sh to the apex while preserving the URI");
check(systemSuperSkillRedirect.includes("Strict-Transport-Security"), "system SuperSkill redirect must preserve HSTS");
check(deployProduction.includes("superskill.sh {"), "deploy-production.sh must serve the SuperSkill apex");
check(deployProduction.includes("superskill-access.log") && deployProduction.includes("roll_size 20MiB") && deployProduction.includes("roll_keep 5"), "system Caddy must write bounded SuperSkill access logs");
check(deployProduction.includes("chown caddy:caddy /var/log/caddy/superskill-access.log"), "system Caddy access log must stay writable by the service user after validation");
check(deployProduction.includes('header_up X-Forwarded-For {remote_host}'), "system Caddy must overwrite the external client forwarding header");
check(deployProduction.includes('request>uri regexp "\\\\?.*$" ""'), "system Caddy access logs must strip all query values");
check(deployProduction.includes("onlyharness.com, www.onlyharness.com {"), "deploy-production.sh must retain legacy machine compatibility hosts");
check(!deployProduction.includes("onlyharness.com, www.onlyharness.com, superskill.sh, www.superskill.sh {"), "deploy-production.sh must not serve www.superskill.sh as an HTML origin");
check(deployProduction.includes('SUPERSKILL_APEX_URL="${SUPERSKILL_APEX_URL:-https://superskill.sh}"'), "deploy-production.sh must default the canonical SuperSkill apex smoke URL");
check(deployProduction.includes('SUPERSKILL_WWW_URL="${SUPERSKILL_WWW_URL:-https://www.superskill.sh}"'), "deploy-production.sh must default the SuperSkill redirect smoke URL");
check(deployProduction.includes('$SUPERSKILL_WWW_URL/deploy-canonical-smoke?source=deploy'), "deploy-production.sh must smoke the www SuperSkill redirect with path and query");
check(deployProduction.includes('location: $SUPERSKILL_APEX_URL/deploy-canonical-smoke?source=deploy'), "deploy-production.sh must verify the canonical SuperSkill redirect target");
check(deployProduction.includes('production_index="$(curl -fsS "$SUPERSKILL_APEX_URL/")"'), "deploy-production.sh must smoke the SuperSkill apex HTML origin");
check(deployProduction.includes('grep -q \'SuperSkill\' <<<"$production_index"'), "deploy-production.sh must verify the SuperSkill apex identity");
check(deployProduction.includes('"name":"search_resources"'), "deploy-production.sh must smoke the MCP resource search tool");
check(deployProduction.includes('$PUBLIC_BASE_URL/checkout?owner=harnesses&repo=deep-market-researcher'), "deploy-production.sh must smoke checkout deep links after deploy");
check(deployProduction.includes('provider_ref=manual_deploy_smoke" | grep -q "SuperSkill"'), "deploy-production.sh must verify SuperSkill checkout identity");
check(!deployProduction.includes('provider_ref=manual_deploy_smoke" | grep -q "OnlyHarness"'), "deploy-production.sh must reject the legacy checkout identity");
check(deployProduction.includes('"name"[[:space:]]*:[[:space:]]*"superskill"'), "deploy-production.sh must verify the SuperSkill MCP runtime identity");
check(!deployProduction.includes('"name"[[:space:]]*:[[:space:]]*"onlyharness"'), "deploy-production.sh must reject the legacy MCP runtime identity");
check(deployProduction.includes("oauth-authorization-server") && deployProduction.includes("= \"404\""), "deploy-production.sh must prove vanity OAuth AS discovery fails closed");

console.log("Production config check passed: compose env, canonical Caddy hosts, example env, and deploy smokes are in sync");

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sectionBetween(source: string, start: string, end: string, label: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  check(startIndex >= 0 && endIndex > startIndex, `Missing ${label}`);
  return source.slice(startIndex, endIndex);
}
