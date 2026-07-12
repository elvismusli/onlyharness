import type { SelectedShowroomCapability } from "../../../core/superskill-types";
import { ShellLink } from "../primitives";

export function SelectedSkillCard({ item }: { item: SelectedShowroomCapability }) {
  const { capability } = item;
  const classicHref = classicHarnessHref(capability.release.ref);

  return (
    <article className="ss-skill-card ss-selected-card">
      <div className="ss-card-top">
        <span className="ss-type-chip">instruction harness</span>
        <span className="ss-selected-status">Selected · review pending</span>
      </div>
      <h3>{capability.title}</h3>
      <p>{capability.summary}</p>
      <div className="ss-selected-jobs" aria-label="Task categories">
        {capability.jobs.slice(0, 3).map((job) => <span key={job.id}>{job.id.replaceAll("-", " ")}</span>)}
      </div>
      <div className="ss-card-evidence">
        <span>candidate release</span>
        <span>{capability.release.version}</span>
      </div>
      <div className="ss-pending-copy">Selected for exact review. This is not an approval, trust badge, or managed activation claim.</div>
      <div className="ss-card-actions">
        <ShellLink href={classicHref}>Open classic listing</ShellLink>
        <span className="ss-disabled-action" aria-disabled="true">Managed install pending review</span>
      </div>
    </article>
  );
}

function classicHarnessHref(ref: string): string {
  const separator = ref.indexOf("/");
  const owner = separator > 0 ? ref.slice(0, separator) : "harnesses";
  const name = separator > 0 ? ref.slice(separator + 1) : ref;
  return `/?skin=win98#/h/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}
