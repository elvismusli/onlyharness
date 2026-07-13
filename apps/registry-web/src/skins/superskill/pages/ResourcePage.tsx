import { useEffect, useState } from "react";

import { apiUrl } from "../../../core/constants";
import type { ResourceItem } from "../../../core/types";
import { StatePanel } from "../components/StatePanel";
import { PageHeading, ShellLink } from "../primitives";

type ResourceState = { status: "loading" } | { status: "error"; reason: string } | { status: "success"; resource: ResourceItem };

export function ResourcePage({ resourceId }: { resourceId: string }) {
  const [state, setState] = useState<ResourceState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetch(`${apiUrl}/resources/${encodeURIComponent(resourceId)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as ResourceItem & { error?: string };
        if (!response.ok) throw new Error(body.error || `Resource request failed (${response.status}).`);
        setState({ status: "success", resource: body });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setState({ status: "error", reason: error.message || "Resource unavailable." });
      });
    return () => controller.abort();
  }, [resourceId]);

  if (state.status === "loading") return <main className="ss-content ss-page"><StatePanel headingLevel={1} kind="loading" title="Loading resource" reason="Reading the current public catalog projection." /></main>;
  if (state.status === "error") return <main className="ss-content ss-page"><StatePanel headingLevel={1} kind="error" title="Resource unavailable" reason={state.reason} next="Retry or return to Publish."><ShellLink href="#/superskill/publish">Open Publish</ShellLink></StatePanel></main>;
  const resource = state.resource;
  const archive = resource.actions.find((action) => action.id === "download_archive");
  return (
    <main className="ss-content ss-page ss-resource-page">
      <ShellLink href="#/superskill/publish">← Publish or update</ShellLink>
      <PageHeading eyebrow={resource.resourceType.replaceAll("_", " ")}>{resource.title}</PageHeading>
      <p className="ss-page-lede">{resource.summary}</p>
      <section className="ss-resource-card">
        <span className={`ss-account-state ss-account-state--${resource.trust.securityScan === "not_scanned" ? "pending" : "confirmed"}`}>{resource.trust.securityScan ?? "not scanned"}</span>
        <dl className="ss-facts"><div><dt>Resource ID</dt><dd>{resource.id}</dd></div><div><dt>Installability</dt><dd>{resource.installability}</dd></div><div><dt>Risk</dt><dd>{resource.trust.riskTier ?? "UNKNOWN"}</dd></div><div><dt>Works with</dt><dd>{resource.worksWith.join(", ") || "not declared"}</dd></div></dl>
        <p>This hosted package is public and downloadable, but it is not a reviewed managed capability. Inspect its files before installation.</p>
        {archive && "url" in archive ? <a className="ss-link ss-link--primary" href={archive.url}>Download current archive</a> : null}
      </section>
    </main>
  );
}
