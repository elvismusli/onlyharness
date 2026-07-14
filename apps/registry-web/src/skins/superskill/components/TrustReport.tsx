import { capabilityRequiresIndependentReview } from "@harnesshub/capability-schema/browser";

import type { ManagedCapability, ManagedPermissions, TrustCheck } from "../../../core/superskill-types";
import { capabilityVerdict } from "../../../core/superskill-types";
import { CopyField } from "./CopyField";
import { VerdictChip } from "./VerdictChip";

type CheckId = TrustCheck["id"];
type CheckStatus = TrustCheck["status"];
type Risk = "low" | "elevated" | "critical";

const CHECK_LABELS: Record<CheckId, string> = {
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

// Canonical presentation order: provenance → digest/SBOM → secret/static scan →
// SCA/license → capability diff → behavioral/activation eval → human review.
const CHECK_ORDER: CheckId[] = [
  "schema",
  "artifact_digest",
  "static_security",
  "source_license",
  "capability_diff",
  "claude_code_activation",
  "codex_activation",
  "independent_eval",
  "human_review"
];

// Checks the pipeline is expected to run for every managed release. When one is
// absent from the data it is shown as not_run rather than silently omitted.
const MANDATED_CHECKS: CheckId[] = [
  "schema",
  "artifact_digest",
  "static_security",
  "source_license",
  "capability_diff",
  "claude_code_activation",
  "codex_activation",
  "human_review"
];

const STATUS_GLYPH: Record<CheckStatus, string> = {
  pass: "✓",
  warn: "⚠",
  fail: "✕",
  not_run: "◌"
};

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  instruction_harness: "Resource"
};

export function TrustReport({ capability }: { capability: ManagedCapability }) {
  const verdict = capabilityVerdict(capability);
  const passed = capability.trust.checks.filter((check) => check.status === "pass").length;
  const rows = orderedCheckRows(capability);
  return (
    <article className="ss-trust-report">
      <header className="ss-trust-head">
        <div>
          <VerdictChip verdict={verdict} namedCheckCount={capability.trust.checks.length} />
          <h1>{capability.title}</h1>
          <div className="ss-evidence">Release {capability.release.version} · reviewed {formatDate(capability.trust.reviewedAt)} · {passed} passed</div>
        </div>
        <div className="ss-type-chip">{resourceTypeLabel(capability.type)}</div>
      </header>

      <CopyField label="Full artifact digest" value={capability.release.artifactDigest} />

      <section className="ss-trust-section">
        <h2>Named checks</h2>
        <div className="ss-check-table" role="table" aria-label="Named trust checks">
          <div className="ss-check-row ss-check-row--head" role="row"><span role="columnheader">Named check</span><span role="columnheader">Result</span><span role="columnheader">Evidence</span><span role="columnheader">Date</span></div>
          {rows.map((row) => (
            <div className="ss-check-row" role="row" key={row.id}>
              <span role="cell" data-label="Named check">{CHECK_LABELS[row.id] ?? row.id}</span>
              <span role="cell" data-label="Result" className={`ss-check-status ss-check-status--${row.status}`}>{STATUS_GLYPH[row.status]} {row.status.replace("_", " ")}</span>
              <span role="cell" data-label="Evidence">{row.check ? row.check.evidenceLevel.replaceAll("_", " ") : "—"}</span>
              <span role="cell" data-label="Date">{row.check ? formatDate(row.check.checkedAt) : "—"}</span>
              <span role="cell" className="ss-check-summary">{row.check ? row.check.summary : "Not part of this release's published evidence."}</span>
            </div>
          ))}
        </div>
        {capability.trust.checks.length === 0 ? <p className="ss-not-run">◌ No named checks were actually run. This release is not treated as passed.</p> : null}
      </section>

      <section className="ss-trust-section">
        <h2>Declared permissions</h2>
        <DeclaredPermissions permissions={capability.permissions} />
      </section>

      <section className="ss-limitations">
        <h2>Limitations — what these checks do not cover</h2>
        {capability.trust.limitations.length ? <ul>{capability.trust.limitations.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No limitations were supplied. Treat the trust report as incomplete.</p>}
      </section>

      <section className="ss-trust-section">
        <h2>Rescan history</h2>
        <p className="ss-not-run">No rescan history yet — only the current release's review on {formatDate(capability.trust.reviewedAt)} is recorded.</p>
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

type CheckRow = { id: CheckId; status: CheckStatus; check: TrustCheck | null };

function orderedCheckRows(capability: ManagedCapability): CheckRow[] {
  const byId = new Map<CheckId, TrustCheck>();
  for (const check of capability.trust.checks) byId.set(check.id, check);
  const mandated = new Set<CheckId>(MANDATED_CHECKS);
  if (capabilityRequiresIndependentReview(capability.id)) mandated.add("independent_eval");

  const displayed = CHECK_ORDER.filter((id) => mandated.has(id) || byId.has(id));
  // Defensive: surface any present check id not covered by the canonical order.
  for (const check of capability.trust.checks) {
    if (!displayed.includes(check.id)) displayed.push(check.id);
  }
  return displayed.map((id) => {
    const check = byId.get(id) ?? null;
    return { id, status: check ? check.status : "not_run", check };
  });
}

function resourceTypeLabel(type: string): string {
  return RESOURCE_TYPE_LABELS[type] ?? humanize(type);
}

function DeclaredPermissions({ permissions }: { permissions: ManagedPermissions }) {
  const rows = declaredPermissionRows(permissions);
  return (
    <>
      <div className="ss-risk-list">
        {rows.length ? rows.map((row) => (
          <div className="ss-risk-row" data-risk={row.risk} key={row.key}>
            <span>{row.risk}</span>
            <span>{row.consequence}</span>
          </div>
        )) : (
          <div className="ss-risk-row" data-risk="low">
            <span>low</span>
            <span>No shell, network, browser, credential, external-send, money-movement, or user-data powers are declared.</span>
          </div>
        )}
      </div>
      {permissions.network !== "false" && permissions.networkAllowlist.length ? (
        <p className="ss-muted">Network allowlist: {permissions.networkAllowlist.join(", ")}</p>
      ) : null}
      {permissions.humanApprovalRequired.length ? (
        <p className="ss-muted">Human approval required before: {permissions.humanApprovalRequired.join(", ")}</p>
      ) : null}
      <p className="ss-delta-note">At install you'll see the exact permission delta against your own setup before anything is granted.</p>
      <p className="ss-muted">These are declared capability powers. The named checks above report observations separately; absence of a static signal is not proof of no runtime behavior.</p>
    </>
  );
}

type RiskRow = { key: string; risk: Risk; consequence: string };

function declaredPermissionRows(p: ManagedPermissions): RiskRow[] {
  const rows: RiskRow[] = [];
  if (p.shell) rows.push({ key: "shell", risk: "critical", consequence: "Can run shell commands on your machine" });
  if (p.moneyMovement) rows.push({ key: "moneyMovement", risk: "critical", consequence: "Can initiate money movement" });
  if (p.externalSend) rows.push({ key: "externalSend", risk: "critical", consequence: "Can send data outside your workspace" });
  if (p.credentials !== "false") rows.push({ key: "credentials", risk: "critical", consequence: p.credentials === "persistent" ? "Can hold persistent credentials" : "Can receive runtime credentials" });
  if (p.browser) rows.push({ key: "browser", risk: "elevated", consequence: "Can operate a browser" });
  if (p.filesystem !== "none") rows.push({ key: "filesystem", risk: "elevated", consequence: p.filesystem === "readonly" ? "Can read files in the project" : "Can read and change files in the project" });
  if (p.network !== "false") rows.push({ key: "network", risk: "elevated", consequence: p.network === "unrestricted" ? "Can reach any network host" : "Can reach allowlisted network hosts" });
  if (p.userData) rows.push({ key: "userData", risk: "elevated", consequence: "Can process user data" });
  return rows;
}

function humanize(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/^./, (char) => char.toUpperCase());
}

function formatDate(value: string) {
  if (!value) return "not dated";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toISOString().slice(0, 10);
}
