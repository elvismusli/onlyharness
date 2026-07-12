import { useState } from "react";

import type { SuperSkillClient } from "../../../core/superskill-types";
import { useShowroomCapabilities } from "../../../core/useShowroomCapabilities";
import { SkillCard } from "../components/SkillCard";
import { StatePanel } from "../components/StatePanel";
import { TaskPrompt } from "../components/TaskPrompt";
import { SectionHeading } from "../primitives";
import { InstallInstructions } from "./InstallHandoff";

export function Landing() {
  const showroom = useShowroomCapabilities({ limit: 6 });
  const [handoff, setHandoff] = useState<{ task: string; client: SuperSkillClient } | null>(null);
  const items = showroom.state.status === "success" || showroom.state.status === "empty" ? showroom.state.data.items : [];
  const featured = items[0];
  return (
    <main>
      <section className="ss-hero">
        <div className="ss-aurora" aria-hidden />
        <div className="ss-hero-copy"><div className="ss-eyebrow">SuperSkill · client-first capability routing</div><h1>Describe the task.<br /><em>Continue with exact evidence.</em></h1><p>Choose a terminal client, then carry the task into Claude Code or Codex. The client performs recommendation and asks for explicit activation consent.</p></div>
        <TaskPrompt onContinue={(task, client) => setHandoff({ task, client })} />
      </section>

      {handoff ? <div className="ss-content ss-handoff-inline"><InstallInstructions client={handoff.client} setClient={(client) => setHandoff({ ...handoff, client })} task={handoff.task} /></div> : null}

      <section className="ss-content ss-featured-section">
        <SectionHeading eyebrow="one exact release">Featured from the managed showroom</SectionHeading>
        {showroom.state.status === "loading" || showroom.state.status === "idle" ? <StatePanel kind="loading" title="Loading approved releases" reason="Reading the public showroom projection." /> : null}
        {showroom.state.status === "error" ? <StatePanel kind="error" title="Showroom API unavailable" reason={showroom.state.reason} next={showroom.state.next} onRetry={showroom.refresh} /> : null}
        {showroom.state.status === "empty" ? <StatePanel kind="empty" title="No approved public releases yet" reason="No release is being promoted without an approved exact digest." next="You can still install the client plugin and use its honest no-match flow." /> : null}
        {featured ? <SkillCard item={featured} variant="featured" label="Featured · curated, not popularity-ranked" /> : null}
      </section>

      {items.length > 1 ? <section className="ss-content ss-catalog"><SectionHeading eyebrow="reviewed fixture previews">Watch skills work before you install</SectionHeading><p>Preview slots appear only when a checked-in reviewed fixture matches the exact artifact digest.</p><div className="ss-card-grid">{items.slice(1, 6).map((item) => <SkillCard key={item.capability.id} item={item} />)}</div></section> : null}

      <section className="ss-check-explainer"><div className="ss-content"><SectionHeading eyebrow="evidence over badges">Named checks, dates, digest, limitations</SectionHeading><div className="ss-explainer-grid"><article><strong>Exact artifact</strong><p>Trust follows the immutable release digest, not a resource name or author.</p></article><article><strong>Named observations</strong><p>Pass, warn, fail, and not run stay visible per check.</p></article><article><strong>Mandatory limits</strong><p>Every trust report says what its evidence does not cover.</p></article></div></div></section>
    </main>
  );
}
