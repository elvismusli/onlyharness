import { expect, test } from "vitest";

import { superskillRuntime } from "../generated/superskill-runtime";
import { superskillInstallCommands } from "./superskill-install";

test.each(["claude-code", "codex"] as const)("%s handoff uses the exact generated runtime version", (client) => {
  const commands = superskillInstallCommands(client);
  expect(commands.runtimeCheckCommand).toContain(`onlyharness@${superskillRuntime.cliVersion}`);
  expect(commands.runtimeCheckCommand).not.toContain("@latest");
});
