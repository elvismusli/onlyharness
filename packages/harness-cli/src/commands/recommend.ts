import { randomBytes } from "node:crypto";
import type { Command } from "commander";
import { resolveProjectRoot } from "../lib/activation-store.js";
import { scanInventory } from "../lib/client-adapters.js";
import { recommendCapability, sendManagedEvent } from "../lib/superskill-client.js";
import type { RecommendationCandidate, SuperSkillClient } from "../lib/superskill-types.js";
import { SuperSkillCliError } from "../lib/superskill-types.js";

export function registerRecommendCommand(program: Command, registry: () => string): void {
  program.command("recommend")
    .description("get one reviewed SuperSkill recommendation (managed flow; hh suggest remains the legacy catalog path)")
    .argument("<task...>", "privacy-safe task summary")
    .requiredOption("--target <target>", "claude-code|codex")
    .option("--project-dir <path>", "project root for inventory")
    .option("--json", "print JSON", false)
    .action(async (parts: string[], options) => runManagedAction(Boolean(options.json), async () => {
      const client = parseClient(options.target);
      const projectRoot = resolveProjectRoot(options.projectDir);
      const inventory = scanInventory(client, projectRoot);
      const response = await recommendCapability({ registry: registry(), task: parts.join(" "), client, inventory });
      if (response.selected) {
        const ref = response.selected.capability.release.ref.split("/");
        void sendManagedEvent({ registry: registry(), event: {
          eventId: opaqueId("evt"),
          kind: "recommended",
          owner: ref[0],
          repo: ref.slice(1).join("/"),
          version: response.selected.capability.release.version,
          target: client,
          client: client === "codex" ? "superskill-codex" : "superskill-claude",
          recommendationId: response.recommendationId,
          mode: "temporary"
        } });
      }
      const next = response.decision === "recommend" && response.selected ? [activationCommand(response.selected, response, client)] : [];
      if (options.json) process.stdout.write(`${JSON.stringify({ ...response, client, next }, null, 2)}\n`);
      else process.stdout.write(recommendationText(response, client, next));
      if (response.decision === "no_safe_match") process.exitCode = 3;
    }));
}

export function parseClient(value: string): SuperSkillClient {
  if (value !== "claude-code" && value !== "codex") {
    throw new SuperSkillCliError("Unsupported managed client.", 3, "CLIENT_UNSUPPORTED", "Use --target claude-code or --target codex.");
  }
  return value;
}

export async function runManagedAction(json: boolean, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof SuperSkillCliError) {
      const body = { error: error.message, code: error.exitCode, reasonCode: error.reasonCode, next: error.next };
      process.stderr.write(json ? `${JSON.stringify(body, null, 2)}\n` : `${error.message}\nReason: ${error.reasonCode}\nNext: ${error.next}\n`);
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  }
}

export function opaqueId(prefix: "evt" | "act"): string {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

function activationCommand(candidate: RecommendationCandidate, response: { recommendationId: string; decisionDigest: string; expiresAt: string }, client: SuperSkillClient): string {
  return [
    "hh activation start",
    candidate.capability.id,
    "--version", candidate.capability.release.version,
    "--digest", candidate.capability.release.artifactDigest,
    "--recommendation", response.recommendationId,
    "--decision-digest", response.decisionDigest,
    "--recommendation-expires-at", response.expiresAt,
    "--activation-request", "req_<new-random-id>",
    "--target", client,
    "--mode temporary --consent explicit --json"
  ].join(" ");
}

function recommendationText(response: Awaited<ReturnType<typeof recommendCapability>>, client: SuperSkillClient, next: string[]): string {
  if (response.decision === "no_safe_match") return "No suitable reviewed SuperSkill capability is available. Continue without an unscanned fallback.\n";
  if (response.decision === "needs_clarification") return `SuperSkill needs clarification: ${response.clarification?.question ?? "Clarify the intended outcome."}\n`;
  const selected = response.selected;
  if (!selected) return "No selected capability was returned.\n";
  return [
    `${selected.capability.title} (${selected.capability.release.version}) for ${client}`,
    `Digest: ${selected.capability.release.artifactDigest}`,
    ...selected.why.map((reason) => `Why: ${reason.text} (+${reason.points})`),
    `Permission baseline: ${selected.permissionDelta.status}${selected.permissionDelta.unknownBecause ? ` — ${selected.permissionDelta.unknownBecause}` : ""}`,
    ...(selected.permissionDelta.added.length ? ["Candidate powers:", ...selected.permissionDelta.added.map((power) => `- ${power}`)] : ["Candidate adds no declared powers beyond the known managed baseline."]),
    "Limitations:",
    ...(selected.limitations.length ? selected.limitations.map((item) => `- ${item}`) : ["- No additional limitation text supplied; review named checks before consent."]),
    "Activation consent is required separately.",
    `Next: ${next[0]}`,
    ""
  ].join("\n");
}
