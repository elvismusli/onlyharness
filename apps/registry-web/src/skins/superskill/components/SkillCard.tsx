import type { ShowroomCapability } from "../../../core/superskill-types";
import { capabilityVerdict, installAllowed } from "../../../core/superskill-types";
import { buildSuperSkillRoute } from "../../../core/superskill-route";
import { capabilityShareUrl } from "../../../core/share-url";
import { ShellLink } from "../primitives";
import { VerdictChip } from "./VerdictChip";

export function SkillCard({ item, variant = "compact", label }: { item: ShowroomCapability; variant?: "featured" | "compact" | "installed"; label?: string }) {
  const { capability, preview } = item;
  const verdict = capabilityVerdict(capability);
  const allowed = installAllowed(capability, item.clientHandoff);
  return (
    <article className={`ss-skill-card ss-skill-card--${variant} ss-skill-card--${verdict}`}>
      <div className="ss-card-top"><span className="ss-type-chip">instruction harness</span><VerdictChip verdict={verdict} namedCheckCount={capability.trust.checks.length} /></div>
      {label ? <div className="ss-evidence-label">{label}</div> : null}
      <h3>{capability.title}</h3>
      <p>{capability.summary}</p>
      {preview ? (
        <div className="ss-preview" aria-label={`Reviewed preview: ${preview.taskLabel}`}>
          <div>$ {preview.taskLabel}</div>
          {preview.lines.slice(0, 6).map((line, index) => <code key={`${line}-${index}`}>{line}</code>)}
          <strong>{preview.outcomeLabel}</strong>
          <small>Reviewed fixture · {preview.reviewCaseId}</small>
        </div>
      ) : null}
      <div className="ss-card-evidence"><span>{capability.contextCost.approxTokens.toLocaleString()} estimated tokens</span><span>{capability.release.version}</span></div>
      {!allowed ? <div className="ss-block-copy">Install handoff blocked: {item.clientHandoff.reason === "stale_or_ineligible_evidence" ? "evidence is stale or no longer eligible" : `release is ${capability.trust.status}`}.</div> : null}
      <div className="ss-card-actions">
        <ShellLink href={buildSuperSkillRoute({ name: "capability", capabilityId: capability.id })}>Trust report</ShellLink>
        <ShellLink href={capabilityShareUrl(capability.id)}>Share preview</ShellLink>
        {allowed ? <ShellLink className="ss-link--primary" href={buildSuperSkillRoute({ name: "install", capabilityId: capability.id })}>Client handoff</ShellLink> : <span className="ss-disabled-action" aria-disabled="true">Install blocked</span>}
      </div>
      <div className="ss-digest" title={capability.release.artifactDigest}>{capability.release.artifactDigest}</div>
    </article>
  );
}
