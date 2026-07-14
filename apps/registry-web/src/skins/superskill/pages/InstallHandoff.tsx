import { buildSuperSkillRoute } from "../../../core/superskill-route";
import { superskillInstallHandoff } from "../../../core/superskill-install";
import type { ShowroomCapability, SuperSkillClient } from "../../../core/superskill-types";
import { installAllowed } from "../../../core/superskill-types";
import { useShowroomCapability } from "../../../core/useShowroomCapability";
import { CopyField } from "../components/CopyField";
import { StatePanel } from "../components/StatePanel";
import { PageHeading, SectionHeading, ShellLink } from "../primitives";

export function InstallHandoff({ capabilityId, initialClient = "claude-code", task = "" }: { capabilityId?: string; initialClient?: SuperSkillClient; task?: string }) {
  const detail = useShowroomCapability(capabilityId);
  if (capabilityId && (detail.state.status === "idle" || detail.state.status === "loading")) return <StatePanel headingLevel={1} kind="loading" title="Loading exact release" reason="Reading the public trust projection before showing client steps." />;
  if (detail.state.status === "not_found") return <StatePanel headingLevel={1} kind="not-found" title="Resource not found" reason={detail.state.reason} next="Return to the showroom and choose a current resource."><ShellLink href={buildSuperSkillRoute({ name: "landing" })}>Open showroom</ShellLink>{capabilityId ? <ShellLink href={buildSuperSkillRoute({ name: "capability", capabilityId })}>Open trust report</ShellLink> : null}</StatePanel>;
  if (detail.state.status === "error") return <StatePanel headingLevel={1} kind="error" title="Install handoff unavailable" reason={detail.state.reason} next={detail.state.next} onRetry={detail.refresh}><ShellLink href={buildSuperSkillRoute({ name: "landing" })}>Open showroom</ShellLink>{capabilityId ? <ShellLink href={buildSuperSkillRoute({ name: "capability", capabilityId })}>Open trust report</ShellLink> : null}</StatePanel>;
  const item = detail.state.status === "success" ? detail.state.data : undefined;
  return <InstallInstructions client={initialClient} setClient={() => undefined} item={item} task={task} pageHeading />;
}

export function InstallInstructions({ client, setClient, item, task, pageHeading = false }: { client: SuperSkillClient; setClient: (client: SuperSkillClient) => void; item?: ShowroomCapability; task?: string; pageHeading?: boolean }) {
  const capability = item?.capability;
  if (capability && !installAllowed(capability, item?.clientHandoff)) {
    const reason = item?.clientHandoff.reason === "stale_or_ineligible_evidence" ? "stale evidence" : capability.trust.status;
    return <StatePanel headingLevel={pageHeading ? 1 : 2} kind="blocked" title={`Client handoff blocked — ${reason}`} reason="This exact release cannot be handed to a client." next="Return to its trust report for limitations and replacement information."><ShellLink href={buildSuperSkillRoute({ name: "capability", capabilityId: capability.id })}>Open trust report</ShellLink><ShellLink href={buildSuperSkillRoute({ name: "landing" })}>Open showroom</ShellLink></StatePanel>;
  }
  const handoff = superskillInstallHandoff(capability);
  if (handoff.status === "unavailable") {
    return <StatePanel
      headingLevel={pageHeading ? 1 : 2}
      kind="blocked"
      title="Universal installer not available yet"
      reason={handoff.reason}
      next="Wait for the exact CLI release and official npm integrity to be published. No install command is safe to copy yet."
    />;
  }
  return (
    <section className="ss-install" aria-labelledby="ss-install-title">
      {pageHeading ? <PageHeading eyebrow="client handoff"><span id="ss-install-title">Continue in your existing agent</span></PageHeading> : <SectionHeading eyebrow="client handoff"><span id="ss-install-title">Continue in your existing agent</span></SectionHeading>}
      {capability ? <p>Resource: <strong>{capability.title}</strong> · release {capability.release.version}. Installation and recommendation happen in the terminal client, not this page.</p> : <p>Install the shared SuperSkill plugin, start a fresh client session, then paste the task. The showroom does not claim activation.</p>}
      <div className="ss-install-steps">
        <div><span>1</span><h3>Run one pinned install command</h3><CopyField label="Universal SuperSkill install command" value={handoff.installCommand} /><p>The embedded <a href={handoff.installUrl}>exact install link</a> contains no token or task text. The local installer verifies its manifest integrity, then detects Codex or Claude Code without guessing.</p></div>
        <div><span>2</span><h3>Resolve the client safely</h3><p>Exactly one detected client gets its native skill root plus a merged project-local <code>superskill_local</code> MCP config. An exact link also records one private pending handoff. Existing unrelated config is preserved, collisions and rollback faults fail closed, and no token is written. If both or neither clients are detected, choose <code>--target codex</code>, <code>--target claude-code</code>, or explicit <code>--all</code>.</p></div>
        <div><span>3</span><h3>Start a new task</h3>{task ? <CopyField label="Original task — paste as plain text" value={task} /> : <p>Start a fresh client task. The universal skill will recheck the exact release and request separate explicit consent before any managed activation.</p>}</div>
      </div>
      <aside className="ss-manual-fallback"><strong>Safety boundary</strong><ol><li>The command uses the pinned integrity-verified public runtime; it never downloads or pipes a remote script.</li><li>Use <code>--dry-run</code> to verify the link, skill target, MCP merge and pending-handoff plan without writing.</li><li>Installation never activates a capability. The new session uses the local MCP lifecycle; routing and activation consent remain separate.</li></ol></aside>
      <div className="ss-honest-state" aria-live="polite">Copying a command only copies text. It does not mean Installed, Detected, Loaded, or Invoked.</div>
    </section>
  );
}
