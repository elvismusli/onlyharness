import { useState } from "react";

import type { ManagedCapability, PermissionDelta as PermissionDeltaData } from "../../../core/superskill-types";
import { capabilityVerdict } from "../../../core/superskill-types";
import { SSButton } from "../primitives";
import { PermissionDelta } from "./PermissionDelta";
import { VerdictChip } from "./VerdictChip";

const CHECK_LABELS: Record<string, string> = {
  schema: "Schema",
  artifact_digest: "Artifact digest",
  source_license: "Source and license",
  static_security: "Static security",
  capability_diff: "Declared vs static observations",
  claude_code_activation: "Claude Code activation",
  codex_activation: "Codex activation",
  human_review: "Human review",
  independent_eval: "Independent evaluation"
};

export function ConsentPanel({
  tier,
  delta,
  capability,
  onConfirm,
  onCancel,
  onAlternatives
}: {
  tier: "T2" | "T3";
  delta: PermissionDeltaData;
  capability?: ManagedCapability;
  onConfirm?: () => void;
  onCancel?: () => void;
  onAlternatives?: () => void;
}) {
  const [understood, setUnderstood] = useState(false);
  return (
    <section className={`ss-consent ss-consent--${tier.toLowerCase()}`} aria-labelledby="ss-consent-title">
      <h2 id="ss-consent-title">{tier === "T3" ? "Critical powers require deliberate consent" : "Review before activation"}</h2>
      <p>This disclosure is what the terminal client will show. The web showroom does not activate the resource.</p>

      {tier === "T2" ? (
        <>
          <div className="ss-why-this">
            <div>
              <span>Fit</span>
              <span>{capability ? capability.summary : "Confirm the new powers below match your task before continuing."}</span>
            </div>
          </div>
          <p className="ss-delta-note">
            {capability ? (
              <>Trust: <VerdictChip verdict={capabilityVerdict(capability)} namedCheckCount={capability.trust.checks.length} /></>
            ) : (
              "Trust: the client shows the full trust report before activation."
            )}
          </p>
        </>
      ) : null}

      {tier === "T3" ? (capability ? <TrustEmbed capability={capability} /> : <p className="ss-delta-note">Full trust report — verdict, named checks, and limitations — is shown in your client before activation.</p>) : null}

      <PermissionDelta delta={delta} />

      {tier === "T3" ? (
        <label className="ss-hard-confirm">
          <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} /> I understand the critical powers listed above
        </label>
      ) : null}

      <div className="ss-consent-actions">
        <SSButton type="button" variant="secondary" onClick={onCancel}>Cancel</SSButton>
        {tier === "T2" ? <SSButton type="button" variant="secondary" onClick={onAlternatives}>See alternatives</SSButton> : null}
        <SSButton type="button" variant={tier === "T3" ? "danger" : "primary"} disabled={tier === "T3" && !understood} onClick={onConfirm}>Continue in client</SSButton>
      </div>
    </section>
  );
}

function TrustEmbed({ capability }: { capability: ManagedCapability }) {
  const verdict = capabilityVerdict(capability);
  const checks = capability.trust.checks;
  const limitations = capability.trust.limitations;
  return (
    <div className="ss-trust-embed">
      <VerdictChip verdict={verdict} namedCheckCount={checks.length} />
      <h3>Named checks</h3>
      {checks.length ? (
        <ul>
          {checks.map((check) => (
            <li key={check.id} data-status={check.status}>
              <strong>{CHECK_LABELS[check.id] ?? check.id}</strong> · {check.status.replace("_", " ")} · <span className="ss-check-summary">{check.summary}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ss-delta-note">◌ No named checks were supplied. This release is not treated as passed.</p>
      )}
      <h3>Limitations — what these checks do not cover</h3>
      {limitations.length ? (
        <ul>{limitations.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : (
        <p className="ss-delta-note">No limitations were supplied. Treat the trust report as incomplete.</p>
      )}
    </div>
  );
}
