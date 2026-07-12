import { superskillRuntime } from "../generated/superskill-runtime";
import type { SuperSkillClient } from "./superskill-types";

export type SuperSkillInstallCommands = {
  client: SuperSkillClient;
  clientLabel: string;
  marketplaceCommand: string;
  pluginCommand: string;
  runtimeCheckCommand: string;
  restartCopy: string;
};

export function superskillInstallCommands(client: SuperSkillClient): SuperSkillInstallCommands {
  const runtimeCheckCommand = `npx --yes ${superskillRuntime.cliPackage}@${superskillRuntime.cliVersion} doctor --json`;
  if (client === "claude-code") {
    return {
      client,
      clientLabel: "Claude Code",
      marketplaceCommand: "claude plugin marketplace add elvismusli/onlyharness",
      pluginCommand: "claude plugin install superskill@onlyharness",
      runtimeCheckCommand,
      restartCopy: "Start a new Claude Code session so the shared SuperSkill skill is discovered, then paste your task."
    };
  }
  return {
    client,
    clientLabel: "Codex CLI",
    marketplaceCommand: "codex plugin marketplace add elvismusli/onlyharness --ref main",
    pluginCommand: "codex plugin add superskill@onlyharness",
    runtimeCheckCommand,
    restartCopy: "Start a new terminal Codex task so the shared SuperSkill skill is discovered, then paste your task."
  };
}
