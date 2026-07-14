import { buildSuperSkillRoute } from "../../../core/superskill-route";
import { capabilityShareUrl } from "../../../core/share-url";
import { capabilityVerdict, installAllowed } from "../../../core/superskill-types";
import { useShowroomCapability } from "../../../core/useShowroomCapability";
import { StatePanel } from "../components/StatePanel";
import { CopyField } from "../components/CopyField";
import { TrustReport } from "../components/TrustReport";
import { ShellLink } from "../primitives";

export function TrustPage({ capabilityId }: { capabilityId: string }) {
  const detail = useShowroomCapability(capabilityId);
  if (detail.state.status === "idle" || detail.state.status === "loading") return <main className="ss-content ss-page"><StatePanel headingLevel={1} kind="loading" title="Loading trust report" reason="Reading the exact public release projection." /></main>;
  if (detail.state.status === "not_found") return <main className="ss-content ss-page"><StatePanel headingLevel={1} kind="not-found" title="Resource not found" reason={detail.state.reason} next="Return to the showroom and open a current trust link."><ShellLink href="#/superskill">Open showroom</ShellLink></StatePanel></main>;
  if (detail.state.status === "error") return <main className="ss-content ss-page"><StatePanel headingLevel={1} kind="error" title="Trust report unavailable" reason={detail.state.reason} next={detail.state.next} onRetry={detail.refresh}><ShellLink href="#/superskill">Open showroom</ShellLink></StatePanel></main>;
  const item = detail.state.data;
  const capability = item.capability;
  const verdict = capabilityVerdict(capability);
  const allowed = installAllowed(capability, item.clientHandoff);
  return (
    <main className="ss-content ss-page ss-trust-page">
      {(verdict === "revoked" || verdict === "quarantined") ? <StatePanel kind="blocked" title={`Release ${verdict}`} reason="The exact public release remains visible for an honest shared link, but client handoff is disabled." next="Review limitations and use a current approved alternative." /> : null}
      {item.clientHandoff.reason === "stale_or_ineligible_evidence" ? <StatePanel kind="blocked" title="Client handoff blocked — evidence is stale" reason="This exact release remains visible, but its review or compatibility evidence is no longer current." next="Use a currently approved release or wait for re-review." /> : null}
      <TrustReport capability={capability} />
      <div className="ss-share-field"><CopyField label="Share this exact trust preview" value={capabilityShareUrl(capability.id)} /></div>
      <div className="ss-sticky-install">{allowed ? <ShellLink className="ss-link--primary" href={buildSuperSkillRoute({ name: "install", capabilityId })}>Continue in client</ShellLink> : <span className="ss-disabled-action" aria-disabled="true">Install handoff blocked</span>}</div>
    </main>
  );
}
