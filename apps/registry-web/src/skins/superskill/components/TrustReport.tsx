import type { ManagedCapability } from "../../../core/superskill-types";
import { capabilityVerdict } from "../../../core/superskill-types";
import { CopyField } from "./CopyField";
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

export function TrustReport({ capability }: { capability: ManagedCapability }) {
  const verdict = capabilityVerdict(capability);
  const passed = capability.trust.checks.filter((check) => check.status === "pass").length;
  return (
    <article className="ss-trust-report">
      <header className="ss-trust-head">
        <div>
          <VerdictChip verdict={verdict} namedCheckCount={capability.trust.checks.length} />
          <h1>{capability.title}</h1>
          <div className="ss-evidence">Release {capability.release.version} · reviewed {formatDate(capability.trust.reviewedAt)} · {passed} passed</div>
        </div>
        <div className="ss-type-chip">instruction harness</div>
      </header>

      <CopyField label="Full artifact digest" value={capability.release.artifactDigest} />

      <section className="ss-trust-section">
        <h2>Named checks</h2>
        <div className="ss-check-table" role="table" aria-label="Named trust checks">
          <div className="ss-check-row ss-check-row--head" role="row"><span role="columnheader">Named check</span><span role="columnheader">Result</span><span role="columnheader">Evidence</span><span role="columnheader">Date</span></div>
          {capability.trust.checks.map((check) => (
            <div className="ss-check-row" role="row" key={check.id}>
              <span role="cell" data-label="Named check">{CHECK_LABELS[check.id] ?? check.id}</span>
              <span role="cell" data-label="Result" className={`ss-check-status ss-check-status--${check.status}`}>{check.status === "pass" ? "✓" : check.status === "warn" ? "⚠" : check.status === "fail" ? "✕" : "◌"} {check.status.replace("_", " ")}</span>
              <span role="cell" data-label="Evidence">{check.evidenceLevel.replaceAll("_", " ")}</span>
              <span role="cell" data-label="Date">{formatDate(check.checkedAt)}</span>
              <span className="ss-check-summary">{check.summary}</span>
            </div>
          ))}
          {capability.trust.checks.length === 0 ? <p className="ss-not-run">◌ No named checks were supplied. This release is not treated as passed.</p> : null}
        </div>
      </section>

      <section className="ss-trust-section">
        <h2>Declared permissions</h2>
        <PermissionFacts capability={capability} />
        <p className="ss-muted">These values are declared capability powers. Static checks above report observations separately; absence of a static signal is not proof of no runtime behavior.</p>
      </section>

      <section className="ss-limitations">
        <h2>Limitations — what these checks do not cover</h2>
        {capability.trust.limitations.length ? <ul>{capability.trust.limitations.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No limitations were supplied. Treat the trust report as incomplete.</p>}
      </section>

      <section className="ss-trust-section">
        <h2>Compatibility</h2>
        <ul className="ss-compat-list">
          {capability.compatibility.map((item) => (
            <li key={item.client}><strong>{item.client === "claude-code" ? "Claude Code" : "Codex CLI"}</strong><span>{item.status}</span>{item.verifiedAt ? <time dateTime={item.verifiedAt}>{formatDate(item.verifiedAt)}</time> : <span>not dated</span>}{item.notes ? <small>{item.notes}</small> : null}</li>
          ))}
        </ul>
      </section>

      <section className="ss-trust-section">
        <h2>Release and source</h2>
        <dl className="ss-facts"><div><dt>Published</dt><dd>{formatDate(capability.release.publishedAt)}</dd></div><div><dt>Reference</dt><dd>{capability.release.ref}</dd></div><div><dt>Source</dt><dd><a href={capability.source.url} target="_blank" rel="noreferrer">{capability.source.owner}</a></dd></div><div><dt>License</dt><dd>{capability.source.license}</dd></div></dl>
      </section>
    </article>
  );
}

function PermissionFacts({ capability }: { capability: ManagedCapability }) {
  const p = capability.permissions;
  return <dl className="ss-facts"><div><dt>Filesystem</dt><dd>{p.filesystem}</dd></div><div><dt>Network</dt><dd>{p.network}</dd></div><div><dt>Shell</dt><dd>{p.shell ? "declared" : "not declared"}</dd></div><div><dt>Browser</dt><dd>{p.browser ? "declared" : "not declared"}</dd></div><div><dt>Credentials</dt><dd>{p.credentials}</dd></div><div><dt>External send</dt><dd>{p.externalSend ? "declared" : "not declared"}</dd></div><div><dt>Money movement</dt><dd>{p.moneyMovement ? "declared" : "not declared"}</dd></div><div><dt>User data</dt><dd>{p.userData ? "declared" : "not declared"}</dd></div></dl>;
}

function formatDate(value: string) {
  if (!value) return "not dated";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toISOString().slice(0, 10);
}
