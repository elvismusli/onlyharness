import { useSelectedShowroomCapabilities } from "../../../core/useSelectedShowroomCapabilities";
import { useShowroomCapabilities } from "../../../core/useShowroomCapabilities";
import { SelectedSkillCard } from "../components/SelectedSkillCard";
import { SkillCard } from "../components/SkillCard";
import { StatePanel } from "../components/StatePanel";
import { PageHeading } from "../primitives";

export function CategoryPage({ job }: { job: string }) {
  const showroom = useShowroomCapabilities({ limit: 7, job });
  const selected = useSelectedShowroomCapabilities({ limit: 12, job, enabled: showroom.state.status === "empty" });
  return (
    <main className="ss-content ss-page ss-category">
      <PageHeading eyebrow="curated task category">Resources for {job.replaceAll("-", " ")}</PageHeading>
      <p>These are server-curated exact releases. They are not ranked unless routing evidence explicitly says so.</p>
      {showroom.state.status === "loading" || showroom.state.status === "idle" ? <StatePanel kind="loading" title="Loading curated releases" /> : null}
      {showroom.state.status === "empty" ? <div className="ss-category-selected"><StatePanel kind="empty" title="No approved releases in this category" reason="Selected resources below are still awaiting exact review." next="Managed install remains disabled until approval." />
        {selected.state.status === "loading" || selected.state.status === "idle" ? <StatePanel kind="loading" title="Loading selected skills" /> : null}
        {selected.state.status === "error" ? <StatePanel kind="error" title="Selected skills unavailable" reason={selected.state.reason} next={selected.state.next} onRetry={selected.refresh} /> : null}
        {selected.state.status === "empty" ? <StatePanel kind="empty" title="No selected skills in this category" /> : null}
        {selected.state.status === "success" ? <><div className="ss-evidence-label">Selected · review pending</div><div className="ss-card-grid">{selected.state.data.items.map((item) => <SelectedSkillCard key={item.capability.id} item={item} />)}</div></> : null}
      </div> : null}
      {showroom.state.status === "error" ? <StatePanel kind="error" title="Category unavailable" reason={showroom.state.reason} next={showroom.state.next} onRetry={showroom.refresh} /> : null}
      {showroom.state.status === "success" ? <div className="ss-card-grid">{showroom.state.data.items.slice(0, 7).map((item) => <SkillCard key={item.capability.id} item={item} label="Curated" />)}</div> : null}
    </main>
  );
}
