import type { SelectedShowroomCapability } from "../../../core/superskill-types";
import { capabilityShareUrl } from "../../../core/share-url";
import { useSelectedShowroomCapabilities } from "../../../core/useSelectedShowroomCapabilities";
import { StatePanel } from "../components/StatePanel";
import { CopyField } from "../components/CopyField";
import { ShellLink } from "../primitives";

export function SelectedSkillPage({ owner, skill }: { owner: string; skill: string }) {
  const selected = useSelectedShowroomCapabilities({ limit: 12 });
  const releaseRef = `${owner}/${skill}`;

  if (selected.state.status === "idle" || selected.state.status === "loading") {
    return <main className="ss-content ss-page"><StatePanel headingLevel={1} kind="loading" title="Loading selected skill" reason="Reading the current candidate projection." /></main>;
  }
  if (selected.state.status === "error") {
    return <main className="ss-content ss-page"><StatePanel headingLevel={1} kind="error" title="Selected skill unavailable" reason={selected.state.reason} next={selected.state.next} onRetry={selected.refresh}><ShellLink href="#/superskill">Open showroom</ShellLink></StatePanel></main>;
  }
  if (selected.state.status === "not_found") {
    return <main className="ss-content ss-page"><StatePanel headingLevel={1} kind="not-found" title="Selected skill not found" reason={selected.state.reason} next={selected.state.next}><ShellLink href="#/superskill">Open showroom</ShellLink></StatePanel></main>;
  }

  const item = selected.state.data.items.find((candidate) => candidate.capability.release.ref === releaseRef);
  if (!item) {
    return <main className="ss-content ss-page"><StatePanel headingLevel={1} kind="not-found" title="Selected skill not found" reason="This skill is not in the current reviewed intake shelf." next="Return to the showroom and open a current selected skill."><ShellLink href="#/superskill">Open showroom</ShellLink></StatePanel></main>;
  }

  return <SelectedSkillDetail item={item} />;
}

function SelectedSkillDetail({ item }: { item: SelectedShowroomCapability }) {
  const { capability } = item;
  return (
    <main className="ss-content ss-page ss-selected-detail">
      <ShellLink className="ss-detail-back" href="#/superskill">← Back to showroom</ShellLink>
      <header className="ss-selected-detail-head">
        <div className="ss-card-top">
          <span className="ss-type-chip">instruction harness</span>
          <span className="ss-selected-status">Selected · review pending</span>
        </div>
        <h1>{capability.title}</h1>
        <p>{capability.summary}</p>
        <div className="ss-selected-jobs" aria-label="Task categories">
          {capability.jobs.map((job) => <span key={job.id}>{job.id.replaceAll("-", " ")}</span>)}
        </div>
      </header>

      <div className="ss-selected-detail-grid">
        <section>
          <div className="ss-evidence-label">Candidate release</div>
          <dl className="ss-facts">
            <div><dt>Release</dt><dd>{capability.release.version}</dd></div>
            <div><dt>Reference</dt><dd>{capability.release.ref}</dd></div>
            <div><dt>Artifact</dt><dd>{shortDigest(capability.release.artifactDigest)}</dd></div>
            <div><dt>Delivery</dt><dd>{capability.release.delivery.replaceAll("_", " ")}</dd></div>
          </dl>
        </section>
        <section>
          <div className="ss-evidence-label">Current managed state</div>
          <div className="ss-selected-detail-state">
            <strong>Exact review is still required</strong>
            <p>This candidate is visible for discovery only. It is not approved, verified, or available for managed activation.</p>
            <span>handoff: {item.managedHandoff.status} · reason: {item.managedHandoff.reason}</span>
          </div>
        </section>
      </div>

      <section className="ss-selected-scope">
        <div className="ss-evidence-label">Declared task scope</div>
        {capability.jobs.map((job) => (
          <article key={job.id}>
            <h2>{job.id.replaceAll("-", " ")}</h2>
            <p><strong>Expected outcomes:</strong> {job.outcomes.join(" · ") || "Not declared"}</p>
            <p><strong>Exclusions:</strong> {job.exclusions.join(" · ") || "None declared"}</p>
          </article>
        ))}
      </section>

      <CopyField label="Share this selected-skill preview" value={capabilityShareUrl(capability.id)} />

      <div className="ss-selected-detail-actions">
        <ShellLink href="#/superskill">Browse selected skills</ShellLink>
        <span className="ss-disabled-action" aria-disabled="true">Managed install pending review</span>
      </div>
    </main>
  );
}

function shortDigest(digest: string): string {
  return digest.length > 26 ? `${digest.slice(0, 18)}…${digest.slice(-8)}` : digest;
}
