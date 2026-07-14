import type { ManagedCapability, ManagedPermissions, ShowroomCapability } from "../../../core/superskill-types";
import { capabilityVerdict, installAllowed } from "../../../core/superskill-types";
import { buildSuperSkillRoute } from "../../../core/superskill-route";
import { ShellLink } from "../primitives";
import { CopyField } from "./CopyField";
import { VerdictChip } from "./VerdictChip";

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  skill: "skill",
  plugin: "plugin",
  mcp: "MCP server",
  mcp_server: "MCP server",
  workflow: "workflow",
  harness: "harness",
  instruction_harness: "harness",
  config: "config",
  guide: "guide",
  framework: "framework",
  subagent_pack: "subagent pack",
  command_pack: "command pack",
  agent_team: "agent team"
};

// The public schema currently types every capability as `instruction_harness`, a phrase the
// glossary forbids in user-facing copy. Map the real resource type to an honest label and never
// surface "instruction harness".
export function resourceTypeLabel(type: string): string {
  const label = RESOURCE_TYPE_LABELS[type] ?? type.replaceAll("_", " ").trim();
  return label === "instruction harness" || label === "" ? "harness" : label;
}

type PermRisk = "critical" | "elevated";

// Risk tiers mirror the canonical mapping in PermissionDelta.tsx so the card and the trust report
// agree on what counts as a critical vs elevated power.
function permissionPowers(p: ManagedPermissions): Array<{ label: string; risk: PermRisk }> {
  const powers: Array<{ label: string; risk: PermRisk }> = [];
  if (p.shell) powers.push({ label: "shell access", risk: "critical" });
  if (p.moneyMovement) powers.push({ label: "money movement", risk: "critical" });
  if (p.externalSend) powers.push({ label: "external send", risk: "critical" });
  if (p.credentials !== "false") powers.push({ label: p.credentials === "persistent" ? "stored credentials" : "runtime credentials", risk: "critical" });
  if (p.network === "unrestricted") powers.push({ label: "open network", risk: "critical" });
  if (p.filesystem === "unrestricted") powers.push({ label: "full disk", risk: "critical" });
  if (p.browser) powers.push({ label: "browser control", risk: "elevated" });
  if (p.network === "allowlist") powers.push({ label: "network allowlist", risk: "elevated" });
  if (p.filesystem === "workspace-write") powers.push({ label: "workspace write", risk: "elevated" });
  if (p.userData) powers.push({ label: "user data", risk: "elevated" });
  return powers;
}

function mutedNotes(p: ManagedPermissions): string[] {
  const notes: string[] = [];
  if (!p.shell) notes.push("no shell");
  if (p.filesystem === "readonly") notes.push("read-only files");
  return notes;
}

function PermissionChips({ permissions }: { permissions: ManagedPermissions }) {
  const powers = permissionPowers(permissions);
  if (powers.length === 0) {
    return <div className="ss-perm-chips" aria-label="Permissions"><span className="ss-perm-chip ss-perm-chip--none">no new permissions</span></div>;
  }
  return (
    <div className="ss-perm-chips" aria-label="Permissions">
      {powers.map((power) => <span key={power.label} className="ss-perm-chip" data-risk={power.risk}>{power.label}</span>)}
      {mutedNotes(permissions).map((note) => <span key={note} className="ss-perm-chip ss-perm-chip--muted">{note}</span>)}
    </div>
  );
}

function WhyThis({ capability }: { capability: ManagedCapability }) {
  const job = capability.jobs[0];
  const fit = job ? `${job.intents[0] ?? job.id.replaceAll("-", " ")} → ${job.outcomes[0] ?? "reviewed outcome"}` : "reviewed fit";
  const verified = capability.compatibility.filter((entry) => entry.status === "verified").map((entry) => entry.client);
  const compat = verified.length ? `verified on ${verified.join(", ")}` : "compatibility pending";
  const checks = capability.trust.checks.length;
  const trust = `${capability.trust.riskTier.toLowerCase()} risk · ${checks} named ${checks === 1 ? "check" : "checks"}`;
  const cost = `~${capability.contextCost.approxTokens.toLocaleString()} tokens`;
  return (
    <section className="ss-why-this" aria-label="Why this">
      <div><span>Fit</span><span>{fit}</span></div>
      <div><span>Works with</span><span>{compat}</span></div>
      <div><span>Trust</span><span>{trust}</span></div>
      <div><span>Cost</span><span>{cost}</span></div>
    </section>
  );
}

export function SkillCard({ item, variant = "compact", label }: { item: ShowroomCapability; variant?: "featured" | "compact" | "installed"; label?: string }) {
  const { capability, preview } = item;
  const verdict = capabilityVerdict(capability);
  const allowed = installAllowed(capability, item.clientHandoff);
  const installHref = buildSuperSkillRoute({ name: "install", capabilityId: capability.id });
  const reviewedDate = capability.trust.reviewedAt.slice(0, 10);
  return (
    <article className={`ss-skill-card ss-skill-card--${variant} ss-skill-card--${verdict}`}>
      <div className="ss-card-top"><span className="ss-type-chip">{resourceTypeLabel(capability.type)}</span><VerdictChip verdict={verdict} namedCheckCount={capability.trust.checks.length} /></div>
      {label ? <div className="ss-evidence-label">{label}</div> : null}
      <h3>{capability.title}</h3>
      <p>{capability.summary}</p>
      <PermissionChips permissions={capability.permissions} />
      {preview ? (
        <div className="ss-preview" aria-label={`Reviewed preview: ${preview.taskLabel}`}>
          <div>$ {preview.taskLabel}</div>
          {preview.lines.slice(0, 6).map((line, index) => <code key={`${line}-${index}`}>{line}</code>)}
          <strong>{preview.outcomeLabel}</strong>
          <small>Reviewed fixture · {preview.reviewCaseId}</small>
        </div>
      ) : null}
      {variant === "featured" ? <WhyThis capability={capability} /> : null}
      <div className="ss-card-evidence"><span>{capability.contextCost.approxTokens.toLocaleString()} estimated tokens</span><span>Reviewed {reviewedDate}</span><span>{capability.release.version}</span></div>
      {!allowed ? <div className="ss-block-copy">Install handoff blocked: {item.clientHandoff.reason === "stale_or_ineligible_evidence" ? "evidence is stale or no longer eligible" : `release is ${capability.trust.status}`}.</div> : null}
      <div className="ss-card-actions">
        <ShellLink href={buildSuperSkillRoute({ name: "capability", capabilityId: capability.id })}>Trust report</ShellLink>
        {allowed ? (
          <ShellLink className="ss-link--primary" href={installHref}>Install · temporary</ShellLink>
        ) : (
          <ShellLink href={buildSuperSkillRoute({ name: "category", job: capability.jobs[0]?.id ?? capability.id })}>See alternatives</ShellLink>
        )}
      </div>
      <CopyField label="Artifact digest" value={capability.release.artifactDigest} />
    </article>
  );
}
