import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const compose = readFileSync(path.join(root, "infra/production-compose.yml"), "utf8");
const envExample = readFileSync(path.join(root, "infra/production.env.example"), "utf8");
const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");
const smokeCompose = readFileSync(path.join(root, "scripts/smoke-production-compose.sh"), "utf8");
const deployProduction = readFileSync(path.join(root, "scripts/deploy-production.sh"), "utf8");
const caddyfile = readFileSync(path.join(root, "infra/Caddyfile"), "utf8");
const standaloneSuperSkillRedirect = sectionBetween(caddyfile, "www.superskill.sh {", "onlyharness.com, www.onlyharness.com, superskill.sh {", "standalone SuperSkill redirect site");
const systemSuperSkillRedirect = sectionBetween(deployProduction, "www.superskill.sh {", "onlyharness.com, www.onlyharness.com, superskill.sh {", "system SuperSkill redirect site");

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
  "COMMUNITY_INVITE_SECRET",
  "HARNESS_WEBHOOK_TOKEN",
  "RESOURCE_ARCHIVE_DIR"
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
  "COMMUNITY_INVITE_SECRET",
  "GITEA_BASE_URL",
  "HARNESS_WEBHOOK_TOKEN",
  "RESOURCE_ARCHIVE_DIR",
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
check(compose.includes("VITE_DEFAULT_SKIN: ${VITE_DEFAULT_SKIN:-win98}"), "production web must default to the win98 skin until rollout gates pass");
check(compose.includes("VITE_ENABLE_SKIN_SWITCHER: ${VITE_ENABLE_SKIN_SWITCHER:-false}"), "production skin switcher must default off");
check(compose.includes("https://superskill.sh,https://www.superskill.sh"), "production API CORS must allow both SuperSkill hostnames");
check(compose.includes("HARNESS_PUBLIC_API_URL: ${HARNESS_PUBLIC_API_URL:-https://onlyharness.com/api}"), "HARNESS_PUBLIC_API_URL must default to the public API");
check(compose.includes("HARNESS_CHECKOUT_BASE_URL: ${HARNESS_CHECKOUT_BASE_URL:-https://onlyharness.com/checkout}"), "HARNESS_CHECKOUT_BASE_URL must default to the public checkout route");
check(envExample.includes("X402_ENABLED=false"), "production.env.example must keep x402 off by default");
check(envExample.includes("PAYMENTS_ENABLED=false"), "production.env.example must keep payments off by default");
check(envExample.includes("ORGS_ENABLED=false"), "production.env.example must keep orgs off by default");
check(envExample.includes("WORKSPACES_ENABLED=false"), "production.env.example must keep workspaces off by default");
check(envExample.includes("SUPERSKILL_ENABLED=false"), "production.env.example must keep SuperSkill managed routes off by default");
check(envExample.includes("VITE_DEFAULT_SKIN=win98"), "production.env.example must keep win98 as the safe default skin");
check(envExample.includes("VITE_ENABLE_SKIN_SWITCHER=false"), "production.env.example must keep the skin switcher off by default");
check(gitignore.split("\n").includes("infra/production.env"), "infra/production.env must stay gitignored");
check(smokeCompose.includes('VITE_HARNESS_API_URL="${VITE_HARNESS_API_URL:-$BASE_URL/api}"'), "production compose smoke must build the web UI against the local smoke API");
check(smokeCompose.includes('for seed_dir in directories resources'), "production compose smoke must hydrate both directory and resource seed data into the API volume");
check(smokeCompose.includes('$BASE_URL/api/resources?q=superpowers&limit=1'), "production compose smoke must verify seeded resources");
check(smokeCompose.includes('$BASE_URL/api/showroom/selected?limit=12'), "production compose smoke must verify selected SuperSkill intake cards");
check(smokeCompose.includes('SMOKE_AUTH_RATE_LIMIT_OK="${SMOKE_AUTH_RATE_LIMIT_OK:-1}"'), "production compose smoke must soft-skip external Supabase auth rate limits by default");
check(smokeCompose.includes('$BASE_URL/checkout?owner=harnesses&repo=deep-market-researcher'), "production compose smoke must verify checkout deep links fall back to the SPA");
check(standaloneSuperSkillRedirect.includes("\tredir https://superskill.sh{uri} permanent"), "standalone Caddy must permanently redirect www.superskill.sh to the apex while preserving the URI");
check(standaloneSuperSkillRedirect.includes("Strict-Transport-Security"), "standalone SuperSkill redirect must preserve HSTS");
check(caddyfile.includes("onlyharness.com, www.onlyharness.com, superskill.sh {"), "standalone Caddy must keep www.onlyharness.com proxied while serving the SuperSkill apex");
check(!caddyfile.includes("onlyharness.com, www.onlyharness.com, superskill.sh, www.superskill.sh {"), "standalone Caddy must not serve www.superskill.sh as an HTML origin");
check(deployProduction.includes('RUN_DEPLOY_SMOKE="${RUN_DEPLOY_SMOKE:-1}"'), "deploy-production.sh must run public smoke by default");
check(deployProduction.includes('for seed_dir in directories resources'), "deploy-production.sh must hydrate both directory and resource seed data into the API volume");
check(deployProduction.includes('$PUBLIC_BASE_URL/api/resources?q=superpowers&limit=1'), "deploy-production.sh must smoke seeded resources after deploy");
check(deployProduction.includes('$PUBLIC_BASE_URL/api/showroom/selected?limit=12'), "deploy-production.sh must smoke selected SuperSkill intake cards after deploy");
check(deployProduction.includes('$PUBLIC_BASE_URL/mcp'), "deploy-production.sh must smoke the public MCP endpoint");
check(systemSuperSkillRedirect.includes("\tredir https://superskill.sh{uri} permanent"), "deploy-production.sh must permanently redirect www.superskill.sh to the apex while preserving the URI");
check(systemSuperSkillRedirect.includes("Strict-Transport-Security"), "system SuperSkill redirect must preserve HSTS");
check(deployProduction.includes("onlyharness.com, www.onlyharness.com, superskill.sh {"), "deploy-production.sh must keep www.onlyharness.com proxied while serving the SuperSkill apex");
check(!deployProduction.includes("onlyharness.com, www.onlyharness.com, superskill.sh, www.superskill.sh {"), "deploy-production.sh must not serve www.superskill.sh as an HTML origin");
check(deployProduction.includes('SUPERSKILL_APEX_URL="${SUPERSKILL_APEX_URL:-https://superskill.sh}"'), "deploy-production.sh must default the canonical SuperSkill apex smoke URL");
check(deployProduction.includes('SUPERSKILL_WWW_URL="${SUPERSKILL_WWW_URL:-https://www.superskill.sh}"'), "deploy-production.sh must default the SuperSkill redirect smoke URL");
check(deployProduction.includes('$SUPERSKILL_WWW_URL/deploy-canonical-smoke?source=deploy'), "deploy-production.sh must smoke the www SuperSkill redirect with path and query");
check(deployProduction.includes('location: $SUPERSKILL_APEX_URL/deploy-canonical-smoke?source=deploy'), "deploy-production.sh must verify the canonical SuperSkill redirect target");
check(deployProduction.includes('curl -fsS "$SUPERSKILL_APEX_URL/"'), "deploy-production.sh must smoke the SuperSkill apex HTML origin");
check(deployProduction.includes('"name":"search_resources"'), "deploy-production.sh must smoke the MCP resource search tool");
check(deployProduction.includes('$PUBLIC_BASE_URL/checkout?owner=harnesses&repo=deep-market-researcher'), "deploy-production.sh must smoke checkout deep links after deploy");

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
