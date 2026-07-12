import { useState } from "react";

import { superskillInstallCommands } from "../../../core/superskill-install";
import type { ShowroomCapability, SuperSkillClient } from "../../../core/superskill-types";
import { installAllowed } from "../../../core/superskill-types";
import { useShowroomCapability } from "../../../core/useShowroomCapability";
import { CopyField } from "../components/CopyField";
import { StatePanel } from "../components/StatePanel";
import { SectionHeading, ShellLink } from "../primitives";

export function InstallHandoff({ capabilityId, initialClient = "claude-code", task = "" }: { capabilityId?: string; initialClient?: SuperSkillClient; task?: string }) {
  const [client, setClient] = useState<SuperSkillClient>(initialClient);
  const detail = useShowroomCapability(capabilityId);
  if (capabilityId && (detail.state.status === "idle" || detail.state.status === "loading")) return <StatePanel kind="loading" title="Loading exact release" reason="Reading the public trust projection before showing client steps." />;
  if (detail.state.status === "not_found") return <StatePanel kind="not-found" title="Resource not found" reason={detail.state.reason} next="Return to the showroom and choose a current resource." />;
  if (detail.state.status === "error") return <StatePanel kind="error" title="Install handoff unavailable" reason={detail.state.reason} next={detail.state.next} onRetry={detail.refresh} />;
  const item = detail.state.status === "success" ? detail.state.data : undefined;
  return <InstallInstructions client={client} setClient={setClient} item={item} task={task} />;
}

export function InstallInstructions({ client, setClient, item, task }: { client: SuperSkillClient; setClient: (client: SuperSkillClient) => void; item?: ShowroomCapability; task?: string }) {
  const capability = item?.capability;
  if (capability && !installAllowed(capability, item?.clientHandoff)) {
    const reason = item?.clientHandoff.reason === "stale_or_ineligible_evidence" ? "stale evidence" : capability.trust.status;
    return <StatePanel kind="blocked" title={`Client handoff blocked — ${reason}`} reason="This exact release cannot be handed to a client." next="Return to its trust report for limitations and replacement information."><ShellLink href={`#/superskill/c/${capability.id}`}>Open trust report</ShellLink></StatePanel>;
  }
  const commands = superskillInstallCommands(client);
  return (
    <section className="ss-install" aria-labelledby="ss-install-title">
      <SectionHeading eyebrow="client handoff"><span id="ss-install-title">Continue in your existing agent</span></SectionHeading>
      {capability ? <p>Resource: <strong>{capability.title}</strong> · release {capability.release.version}. Installation and recommendation happen in the terminal client, not this page.</p> : <p>Install the shared SuperSkill plugin, start a fresh client session, then paste the task. The showroom does not claim activation.</p>}
      <div className="ss-client-tabs" role="group" aria-label="Choose terminal client"><button type="button" aria-pressed={client === "claude-code"} onClick={() => setClient("claude-code")}>Claude Code</button><button type="button" aria-pressed={client === "codex"} onClick={() => setClient("codex")}>Codex CLI</button></div>
      <div className="ss-install-steps">
        <div><span>1</span><h3>Add the OnlyHarness marketplace</h3><CopyField label={`${commands.clientLabel} marketplace command`} value={commands.marketplaceCommand} /></div>
        <div><span>2</span><h3>Install the SuperSkill plugin</h3><CopyField label={`${commands.clientLabel} plugin command`} value={commands.pluginCommand} /></div>
        <div><span>3</span><h3>Verify the exact CLI runtime</h3><CopyField label={`OnlyHarness ${commands.runtimeCheckCommand.match(/onlyharness@([^ ]+)/)?.[1] ?? "runtime"} check`} value={commands.runtimeCheckCommand} /></div>
        <div><span>4</span><h3>Start a new task</h3><p>{commands.restartCopy}</p>{task ? <CopyField label="Original task — paste as plain text" value={task} /> : <p>Paste your task into the new session. The plugin will request explicit consent before any managed activation.</p>}</div>
      </div>
      <aside className="ss-manual-fallback"><strong>If the plugin command does not open the flow</strong><ol><li>Confirm Node.js and npm are available.</li><li>Run the exact runtime check above.</li><li>Start a new terminal client session and ask it to use SuperSkill for the task.</li></ol></aside>
      <div className="ss-honest-state" aria-live="polite">Copying a command only copies text. It does not mean Installed, Detected, Loaded, or Invoked.</div>
    </section>
  );
}
