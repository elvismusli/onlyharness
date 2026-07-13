import type { RegistryItem } from "./types";

export const apiUrl = import.meta.env.VITE_HARNESS_API_URL ?? "http://127.0.0.1:8787";

export const JOB_FILTERS = ["Market research", "GTM research", "Support triage", "Payment safety", "Product strategy", "Incident response", "Data quality", "Security review", "Launch readiness", "Repo audit", "Harness building", "Directory discovery"];
export const CLAUDE_PLUGIN_INSTALL_COMMAND = "claude plugin marketplace add elvismusli/onlyharness && claude plugin install superskill@superskill";
export const CODEX_MCP_INSTALL_COMMAND = "codex mcp add superskill --url https://superskill.sh/mcp --bearer-token-env-var HH_TOKEN";

export function remixRecipe(item: RegistryItem): string {
  const remixName = `my-${item.name}`;
  const hh = "node packages/harness-cli/dist/hh.mjs";
  if (item.contentType === "directory") {
    const url = item.directory?.url ?? item.forgeUrl;
    return [
      `open ${url ?? "<upstream-url>"}`,
      "# Link-only directory: inspect upstream source and license before vendoring.",
      "# Convert the selected workflow into remix.md, then publish with HH_TOKEN:",
      "npm run build -w onlyharness",
      `${hh} publish remix.md --name ${remixName} --json`
    ].join("\n");
  }
  return [
    "npm run build -w onlyharness",
    `${hh} install ${item.owner}/${item.name} --out ${remixName}`,
    "# Rename harness.yaml name/title and edit agents/evals before publishing.",
    `${hh} eval ${remixName} --json`,
    `${hh} gate --dir ${remixName} --json`,
    "# Current publish path requires a verified directory; set HH_TOKEN first.",
    `${hh} publish ${remixName} --name ${remixName} --json`
  ].join("\n");
}
