import type { Command } from "commander";
import {
  SUPERSKILL_INSTALL_ORIGIN,
  SUPERSKILL_INSTALL_PATH,
  fetchBootstrapManifest,
  installUniversalSkill,
  resolveInstallClients,
  verifyOfficialPackageIntegrity
} from "../lib/superskill-bootstrap.js";
import { consumePendingSuperSkillHandoff } from "../lib/superskill-handoff.js";
import { parseClient, runManagedAction } from "./recommend.js";

export function registerSuperSkillInstallCommand(program: Command, registry: () => string): void {
  const superskill = program.command("superskill").description("install the universal SuperSkill client skill from one pinned link");
  superskill.command("install")
    .description("verify a canonical SuperSkill link and install the correct local client adapter")
    .argument("[url]", "canonical exact install URL", `${SUPERSKILL_INSTALL_ORIGIN}${SUPERSKILL_INSTALL_PATH}`)
    .option("--auto", "detect exactly one supported client", false)
    .option("--target <target>", "codex|claude-code")
    .option("--all", "explicitly install both client adapters", false)
    .option("--project-dir <path>", "project root", ".")
    .option("--dry-run", "verify and plan without writing", false)
    .option("--json", "print structured output", false)
    .action(async (url: string, options) => runManagedAction(Boolean(options.json), async () => {
      const auto = !options.auto && !options.target && !options.all ? true : Boolean(options.auto);
      const manifest = await fetchBootstrapManifest(url);
      const verifiedBootstrap = await verifyOfficialPackageIntegrity(manifest);
      const clients = resolveInstallClients({ auto, target: options.target, all: Boolean(options.all) });
      const result = installUniversalSkill({
        verifiedBootstrap,
        clients,
        projectDir: options.projectDir,
        dryRun: Boolean(options.dryRun)
      });
      const payload = {
        ...result,
        bootstrapUrl: manifest.canonicalUrl,
        universalSkill: manifest.universalSkill,
        next: result.handoff
          ? "Start a fresh client task. SuperSkill will recheck this exact release and ask separate activation consent."
          : "Start a fresh client task and ask it to use SuperSkill. Routing and activation consent remain separate."
      };
      if (options.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      else process.stdout.write([
        `SuperSkill ${result.status}: ${result.targets.join(", ")}`,
        result.handoff ? `Pending exact release: ${result.handoff.id}@${result.handoff.version} (${result.handoff.artifactDigest})` : "Universal routing skill installed without selecting a capability.",
        "No capability was activated. Explicit activation consent is still required.",
        `Next: ${payload.next}`,
        ""
      ].join("\n"));
    }));

  superskill.command("handoff")
    .description("recheck and disclose a pending exact handoff without activating it")
    .requiredOption("--target <target>", "codex|claude-code")
    .option("--project-dir <path>", "project root", ".")
    .option("--json", "print structured output", false)
    .action(async (options) => runManagedAction(Boolean(options.json), async () => {
      const result = await consumePendingSuperSkillHandoff({
        registry: registry(),
        projectDir: options.projectDir,
        client: parseClient(options.target)
      });
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      const selected = result.recommendation.selected!;
      process.stdout.write([
        `${selected.capability.title} (${selected.capability.release.version}) for ${result.client}`,
        `Digest: ${selected.capability.release.artifactDigest}`,
        "Selection reasons:",
        ...selected.why.map((reason) => `- ${reason.text}`),
        "Named checks:",
        ...selected.capability.trust.checks.map((check) => `- ${check.id}: ${check.status} (${check.evidenceLevel})${check.expiresAt ? ` until ${check.expiresAt}` : ""}`),
        `Declared permissions: ${JSON.stringify(selected.capability.permissions)}`,
        `Permission baseline: ${selected.permissionDelta.status} — ${selected.permissionDelta.unknownBecause}`,
        "Limitations:",
        ...(selected.limitations.length ? selected.limitations.map((item) => `- ${item}`) : ["- None declared; review named checks before consent."]),
        "Nothing was activated, loaded or invoked. Separate explicit activation consent is required.",
        `Decision expires: ${result.recommendation.expiresAt}`,
        `After consent: ${result.activation.command}`,
        ""
      ].join("\n"));
    }));
}
