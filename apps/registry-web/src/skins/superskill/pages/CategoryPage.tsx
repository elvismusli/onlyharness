import { useShowroomCapabilities } from "../../../core/useShowroomCapabilities";
import { SkillCard } from "../components/SkillCard";
import { StatePanel } from "../components/StatePanel";
import { SectionHeading } from "../primitives";

export function CategoryPage({ job }: { job: string }) {
  const showroom = useShowroomCapabilities({ limit: 7, job });
  return (
    <main className="ss-content ss-page ss-category">
      <SectionHeading eyebrow="curated task category">Resources for {job.replaceAll("-", " ")}</SectionHeading>
      <p>These are server-curated exact releases. They are not ranked unless routing evidence explicitly says so.</p>
      {showroom.state.status === "loading" || showroom.state.status === "idle" ? <StatePanel kind="loading" title="Loading curated releases" /> : null}
      {showroom.state.status === "empty" ? <StatePanel kind="empty" title="No approved releases in this category" reason="The catalog is staying empty instead of showing unchecked candidates." next="Use the client plugin for an honest no-match decision." /> : null}
      {showroom.state.status === "error" ? <StatePanel kind="error" title="Category unavailable" reason={showroom.state.reason} next={showroom.state.next} onRetry={showroom.refresh} /> : null}
      {showroom.state.status === "success" ? <div className="ss-card-grid">{showroom.state.data.items.slice(0, 7).map((item) => <SkillCard key={item.capability.id} item={item} label="Curated" />)}</div> : null}
    </main>
  );
}
