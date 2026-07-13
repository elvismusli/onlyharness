export const EXACT_ACTIVATION_EVENT_CHAIN = [
  "activation_started",
  "activation_ready",
  "activation_loaded",
  "activation_invoked",
  "outcome_reported"
] as const;

type ManagedEventRow = {
  activation_id?: unknown;
  activationId?: unknown;
  kind?: unknown;
};

export type ExactActivationEventEvidence = {
  valid: boolean;
  ordered: boolean;
  unique: boolean;
  kinds: string[];
};

export type CodexActivationToolEvidence = {
  valid: boolean;
  commandExecutions: number;
  rejectedExecutions: number;
  executionShapes: string[];
  failureReasons: string[];
  skillLoadObserved: boolean;
  requiredOperations: {
    startFromPinned: boolean;
    loaded: boolean;
    invoked: boolean;
    finishUnknown: boolean;
  };
};

export function claudeCompatibilitySessionEligible(input: {
  skillTraceObserved: boolean;
  stateEvidence: boolean;
  eventEvidenceValid: boolean;
}): boolean {
  return input.skillTraceObserved && input.stateEvidence && input.eventEvidenceValid;
}

export function inspectExactActivationEventChain(
  rows: readonly ManagedEventRow[],
  activationId: string
): ExactActivationEventEvidence {
  const kinds = rows
    .filter((row) => row.activation_id === activationId || row.activationId === activationId)
    .map((row) => row.kind)
    .filter((kind): kind is string => typeof kind === "string");
  const ordered = kinds.length === EXACT_ACTIVATION_EVENT_CHAIN.length
    && kinds.every((kind, index) => kind === EXACT_ACTIVATION_EVENT_CHAIN[index]);
  const unique = new Set(kinds).size === kinds.length
    && EXACT_ACTIVATION_EVENT_CHAIN.every((required) => kinds.filter((kind) => kind === required).length === 1);
  return {
    valid: ordered && unique,
    ordered,
    unique,
    kinds
  };
}

export function inspectCodexActivationToolTrace(
  output: string,
  input: {
    cliVersion: string;
    requestId: string;
    activationId: string;
    markerRelative: string;
    skillRelative: string;
  }
): CodexActivationToolEvidence {
  const executions: Array<{ command: string; successful: boolean; output: string }> = [];
  const seenIds = new Set<string>();
  let rejectedExecutions = 0;
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        type?: unknown;
        item?: { id?: unknown; type?: unknown; command?: unknown; status?: unknown; exit_code?: unknown; aggregated_output?: unknown };
      };
      const item = event.item;
      if (event.type !== "item.completed" || item?.type !== "command_execution") continue;
      if (typeof item.id !== "string" || typeof item.command !== "string" || seenIds.has(item.id)) {
        rejectedExecutions += 1;
        continue;
      }
      seenIds.add(item.id);
      executions.push({
        command: item.command,
        successful: item.status === "completed" && item.exit_code === 0,
        output: typeof item.aggregated_output === "string" ? item.aggregated_output : ""
      });
    } catch {
      // Non-JSON output cannot prove structured Codex tool execution.
    }
  }
  const operationCounts = {
    skillLoad: 0,
    startFromPinned: 0,
    loaded: 0,
    invoked: 0,
    finishUnknown: 0
  };
  const executionShapes: string[] = [];
  const failureReasons: string[] = [];
  for (const execution of executions) {
    const command = unwrapCodexCommand(execution.command);
    const operation = command ? classifyExactCodexCommand(command, input) : undefined;
    if (!execution.successful) {
      executionShapes.push(operation ? `failed_${operation}` : `failed_${describeRejectedCodexCommand(execution.command, input.cliVersion)}`);
      failureReasons.push(classifySafeFailureReason(execution.output));
      rejectedExecutions += 1;
      continue;
    }
    if (!operation) {
      executionShapes.push(describeRejectedCodexCommand(execution.command, input.cliVersion));
      rejectedExecutions += 1;
      continue;
    }
    executionShapes.push(operation);
    operationCounts[operation] += 1;
  }
  const requiredOperations = {
    startFromPinned: operationCounts.startFromPinned === 1,
    loaded: operationCounts.loaded === 1,
    invoked: operationCounts.invoked === 1,
    finishUnknown: operationCounts.finishUnknown === 1
  };
  const skillLoadObserved = operationCounts.skillLoad === 1;
  return {
    valid: executions.length === 5
      && rejectedExecutions === 0
      && skillLoadObserved
      && Object.values(requiredOperations).every(Boolean),
    commandExecutions: executions.length,
    rejectedExecutions,
    executionShapes,
    failureReasons,
    skillLoadObserved,
    requiredOperations
  };
}

function classifySafeFailureReason(output: string): string {
  const code = /"code"\s*:\s*"([A-Z][A-Z0-9_]{2,60})"/.exec(output)?.[1];
  if (code) return `cli_${code}`;
  if (/permission|denied|sandbox/i.test(output)) return "tool_permission_denied";
  if (/network|connection|fetch|econn/i.test(output)) return "network_unavailable";
  if (/not found|enoent/i.test(output)) return "command_or_file_not_found";
  return "unclassified_nonzero_exit";
}

function describeRejectedCodexCommand(value: string, cliVersion: string): string {
  const command = unwrapCodexCommand(value);
  if (!command) return "invalid_wrapper_or_composition";
  if (command.includes(`onlyharness@${cliVersion} activation start`)) return "non_exact_activation_start";
  if (command.includes(`onlyharness@${cliVersion} activation mark`)) return "non_exact_activation_mark";
  if (command.includes(`onlyharness@${cliVersion} activation finish`)) return "non_exact_activation_finish";
  if (command.startsWith("cat ")) return "non_exact_skill_read";
  return "unexpected_shell_command";
}

function unwrapCodexCommand(value: string): string | undefined {
  const prefix = "/bin/zsh -lc ";
  if (!value.startsWith(prefix)) return undefined;
  let command = value.slice(prefix.length);
  if (command.startsWith("'") && command.endsWith("'") && command.length >= 2) {
    command = command.slice(1, -1);
  }
  if (!command || /[\r\n;&|<>`]/.test(command) || command.includes("$(")) return undefined;
  return command;
}

function classifyExactCodexCommand(
  command: string,
  input: {
    cliVersion: string;
    requestId: string;
    activationId: string;
    markerRelative: string;
    skillRelative: string;
  }
): "skillLoad" | "startFromPinned" | "loaded" | "invoked" | "finishUnknown" | undefined {
  const tokens = command.trim().split(/\s+/);
  if (tokens.length === 3 && tokens[0] === "cat" && tokens[1] === "--" && tokens[2] === input.skillRelative) {
    return "skillLoad";
  }
  if (!tokensStartWith(tokens, ["npx", "--yes", `onlyharness@${input.cliVersion}`, "activation"])) return undefined;
  const operation = tokens[4];
  if (operation === "start") {
    const flags = exactFlags(tokens.slice(5), new Set(["--from-pinned", "--activation-request", "--target", "--consent"]));
    if (!flags
      || flags.get("--from-pinned") !== input.markerRelative
      || flags.get("--activation-request") !== input.requestId
      || flags.get("--target") !== "codex"
      || flags.get("--consent") !== "explicit"
      || flags.get("--json") !== true) return undefined;
    return "startFromPinned";
  }
  if ((operation === "mark" || operation === "finish") && tokens[5] === input.activationId) {
    if (operation === "mark") {
      const flags = exactFlags(tokens.slice(6), new Set(["--state"]));
      if (!flags || flags.get("--json") !== true) return undefined;
      if (flags.get("--state") === "loaded") return "loaded";
      if (flags.get("--state") === "invoked") return "invoked";
      return undefined;
    }
    const flags = exactFlags(tokens.slice(6), new Set(["--outcome", "--evidence"]));
    if (!flags
      || flags.get("--outcome") !== "unknown"
      || flags.get("--evidence") !== "unknown"
      || flags.get("--json") !== true) return undefined;
    return "finishUnknown";
  }
  return undefined;
}

function exactFlags(tokens: string[], valueFlags: Set<string>): Map<string, string | true> | undefined {
  const result = new Map<string, string | true>();
  for (let index = 0; index < tokens.length; index += 1) {
    const flag = tokens[index];
    if (flag === "--json") {
      if (result.has(flag)) return undefined;
      result.set(flag, true);
      continue;
    }
    if (!valueFlags.has(flag) || result.has(flag) || index + 1 >= tokens.length || tokens[index + 1].startsWith("--")) return undefined;
    result.set(flag, tokens[index + 1]);
    index += 1;
  }
  if (result.size !== valueFlags.size + 1 || !result.has("--json")) return undefined;
  return result;
}

function tokensStartWith(tokens: string[], expected: string[]): boolean {
  return expected.every((value, index) => tokens[index] === value);
}
