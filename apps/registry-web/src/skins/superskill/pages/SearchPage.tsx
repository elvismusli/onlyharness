import { type FormEvent, useEffect, useState } from "react";

import { apiUrl } from "../../../core/constants";
import { buildSuperSkillRoute, navigateSuperSkill, type SuperSkillSearchResourceType } from "../../../core/superskill-route";
import type { ResourceItem } from "../../../core/types";
import { StatePanel } from "../components/StatePanel";
import { PageHeading, ShellLink, SSButton } from "../primitives";

type SearchFilter = SuperSkillSearchResourceType | "all";
type SearchState =
  | { status: "loading" }
  | { status: "error"; reason: string }
  | { status: "success"; resources: ResourceItem[]; total: number };

const RESOURCE_TYPES: Array<{ value: SearchFilter; label: string }> = [
  { value: "all", label: "All resource types" },
  { value: "skill", label: "Skills" },
  { value: "workflow", label: "Workflows" },
  { value: "harness", label: "Harnesses" },
  { value: "plugin", label: "Plugins" },
  { value: "mcp_server", label: "MCP servers" },
  { value: "command_pack", label: "Command packs" },
  { value: "subagent_pack", label: "Subagent packs" },
  { value: "agent_team", label: "Agent teams" },
  { value: "config", label: "Configs" },
  { value: "guide", label: "Guides" },
  { value: "framework", label: "Frameworks" },
  { value: "agent_runtime", label: "Agent runtimes" },
  { value: "service_endpoint", label: "Service endpoints" },
  { value: "directory", label: "Directories" }
];

export function SearchPage({ query = "", resourceType }: { query?: string; resourceType?: SuperSkillSearchResourceType }) {
  const activeType: SearchFilter = resourceType ?? "all";
  const [draftQuery, setDraftQuery] = useState(query);
  const [draftType, setDraftType] = useState<SearchFilter>(activeType);
  const [refreshTick, setRefreshTick] = useState(0);
  const [state, setState] = useState<SearchState>({ status: "loading" });

  useEffect(() => {
    setDraftQuery(query);
    setDraftType(activeType);
  }, [query, activeType]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ sort: "source-checked", limit: "80" });
    if (query) params.set("q", query);
    if (resourceType) params.set("type", resourceType);
    setState({ status: "loading" });
    fetch(`${apiUrl}/resources?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as {
          resources?: ResourceItem[];
          items?: ResourceItem[];
          counts?: { total?: number };
          error?: string;
        };
        if (!response.ok) throw new Error(body.error || `Resource search failed (${response.status}).`);
        const resources = Array.isArray(body.resources) ? body.resources : Array.isArray(body.items) ? body.items : [];
        setState({ status: "success", resources, total: body.counts?.total ?? resources.length });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setState({ status: "error", reason: error.message || "Resource search is unavailable." });
      });
    return () => controller.abort();
  }, [query, resourceType, refreshTick]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigateSuperSkill({
      name: "search",
      ...(draftQuery.trim() ? { query: draftQuery.trim() } : {}),
      ...(draftType !== "all" ? { resourceType: draftType } : {})
    });
  };

  return (
    <main className="ss-content ss-page ss-search-page">
      <PageHeading eyebrow="public mixed catalog">Find agent resources</PageHeading>
      <p className="ss-page-lede">Search skills, workflows, plugins, harnesses, MCP servers, and guides. Catalog presence is not a review badge; inspect the source and security state before use.</p>
      <form className="ss-search-form" role="search" onSubmit={submitSearch}>
        <label>
          Search catalog
          <input
            type="search"
            maxLength={200}
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder="e.g. market research or markdown workflow"
          />
        </label>
        <label>
          Resource type
          <select value={draftType} onChange={(event) => setDraftType(event.target.value as SearchFilter)}>
            {RESOURCE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </label>
        <SSButton type="submit">Search</SSButton>
      </form>

      <section className="ss-search-results" aria-live="polite" aria-busy={state.status === "loading"}>
        {state.status === "loading" ? <StatePanel kind="loading" title="Searching resources" reason="Reading the current public catalog projection." /> : null}
        {state.status === "error" ? <StatePanel kind="error" title="Search unavailable" reason={state.reason} next="Retry the public catalog request." onRetry={() => setRefreshTick((tick) => tick + 1)} /> : null}
        {state.status === "success" && state.resources.length === 0 ? <StatePanel kind="empty" title="No matching resources" reason="No public resource matches this query and type." next="Try broader terms or search all resource types." /> : null}
        {state.status === "success" && state.resources.length > 0 ? (
          <>
            <div className="ss-search-summary">
              <strong>{state.total} {state.total === 1 ? "result" : "results"}</strong>
              <span>Showing {state.resources.length}{state.total > state.resources.length ? ` of ${state.total}` : ""}</span>
            </div>
            <div className="ss-search-grid">
              {state.resources.map((resource) => <ResourceSearchCard key={resource.id} resource={resource} />)}
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}

function ResourceSearchCard({ resource }: { resource: ResourceItem }) {
  const scan = resource.trust.securityScan ?? "not_scanned";
  const sourceState = resource.trust.sourceChecked ? "Source checked" : "Source not checked";
  const hostedArchive = resource.actions.some((action) => action.id === "download_archive");
  return (
    <article className={`ss-search-card ss-search-card--${scan}`}>
      <div className="ss-card-top">
        <span className="ss-type-chip">{resource.resourceType.replaceAll("_", " ")}</span>
        <span className={`ss-verdict ss-verdict--${scan}`}>{scan.replaceAll("_", " ")}</span>
      </div>
      <div>
        <h2>{resource.title}</h2>
        <p>{resource.summary}</p>
      </div>
      <dl className="ss-search-facts">
        <div><dt>Source</dt><dd>{sourceState} · {resource.sourceCheckStatus}</dd></div>
        <div><dt>Use state</dt><dd>{installabilityLabel(resource.installability, hostedArchive)}</dd></div>
        <div><dt>Works with</dt><dd>{resource.worksWith.join(", ") || "not declared"}</dd></div>
      </dl>
      <p className="ss-search-caution">{securityCaution(scan)}</p>
      <div className="ss-card-actions">
        <ShellLink href={buildSuperSkillRoute({ name: "resource", resourceId: resource.id })}>View source and actions</ShellLink>
      </div>
    </article>
  );
}

function installabilityLabel(installability: ResourceItem["installability"], hostedArchive: boolean): string {
  if (installability === "open_only") return "Upstream only; no hosted archive";
  if (installability === "importable") return "Importable; inspect before use";
  if (installability === "installable") return hostedArchive ? "Hosted archive available" : "Install instructions available";
  return hostedArchive ? "Install path verified; archive available" : "Install path verified";
}

function securityCaution(scan: NonNullable<ResourceItem["trust"]["securityScan"]>): string {
  if (scan === "pass") return "The current scan passed. This does not replace source review or grant managed approval.";
  if (scan === "warn") return "The current scan has warnings. Review findings before importing or installing.";
  if (scan === "fail") return "The current scan failed. Do not install without resolving the findings.";
  return "No current security scan is recorded. Treat this listing as unreviewed.";
}
