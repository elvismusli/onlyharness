import { useEffect, useState } from "react";

import { apiUrl } from "../../../core/constants";
import { resourceShareUrl } from "../../../core/share-url";
import type { ResourceItem } from "../../../core/types";
import { StatePanel } from "../components/StatePanel";
import { CopyField } from "../components/CopyField";
import { PageHeading, ShellLink } from "../primitives";
import { superskillRuntime } from "../../../generated/superskill-runtime";
import { useHarness } from "../../../core/store";

type ResourceDetail = ResourceItem & { release?: { version: string; artifactDigest: string; archiveSize: number; trust: "unreviewed" } };
type ResourceState = { status: "loading" } | { status: "error"; reason: string } | { status: "success"; resource: ResourceDetail };

export function ResourcePage({ resourceId, version }: { resourceId: string; version?: string }) {
  const h = useHarness();
  const [state, setState] = useState<ResourceState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    const releasePath = version ? `/releases/${encodeURIComponent(version)}` : "";
    fetch(`${apiUrl}/resources/${encodeURIComponent(resourceId)}${releasePath}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as ResourceDetail & { error?: string };
        if (!response.ok) throw new Error(body.error || `Resource request failed (${response.status}).`);
        setState({ status: "success", resource: body });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setState({ status: "error", reason: error.message || "Resource unavailable." });
      });
    return () => controller.abort();
  }, [resourceId, version]);

  if (state.status === "loading") return <main className="ss-content ss-page"><StatePanel headingLevel={1} kind="loading" title="Loading resource" reason="Reading the current public catalog projection." /></main>;
  if (state.status === "error") return <main className="ss-content ss-page"><StatePanel headingLevel={1} kind="error" title="Resource unavailable" reason={state.reason} next="Retry or return to Publish."><ShellLink href="#/superskill/publish">Open Publish</ShellLink></StatePanel></main>;
  const resource = state.resource;
  const scan = resource.trust.securityScan ?? "not_scanned";
  const archive = resource.actions.find((action) => action.id === "download_archive");
  const upstream = resource.actions.find((action) => action.id === "open_upstream");
  const destinationWorkspace = h.workspaceCatalog?.workspace.slug ?? storedWorkspaceSlug();
  const shareUrl = resourceShareUrl(resource.id, resource.release?.version);
  const nativeSkillInstall = archive && resource.release && scan !== "fail" && resource.resourceType === "skill" && resource.id.startsWith("onlyharness:packages/")
    ? `npx --yes ${superskillRuntime.cliPackage}@${superskillRuntime.cliVersion} resources install ${JSON.stringify(resource.id)} --version ${JSON.stringify(resource.release.version)} --digest ${JSON.stringify(`sha256:${resource.release.artifactDigest}`)} --target codex${scan === "pass" ? "" : " --allow-unreviewed"} --json`
    : undefined;
  return (
    <main className="ss-content ss-page ss-resource-page">
      <ShellLink href="#/superskill/publish">← Publish or update</ShellLink>
      <PageHeading eyebrow={resource.resourceType.replaceAll("_", " ")}>{resource.title}</PageHeading>
      <p className="ss-page-lede">{resource.summary}</p>
      <section className="ss-resource-card">
        <span className={`ss-account-state ss-account-state--${scanStateClass(scan)}`}>{scan.replaceAll("_", " ")}</span>
        <p>{scanStateCopy(scan)}</p>
        <dl className="ss-facts"><div><dt>Resource ID</dt><dd>{resource.id}</dd></div>{resource.release ? <><div><dt>Exact version</dt><dd>{resource.release.version}</dd></div><div><dt>Artifact SHA-256</dt><dd><code>{resource.release.artifactDigest}</code></dd></div></> : null}<div><dt>Installability</dt><dd>{resource.installability}</dd></div><div><dt>Risk</dt><dd>{resource.trust.riskTier ?? "UNKNOWN"}</dd></div><div><dt>Works with</dt><dd>{resource.worksWith.join(", ") || "not declared"}</dd></div></dl>
        <CopyField label="Share this resource" value={shareUrl} />
        {destinationWorkspace && resource.release && scan !== "fail" ? <ShellLink href={workspaceApprovalHref(destinationWorkspace, resource.id, resource.release.version, resource.release.artifactDigest)}>Add exact release to @{destinationWorkspace}</ShellLink> : null}
        {archive && "url" in archive ? (
          <>
            <p>{scan === "fail" ? "This release remains visible only as blocked metadata. Its archive is not downloadable." : "This hosted package is public and downloadable, but it is not a reviewed managed capability. Inspect its files before installation."}</p>
            {scan !== "fail" ? <a className="ss-link ss-link--primary" href={archive.url}>Download {resource.release ? `exact ${resource.release.version}` : "current"} archive</a> : null}
            {nativeSkillInstall ? <CopyField label={`Install exact ${resource.release?.version} in Codex after inspection`} value={nativeSkillInstall} /> : null}
            {scan === "fail" ? <p className="ss-block-copy">Installation is blocked because the static security scan failed. Inspect and publish a corrected new version.</p> : null}
            <ShellLink href="#/superskill/install">Get the universal SuperSkill plugin</ShellLink>
          </>
        ) : (
          <>
            <p>This resource is listed from its upstream source and has no SuperSkill-hosted archive. Inspect the upstream files before use.</p>
            {upstream && "url" in upstream ? <a className="ss-link ss-link--primary" href={upstream.url}>Open upstream source</a> : null}
          </>
        )}
      </section>
    </main>
  );
}

function scanStateClass(scan: NonNullable<ResourceItem["trust"]["securityScan"]>): "confirmed" | "pending" | "blocked" {
  if (scan === "pass") return "confirmed";
  if (scan === "fail") return "blocked";
  return "pending";
}

function scanStateCopy(scan: NonNullable<ResourceItem["trust"]["securityScan"]>): string {
  if (scan === "pass") return "The current static-v2 scan passed. This is still an unreviewed public release, not managed approval.";
  if (scan === "warn") return "The static-v2 scan found warnings. Review them and explicitly consent before installation; this is not managed approval.";
  if (scan === "fail") return "The static-v2 scan failed. Installation and workspace approval are blocked for this release.";
  return "No current static security scan is recorded. Treat this release as unreviewed.";
}

function storedWorkspaceSlug(): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  const value = localStorage.getItem("hh:workspaceSlug")?.trim().toLowerCase();
  return value && /^[a-z][a-z0-9_-]{1,48}$/.test(value) ? value : undefined;
}

function workspaceApprovalHref(workspace: string, resourceId: string, version: string, artifactDigest: string): string {
  const params = new URLSearchParams({ workspace, resource: resourceId, version, digest: artifactDigest, approve: "1" });
  return `#/superskill/workspaces?${params.toString()}`;
}
