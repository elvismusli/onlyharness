/*
 * A STATIC design illustration of an approved-release card, shown only while the
 * public showroom has no approved release. It is deliberately NOT wired to any
 * real capability, digest, verdict, or install path — it exists purely to show
 * the card craft (preview + evidence styling + motion) honestly, matching the
 * b2a design system's "Example report" pattern. It must never be presented as
 * real, approved, promoted, or installable supply.
 */
export function ExampleSkillCard() {
  return (
    <div className="ss-example" aria-label="Example release card — illustration only">
      <div className="ss-example-tag">Example · illustration — not a real, approved, or installable release</div>
      <article className="ss-skill-card ss-skill-card--featured ss-example-card" aria-hidden="true">
        <div className="ss-card-top">
          <span className="ss-type-chip">harness</span>
          <span className="ss-verdict ss-verdict--not_scanned">example</span>
        </div>
        <div className="ss-evidence-label">Featured · curated, not popularity-ranked</div>
        <h3>Market Research Sprint</h3>
        <p>How an approved release renders — reviewed preview, named-check evidence and an explicit client handoff.</p>
        <div className="ss-perm-chips" aria-label="Permissions">
          <span className="ss-perm-chip" data-risk="elevated">network allowlist</span>
          <span className="ss-perm-chip ss-perm-chip--muted">read-only files</span>
          <span className="ss-perm-chip ss-perm-chip--muted">no shell</span>
          <span className="ss-perm-chip ss-perm-chip--muted">no external send</span>
        </div>
        <div className="ss-preview">
          <div>$ map the ACME market and size the opportunity</div>
          <code>· segment scan ……………… 5 segments</code>
          <code>· sources verified ………… 18 cited</code>
          <code>· synthesis …………………………… drafted</code>
          <strong>Outcome: ranked segments + proof plan</strong>
          <small>Reviewed fixture · example-only</small>
        </div>
        <div className="ss-card-evidence"><span>~12,400 estimated tokens</span><span>v0.3.0</span></div>
        <div className="ss-card-actions">
          <span className="ss-disabled-action">Trust report (example)</span>
          <span className="ss-disabled-action">Client handoff (example)</span>
        </div>
        <div className="ss-digest">sha256:example — illustration only, not a real digest</div>
      </article>
    </div>
  );
}
