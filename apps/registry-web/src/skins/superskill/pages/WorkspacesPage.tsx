import { useState, type FormEvent } from "react";

import { useHarness } from "../../../core/store";
import type { WorkspaceCatalog } from "../../../core/types";
import { PageHeading, ShellLink, SSButton } from "../primitives";
import { CopyField } from "../components/CopyField";
import { superskillRuntime } from "../../../generated/superskill-runtime";
import { superskillInstallHandoff } from "../../../core/superskill-install";

type WorkspaceView = "resources" | "members" | "collections" | "setup";

export function WorkspacesPage() {
  const h = useHarness();
  const [view, setView] = useState<WorkspaceView>("resources");
  const [setupTarget, setSetupTarget] = useState<"codex" | "claude-code">("codex");
  const catalog = h.workspaceCatalog;
  const installHandoff = superskillInstallHandoff();

  if (!h.user) {
    return (
      <main className="ss-content ss-page ss-workspace-page">
        <PageHeading eyebrow="Workspaces">Your team skills, in one place</PageHeading>
        <p className="ss-page-lede">Sign in with a confirmed account to load or join a private workspace. Membership is checked by the server; this page does not assume access.</p>
        <section className="ss-workspace-empty">
          <h2>Sign in required</h2>
          <p>Workspace catalogs, members and collections stay unavailable until your membership is verified.</p>
          <ShellLink className="ss-link--primary" href="#/superskill/account">Open account</ShellLink>
        </section>
      </main>
    );
  }

  const load = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void h.loadWorkspace();
  };
  const join = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void h.joinWorkspace();
  };

  return (
    <main className="ss-content ss-page ss-workspace-page">
      <PageHeading eyebrow="Workspaces">Private skills for your team</PageHeading>
      <p className="ss-page-lede">Load an existing membership or join with a one-time invite. Access appears only after the server confirms it.</p>

      <div className="ss-workspace-connect-grid">
        <section className="ss-workspace-panel">
          <h2>Load workspace</h2>
          <form className="ss-workspace-form" onSubmit={load}>
            <label>Workspace slug<input value={h.workspaceSlug} onChange={(event) => h.setWorkspaceSlug(event.target.value)} placeholder="acme" autoComplete="organization" /></label>
            <SSButton type="submit" disabled={h.workspaceBusy || !h.workspaceSlug.trim()}>{h.workspaceBusy ? "Checking…" : "Load workspace"}</SSButton>
          </form>
          {h.workspaceStatus ? <p className="ss-workspace-status" role="status">{h.workspaceStatus}</p> : null}
        </section>

        <section className="ss-workspace-panel">
          <h2>Join with invite</h2>
          <form className="ss-workspace-form" onSubmit={join}>
            <label>Invite code<input type="password" value={h.workspaceJoinCode} onChange={(event) => h.setWorkspaceJoinCode(event.target.value)} autoComplete="one-time-code" /></label>
            <SSButton variant="secondary" type="submit" disabled={h.workspaceBusy || !h.workspaceSlug.trim() || !h.workspaceJoinCode.trim()}>Join workspace</SSButton>
          </form>
          {h.workspaceJoinStatus ? <p className="ss-workspace-status" role="status">{h.workspaceJoinStatus}</p> : null}
        </section>
      </div>

      {catalog ? (
        <section className="ss-workspace-catalog" aria-labelledby="ss-workspace-name">
          <header>
            <div>
              <span className="ss-evidence-label">Membership verified</span>
              <h2 id="ss-workspace-name">{catalog.workspace.name}</h2>
              <p>@{catalog.workspace.slug} · {catalog.workspace.type} · {catalog.workspace.visibility}</p>
            </div>
            <span className="ss-account-state ss-account-state--confirmed">{catalog.workspace.plan}</span>
          </header>
          <div className="ss-workspace-tabs" role="tablist" aria-label="Workspace sections">
            {(["resources", "members", "collections", "setup"] as const).map((entry) => (
              <button key={entry} type="button" role="tab" aria-selected={view === entry} onClick={() => setView(entry)}>{entry}</button>
            ))}
          </div>
          {view === "resources" ? <ResourceList catalog={catalog} /> : null}
          {view === "members" ? (
            <div className="ss-workspace-section">
              <div className="ss-workspace-section-head"><h3>Members</h3><SSButton variant="secondary" type="button" disabled={h.workspaceBusy} onClick={() => void h.loadWorkspaceMembers()}>Refresh</SSButton></div>
              {h.workspaceMembers.length ? <ul className="ss-workspace-list">{h.workspaceMembers.map((member) => <li key={member.id ?? member.user_id}><div><strong>{memberLabel(member.user_id)}</strong><span>{member.source}</span></div><span>{member.role} · {member.status}</span></li>)}</ul> : <p className="ss-muted">No members are visible with your current role.</p>}
            </div>
          ) : null}
          {view === "collections" ? (
            <div className="ss-workspace-section">
              <h3>Collections</h3>
              {catalog.collections.length ? <ul className="ss-workspace-list">{catalog.collections.map((collection) => <li key={collection.slug}><div><strong>{collection.title}</strong><span>{collection.summary || `@${collection.slug}`}</span></div><span>{collection.items.length} items · {collection.visibility}</span></li>)}</ul> : <p className="ss-muted">No collections are available in this workspace.</p>}
            </div>
          ) : null}
          {view === "setup" ? (
            <div className="ss-workspace-section ss-workspace-setup">
              <h3>Connect your agent</h3>
              <p>Read the live workspace setup bundle first. The copied command never embeds a credential; it requires an existing <code>HH_WORKSPACE_TOKEN</code> in your terminal. A browser member session is not transferred to the terminal.</p>
              <label>Client<select value={setupTarget} onChange={(event) => setSetupTarget(event.target.value as "codex" | "claude-code")}><option value="codex">Codex</option><option value="claude-code">Claude Code</option></select></label>
              <SSButton variant="secondary" type="button" disabled={h.workspaceBusy} onClick={() => void h.loadWorkspaceSetupBundle(setupTarget)}>Load setup bundle</SSButton>
              {h.workspaceSetupStatus ? <p className="ss-workspace-status" role="status">{h.workspaceSetupStatus}</p> : null}
              {h.workspaceSetupBundle ? (
                <>
                  <p>{h.workspaceSetupBundle.resources.length} resources · {h.workspaceSetupBundle.configs.length} config files · target {h.workspaceSetupBundle.target}</p>
                  {installHandoff.status === "available"
                    ? <CopyField label="Workspace setup command" value={`npx --yes ${superskillRuntime.cliPackage}@${superskillRuntime.cliVersion} workspace setup ${catalog.workspace.slug} --target ${h.workspaceSetupBundle.target} --json`} />
                    : <p className="ss-muted">Setup command is blocked until the exact CLI release and official integrity are published.</p>}
                </>
              ) : null}
              <ShellLink href="#/superskill/install">Open universal installer</ShellLink>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="ss-workspace-honest-state" aria-live="polite">
          <strong>No workspace loaded</strong>
          <p>Enter a slug to check your current membership. A workspace is never shown as connected before the API returns it.</p>
        </section>
      )}
    </main>
  );
}

function memberLabel(userId: string): string {
  const suffix = userId.replace(/[^A-Za-z0-9]/g, "").slice(-6);
  return suffix ? `Member ···${suffix}` : "Workspace member";
}

function ResourceList({ catalog }: { catalog: WorkspaceCatalog }) {
  return (
    <div className="ss-workspace-section">
      <h3>Resources</h3>
      {catalog.resources.length ? <ul className="ss-workspace-list">{catalog.resources.map((resource) => <li key={resource.id}><div><strong>{resource.title}</strong><span>{resource.summary}</span></div><span>{resource.resourceType} · {resource.installability}</span></li>)}</ul> : <p className="ss-muted">No workspace resources are indexed yet.</p>}
    </div>
  );
}
