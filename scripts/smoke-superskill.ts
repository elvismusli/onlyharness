import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const commands: Array<[string, string[]]> = [
  [process.execPath, ["--import", "tsx", "--test", "packages/capability-schema/test/artifact.test.ts", "packages/capability-schema/test/schema.test.ts"]],
  [process.execPath, ["--import", "tsx", "--test", "apps/harness-api/test/capabilities.test.ts", "apps/harness-api/test/recommendations.test.ts", "apps/harness-api/test/superskill-routes.test.ts", "apps/harness-api/test/trust-policy.test.ts"]],
  [process.execPath, ["--import", "tsx", "--test", "scripts/superskill-catalog.test.ts", "scripts/superskill-revoke.test.ts"]],
  ["npx", ["tsx", "scripts/check-managed-archive-boundary.ts"]],
  ["npx", ["tsx", "scripts/check-superskill-catalog.ts"]],
  ["npx", ["tsx", "scripts/check-superskill-router.ts"]],
  ["npm", ["run", "bundle", "-w", "onlyharness"]],
  [process.execPath, ["--import", "tsx", "--test", "packages/harness-cli/test/superskill-contracts.test.ts", "packages/harness-cli/test/superskill-activation.test.ts"]],
  ["npx", ["tsx", "scripts/check-claude-plugin.ts"]],
  ["npx", ["tsx", "scripts/check-codex-plugin.ts"]]
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      HH_SUPERSKILL_DOCTOR_SKIP_NPM_VIEW: "1"
    }
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("SuperSkill local deterministic smoke passed for schema, API, catalog, revoke, routing, and Claude Code/Codex lifecycle fixtures.");
