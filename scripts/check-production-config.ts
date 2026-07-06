import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const compose = readFileSync(path.join(root, "infra/production-compose.yml"), "utf8");
const envExample = readFileSync(path.join(root, "infra/production.env.example"), "utf8");
const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");
const smokeCompose = readFileSync(path.join(root, "scripts/smoke-production-compose.sh"), "utf8");
const deployProduction = readFileSync(path.join(root, "scripts/deploy-production.sh"), "utf8");

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
  "COMMUNITY_INVITE_SECRET",
  "HARNESS_WEBHOOK_TOKEN"
] as const;

const exampleEnv = [
  "VITE_HARNESS_API_URL",
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
  "COMMUNITY_INVITE_SECRET",
  "GITEA_BASE_URL",
  "HARNESS_WEBHOOK_TOKEN",
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
check(compose.includes("HARNESS_PUBLIC_API_URL: ${HARNESS_PUBLIC_API_URL:-https://onlyharness.com/api}"), "HARNESS_PUBLIC_API_URL must default to the public API");
check(compose.includes("HARNESS_CHECKOUT_BASE_URL: ${HARNESS_CHECKOUT_BASE_URL:-https://onlyharness.com/checkout}"), "HARNESS_CHECKOUT_BASE_URL must default to the public checkout route");
check(envExample.includes("X402_ENABLED=false"), "production.env.example must keep x402 off by default");
check(envExample.includes("PAYMENTS_ENABLED=false"), "production.env.example must keep payments off by default");
check(envExample.includes("ORGS_ENABLED=false"), "production.env.example must keep orgs off by default");
check(gitignore.split("\n").includes("infra/production.env"), "infra/production.env must stay gitignored");
check(smokeCompose.includes('VITE_HARNESS_API_URL="${VITE_HARNESS_API_URL:-$BASE_URL/api}"'), "production compose smoke must build the web UI against the local smoke API");
check(smokeCompose.includes('SMOKE_AUTH_RATE_LIMIT_OK="${SMOKE_AUTH_RATE_LIMIT_OK:-1}"'), "production compose smoke must soft-skip external Supabase auth rate limits by default");
check(smokeCompose.includes('$BASE_URL/checkout?owner=harnesses&repo=deep-market-researcher'), "production compose smoke must verify checkout deep links fall back to the SPA");
check(deployProduction.includes('RUN_DEPLOY_SMOKE="${RUN_DEPLOY_SMOKE:-1}"'), "deploy-production.sh must run public smoke by default");
check(deployProduction.includes('$PUBLIC_BASE_URL/mcp'), "deploy-production.sh must smoke the public MCP endpoint");
check(deployProduction.includes('$PUBLIC_BASE_URL/checkout?owner=harnesses&repo=deep-market-researcher'), "deploy-production.sh must smoke checkout deep links after deploy");

console.log("Production config check passed: compose env, example env, and smoke API routing are in sync");

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
