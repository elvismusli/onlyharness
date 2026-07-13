import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const compose = readFileSync(path.join(root, "infra/production-compose.yml"), "utf8");
const envExample = readFileSync(path.join(root, "infra/production.env.example"), "utf8");
const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");
const smokeCompose = readFileSync(path.join(root, "scripts/smoke-production-compose.sh"), "utf8");
const deployProduction = readFileSync(path.join(root, "scripts/deploy-production.sh"), "utf8");
const caddyfile = readFileSync(path.join(root, "infra/Caddyfile"), "utf8");
const standaloneSuperSkillRedirect = sectionBetween(caddyfile, "www.superskill.sh {", "superskill.sh {", "standalone SuperSkill redirect site");
const systemSuperSkillRedirect = sectionBetween(deployProduction, "www.superskill.sh {", "superskill.sh {", "system SuperSkill redirect site");

const apiRuntimeEnv = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "HARNESS_PUBLIC_API_URL",
  "HARNESS_CHECKOUT_BASE_URL",
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
  "COMMUNITY_INVITE_SECRET",
  "HARNESS_WEBHOOK_TOKEN",
  "HOSTED_RESOURCE_PUBLISH_ENABLED",
  "RESOURCE_ARCHIVE_DIR",
  "RESOURCE_IMPORT_ARCHIVE_DIR",
  "RESOURCE_IMPORT_READ_ENABLED"
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
  "COMMUNITY_INVITE_SECRET",
  "GITEA_BASE_URL",
  "HARNESS_WEBHOOK_TOKEN",
  "HOSTED_RESOURCE_PUBLISH_ENABLED",
  "RESOURCE_ARCHIVE_DIR",
  "RESOURCE_IMPORT_ARCHIVE_DIR",
  "RESOURCE_IMPORT_READ_ENABLED",
  "ONLYHARNESS_WEB_PORT"
] as const;

for (const name of apiRuntimeEnv) {
  check(compose.includes(`${name}:`), `production-compose.yml must pass ${name} to the API service`);
}

for (const name of exampleEnv) {
  check(new RegExp(`^${name}=`, "m").test(envExample), `production.env.example must document ${name}`);
}

check(compose.includes("PAYMENT_PROVIDER: ${PAYMENT_PROVIDER:-manual}"), "PAYMENT_PROVIDER must default to manual");
check(compose.includes("X402_ENABLED: ${X402_ENABLED:-false}"), "X402_ENABLED must default off");
check(compose.includes("SUPERSKILL_ENABLED: ${SUPERSKILL_ENABLED:-false}"), "SUPERSKILL_ENABLED must default off");
check(compose.includes("HOSTED_RESOURCE_PUBLISH_ENABLED: ${HOSTED_RESOURCE_PUBLISH_ENABLED:-false}"), "hosted public resource publishing must default off");
check(compose.includes("${RESOURCE_ARCHIVE_DIR:-/var/lib/onlyharness/resource-archives}:${RESOURCE_ARCHIVE_DIR:-/var/lib/onlyharness/resource-archives}:ro"), "the existing resource archive mirror must stay read-only during containment");
check(compose.includes("${RESOURCE_IMPORT_ARCHIVE_DIR:-/var/lib/onlyharness/resource-import-archives}:${RESOURCE_IMPORT_ARCHIVE_DIR:-/var/lib/onlyharness/resource-import-archives}:rw"), "public resource imports must use a separate writable persistent archive mount");
check(compose.includes("RESOURCE_IMPORT_READ_ENABLED: ${RESOURCE_IMPORT_READ_ENABLED:-true}"), "import archive read routing must have an explicit rollback switch");
check(!compose.includes("${RESOURCE_ARCHIVE_DIR:-/var/lib/onlyharness/resource-archives}:${RESOURCE_ARCHIVE_DIR:-/var/lib/onlyharness/resource-archives}:rw"), "legacy resource archive mirror must never become a write target");
check(compose.includes("VITE_DEFAULT_SKIN: ${VITE_DEFAULT_SKIN:-superskill}"), "production web must default to the SuperSkill product surface");
check(compose.includes("VITE_ENABLE_SKIN_SWITCHER: ${VITE_ENABLE_SKIN_SWITCHER:-false}"), "production skin switcher must default off");
check(compose.includes("https://superskill.sh,https://www.superskill.sh"), "production API CORS must allow both SuperSkill hostnames");
check(compose.includes("HARNESS_PUBLIC_API_URL: ${HARNESS_PUBLIC_API_URL:-https://superskill.sh/api}"), "HARNESS_PUBLIC_API_URL must default to the canonical SuperSkill API");
check(compose.includes("HARNESS_CHECKOUT_BASE_URL: ${HARNESS_CHECKOUT_BASE_URL:-https://superskill.sh/checkout}"), "HARNESS_CHECKOUT_BASE_URL must default to the canonical SuperSkill checkout route");
check(envExample.includes("X402_ENABLED=false"), "production.env.example must keep x402 off by default");
check(envExample.includes("PAYMENTS_ENABLED=false"), "production.env.example must keep payments off by default");
check(envExample.includes("ORGS_ENABLED=false"), "production.env.example must keep orgs off by default");
check(envExample.includes("WORKSPACES_ENABLED=false"), "production.env.example must keep workspaces off by default");
check(envExample.includes("SUPERSKILL_ENABLED=false"), "production.env.example must keep SuperSkill managed routes off by default");
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
check(smokeCompose.includes('[[ "$checkout_html" == *"SuperSkill"* ]]'), "production compose smoke must verify SuperSkill checkout identity");
check(!smokeCompose.includes('[[ "$checkout_html" == *"OnlyHarness"* ]]'), "production compose smoke must reject the legacy checkout identity");
check(smokeCompose.includes("oauth-authorization-server") && smokeCompose.includes("= \"404\""), "production compose smoke must prove vanity OAuth AS discovery fails closed");
check(standaloneSuperSkillRedirect.includes("\tredir https://superskill.sh{uri} permanent"), "standalone Caddy must permanently redirect www.superskill.sh to the apex while preserving the URI");
check(standaloneSuperSkillRedirect.includes("Strict-Transport-Security"), "standalone SuperSkill redirect must preserve HSTS");
check(caddyfile.includes("superskill.sh {"), "standalone Caddy must serve the SuperSkill apex");
check(caddyfile.includes("onlyharness.com, www.onlyharness.com {"), "standalone Caddy must retain legacy machine compatibility hosts");
check(caddyfile.includes("redir https://superskill.sh{uri} permanent"), "standalone Caddy must redirect legacy human pages to SuperSkill");
check(!caddyfile.includes("onlyharness.com, www.onlyharness.com, superskill.sh, www.superskill.sh {"), "standalone Caddy must not serve www.superskill.sh as an HTML origin");
check(deployProduction.includes('RUN_DEPLOY_SMOKE="${RUN_DEPLOY_SMOKE:-1}"'), "deploy-production.sh must run public smoke by default");
check(deployProduction.includes("for required_auth_var in VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY"), "deploy-production.sh must fail before mutation when production auth config is missing");
check(deployProduction.includes('configured_publish_flag="${configured_publish_flag:-false}"'), "deploy-production.sh must fail closed when the containment publish flag is missing");
check(deployProduction.includes('ALLOW_ENABLE_HOSTED_RESOURCE_PUBLISH'), "deploy-production.sh must require an explicit operator opt-in before enabling hosted resource publishing");
check(deployProduction.includes("SUPERSKILL_SUBJECT_SALT_PATH") && deployProduction.includes("openssl rand -hex 32"), "deploy-production.sh must provision a stable server-only user-subject salt");
check(deployProduction.includes("'^SUPERSKILL_SUBJECT_SALT='") && deployProduction.includes("tr -d '\\r\\n' < \"$SUPERSKILL_SUBJECT_SALT_PATH\""), "deploy-production.sh must inject the persistent subject salt without logging it");
check(deployProduction.includes('RESOURCE_IMPORT_ARCHIVE_DIR must be an absolute traversal-free path'), "deploy-production.sh must validate the writable import archive bind path before mutation");
check(deployProduction.includes(`env HOSTED_RESOURCE_PUBLISH_ENABLED='$configured_publish_flag' docker compose`), "deploy-production.sh must pass the reviewed publish mode to every compose command");
check(deployProduction.includes(`grep -q 'HOSTED_RESOURCE_PUBLISH_ENABLED: \\"$configured_publish_flag\\"'`), "deploy-production.sh must verify the rendered publish mode");
check(deployProduction.includes('for seed_dir in directories resources'), "deploy-production.sh must hydrate both directory and resource seed data into the API volume");
check(deployProduction.includes('$PUBLIC_BASE_URL/api/resources?q=superpowers&limit=1'), "deploy-production.sh must smoke seeded resources after deploy");
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
check(deployProduction.includes('$PUBLIC_BASE_URL/mcp'), "deploy-production.sh must smoke the public MCP endpoint");
check(systemSuperSkillRedirect.includes("\tredir https://superskill.sh{uri} permanent"), "deploy-production.sh must permanently redirect www.superskill.sh to the apex while preserving the URI");
check(systemSuperSkillRedirect.includes("Strict-Transport-Security"), "system SuperSkill redirect must preserve HSTS");
check(deployProduction.includes("superskill.sh {"), "deploy-production.sh must serve the SuperSkill apex");
check(deployProduction.includes("onlyharness.com, www.onlyharness.com {"), "deploy-production.sh must retain legacy machine compatibility hosts");
check(!deployProduction.includes("onlyharness.com, www.onlyharness.com, superskill.sh, www.superskill.sh {"), "deploy-production.sh must not serve www.superskill.sh as an HTML origin");
check(deployProduction.includes('SUPERSKILL_APEX_URL="${SUPERSKILL_APEX_URL:-https://superskill.sh}"'), "deploy-production.sh must default the canonical SuperSkill apex smoke URL");
check(deployProduction.includes('SUPERSKILL_WWW_URL="${SUPERSKILL_WWW_URL:-https://www.superskill.sh}"'), "deploy-production.sh must default the SuperSkill redirect smoke URL");
check(deployProduction.includes('$SUPERSKILL_WWW_URL/deploy-canonical-smoke?source=deploy'), "deploy-production.sh must smoke the www SuperSkill redirect with path and query");
check(deployProduction.includes('location: $SUPERSKILL_APEX_URL/deploy-canonical-smoke?source=deploy'), "deploy-production.sh must verify the canonical SuperSkill redirect target");
check(deployProduction.includes('curl -fsS "$SUPERSKILL_APEX_URL/"'), "deploy-production.sh must smoke the SuperSkill apex HTML origin");
check(deployProduction.includes('curl -fsS "$SUPERSKILL_APEX_URL/" | grep -q \'SuperSkill\''), "deploy-production.sh must verify the SuperSkill apex identity");
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
