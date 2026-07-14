import { buildSuperSkillRoute } from "../../../core/superskill-route";
import type { SelectedShowroomCapability } from "../../../core/superskill-types";
import { ShellLink } from "../primitives";
import { CopyField } from "./CopyField";
import { resourceTypeLabel } from "./SkillCard";

export function SelectedSkillCard({ item }: { item: SelectedShowroomCapability }) {
  const { capability } = item;
  const detailHref = selectedSkillHref(capability.release.ref);

  return (
    <article className="ss-skill-card ss-selected-card">
      <div className="ss-card-top">
        <span className="ss-type-chip">{resourceTypeLabel(capability.type)}</span>
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
      <CopyField label="Artifact digest" value={capability.release.artifactDigest} />
      <div className="ss-pending-copy">Selected for exact review. This is not an approval, trust badge, or managed activation claim.</div>
      <div className="ss-card-actions">
        <ShellLink href={detailHref}>View selected skill</ShellLink>
        <span className="ss-disabled-action" aria-disabled="true">Managed install pending review</span>
      </div>
    </article>
  );
}

function selectedSkillHref(ref: string): string {
  const separator = ref.indexOf("/");
  const owner = separator > 0 ? ref.slice(0, separator) : "harnesses";
  const name = separator > 0 ? ref.slice(separator + 1) : ref;
  return buildSuperSkillRoute({ name: "selected", owner, skill: name });
}
