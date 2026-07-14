import { useState } from "react";

import type { SuperSkillClient } from "../../../core/superskill-types";
import { superskillInstallHandoff } from "../../../core/superskill-install";
import { useSelectedShowroomCapabilities } from "../../../core/useSelectedShowroomCapabilities";
import { useShowroomCapabilities } from "../../../core/useShowroomCapabilities";
import { ExampleSkillCard } from "../components/ExampleSkillCard";
import { SelectedSkillCard } from "../components/SelectedSkillCard";
import { SkillCard } from "../components/SkillCard";
import { StatePanel } from "../components/StatePanel";
import { CopyField } from "../components/CopyField";
import { TaskPrompt } from "../components/TaskPrompt";
import { SectionHeading } from "../primitives";
import { InstallInstructions } from "./InstallHandoff";

export function Landing() {
  const showroom = useShowroomCapabilities({ limit: 6 });
  const selected = useSelectedShowroomCapabilities({ limit: 12 });
  const [handoff, setHandoff] = useState<{ task: string; client: SuperSkillClient } | null>(null);
  const items = showroom.state.status === "success" || showroom.state.status === "empty" ? showroom.state.data.items : [];
  const selectedTotal = selected.state.status === "success" || selected.state.status === "empty" ? selected.state.data.total : undefined;
  const featured = items[0];
  const installer = superskillInstallHandoff();
  return (
    <main>
      <section className="ss-hero">
        <div className="ss-aurora" aria-hidden />
        <div className="ss-hero-copy"><div className="ss-eyebrow">SuperSkill · one link for Codex and Claude Code</div><h1>Paste one link.<br /><em>Give your agent every skill.</em></h1><p>Copy the universal SuperSkill link into your coding agent. It installs the plugin, connects the catalog, and keeps every later skill choice explicit.</p></div>
        {installer.status === "available" ? (
          <div className="ss-one-link-card">
            <div className="ss-one-link-head"><span>01</span><div><strong>Universal SuperSkill link</strong><small>Paste into Codex or Claude Code</small></div></div>
            <CopyField label="One link — paste it into your agent" value={installer.installUrl} />
            <div className="ss-one-link-foot"><span>Exact runtime: {installer.runtime}</span><a href="#/superskill/install">See manual install and safety details →</a></div>
          </div>
        ) : <StatePanel kind="blocked" title="Universal link temporarily unavailable" reason={installer.reason} next="Wait for the pinned public runtime; no unverified fallback is shown." />}
        <div className="ss-task-start"><span>or start with the outcome</span><TaskPrompt onContinue={(task, client) => setHandoff({ task, client })} /></div>
      </section>

      {handoff ? <div className="ss-content ss-handoff-inline"><InstallInstructions client={handoff.client} setClient={(client) => setHandoff({ ...handoff, client })} task={handoff.task} /></div> : null}

      <section className="ss-content ss-featured-section">
        <SectionHeading eyebrow="one exact release">Featured from the managed showroom</SectionHeading>
        {showroom.state.status === "loading" || showroom.state.status === "idle" ? <StatePanel kind="loading" title="Loading approved releases" reason="Reading the public showroom projection." /> : null}
        {showroom.state.status === "error" ? <StatePanel kind="error" title="Showroom API unavailable" reason={showroom.state.reason} next={showroom.state.next} onRetry={showroom.refresh} /> : null}
        {showroom.state.status === "empty" ? <><StatePanel kind="empty" title="No approved public releases yet" reason="No release is being promoted without an approved exact digest." next="You can still install the client plugin and use its honest no-match flow." /><ExampleSkillCard /></> : null}
        {featured ? <SkillCard item={featured} variant="featured" label="Featured · curated, not popularity-ranked" /> : null}
      </section>

      {items.length > 1 ? <section className="ss-content ss-catalog"><SectionHeading eyebrow="reviewed fixture previews">Watch skills work before you install</SectionHeading><p>Preview slots appear only when a checked-in reviewed fixture matches the exact artifact digest.</p><div className="ss-card-grid">{items.slice(1, 6).map((item) => <SkillCard key={item.capability.id} item={item} />)}</div></section> : null}

      <section className="ss-content ss-catalog ss-selected-shelf">
        <SectionHeading eyebrow="selected · review pending">{selectedTotal === undefined ? "Skills selected for exact review" : `${selectedTotal} skills selected for exact review`}</SectionHeading>
        <p>These resources are visible as selected review candidates. Managed install stays disabled until an exact release passes the full SuperSkill approval gate.</p>
        {selected.state.status === "loading" || selected.state.status === "idle" ? <StatePanel kind="loading" title="Loading selected skills" reason="Reading the public review queue." /> : null}
        {selected.state.status === "error" ? <StatePanel kind="error" title="Selected shelf unavailable" reason={selected.state.reason} next={selected.state.next} onRetry={selected.refresh} /> : null}
        {selected.state.status === "empty" ? <StatePanel kind="empty" title="No selected skills yet" reason="Nothing is being presented as selected without a checked-in catalog record." /> : null}
        {selected.state.status === "success" ? <div className="ss-card-grid">{selected.state.data.items.map((item) => <SelectedSkillCard key={item.capability.id} item={item} />)}</div> : null}
      </section>

      <section className="ss-check-explainer"><div className="ss-content"><SectionHeading eyebrow="evidence over badges">Named checks, dates, digest, limitations</SectionHeading><div className="ss-explainer-grid"><article><strong>Exact artifact</strong><p>Trust follows the immutable release digest, not a resource name or author.</p></article><article><strong>Named observations</strong><p>Pass, warn, fail, and not run stay visible per check.</p></article><article><strong>Mandatory limits</strong><p>Every trust report says what its evidence does not cover.</p></article></div></div></section>
    </main>
  );
}
