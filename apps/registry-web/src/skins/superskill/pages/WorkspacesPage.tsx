import { useEffect, useRef, useState, type FormEvent } from "react";

import { useHarness } from "../../../core/store";
import { buildSuperSkillRoute } from "../../../core/superskill-route";
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
  const incomingShare = workspaceShareFromHash();
  const confirmedAccount = Boolean(h.user?.email_confirmed_at);
  const incomingShareCaptured = useRef(false);
  const incomingWorkspaceLoaded = useRef(false);

  useEffect(() => {
    if (!h.user || !incomingShare.workspace) return;
    if (!incomingShareCaptured.current) {
      incomingShareCaptured.current = true;
      h.setWorkspaceSlug(incomingShare.workspace);
      if (incomingShare.invite) h.setWorkspaceJoinCode(incomingShare.invite);
      if (incomingShare.approve && incomingShare.resource) {
        h.setWorkspaceApprovalResourceId(incomingShare.resource);
        h.setWorkspaceApprovalVersion(incomingShare.version ?? "");
        h.setWorkspaceApprovalArtifactDigest(incomingShare.digest ?? "");
      }
      if (incomingShare.invite) scrubWorkspaceInviteFromHash();
    }
    if (confirmedAccount && incomingShare.approve && !incomingWorkspaceLoaded.current) {
      incomingWorkspaceLoaded.current = true;
      void h.loadWorkspace(incomingShare.workspace);
    }
    // A raw invite is captured once and then remains only in the in-memory password field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h.user?.id, h.user?.email_confirmed_at]);

  if (!h.user) {
    const accountHref = workspaceAccountHref(incomingShare);
    return (
      <main className="ss-content ss-page ss-workspace-page">
        <PageHeading eyebrow="Workspaces">Your team skills, in one place</PageHeading>
        <p className="ss-page-lede">Sign in with a confirmed account to load or join a private workspace. Membership is checked by the server; this page does not assume access.</p>
        <section className="ss-workspace-empty">
          <h2>Sign in required</h2>
          <p>Workspace catalogs, members and collections stay unavailable until your membership is verified.</p>
          <ShellLink className="ss-link--primary" href={accountHref}>Open account</ShellLink>
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
  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void h.createWorkspace();
  };
  const approve = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void h.approveWorkspaceResource();
  };

  return (
    <main className="ss-content ss-page ss-workspace-page">
      <PageHeading eyebrow="Workspaces">Private skills for your team</PageHeading>
      <p className="ss-page-lede">Load an existing membership or join with a one-time invite. Access appears only after the server confirms it.</p>
      {incomingShare.invalidApproval ? <p className="ss-auth-notice" role="status">This approval link is incomplete or was changed. No resource was prefilled; reopen the exact release link.</p> : null}
      {!confirmedAccount ? <p className="ss-account-notice" role="status">Confirm your email before creating, loading or joining a workspace.</p> : null}

      <div className="ss-workspace-connect-grid">
        <section className="ss-workspace-panel">
          <h2>Create workspace</h2>
          <form className="ss-workspace-form" onSubmit={create}>
            <label>Workspace name<input required maxLength={120} value={h.workspaceCreateName} onChange={(event) => h.setWorkspaceCreateName(event.target.value)} placeholder="Research team" autoComplete="organization" /></label>
            <label>Workspace slug<input required pattern="[a-z][a-z0-9_-]{1,48}" value={h.workspaceSlug} onChange={(event) => h.setWorkspaceSlug(event.target.value)} placeholder="research-team" /></label>
            <SSButton type="submit" disabled={!confirmedAccount || h.workspaceBusy || !h.workspaceCreateName.trim() || !h.workspaceSlug.trim()}>{h.workspaceBusy ? "Working…" : "Create invite-only workspace"}</SSButton>
          </form>
          {h.workspaceCreateStatus ? <p className="ss-workspace-status" role="status">{h.workspaceCreateStatus}</p> : null}
        </section>

        <section className="ss-workspace-panel">
          <h2>Load workspace</h2>
          <form className="ss-workspace-form" onSubmit={load}>
            <label>Workspace slug<input value={h.workspaceSlug} onChange={(event) => h.setWorkspaceSlug(event.target.value)} placeholder="acme" autoComplete="organization" /></label>
            <SSButton type="submit" disabled={!confirmedAccount || h.workspaceBusy || !h.workspaceSlug.trim()}>{h.workspaceBusy ? "Checking…" : "Load workspace"}</SSButton>
          </form>
          {h.workspaceStatus ? <p className="ss-workspace-status" role="status">{h.workspaceStatus}</p> : null}
        </section>

        <section className="ss-workspace-panel">
          <h2>Join with invite</h2>
          <form className="ss-workspace-form" onSubmit={join}>
            <label>Invite code<input type="password" value={h.workspaceJoinCode} onChange={(event) => h.setWorkspaceJoinCode(event.target.value)} autoComplete="one-time-code" /></label>
            <SSButton variant="secondary" type="submit" disabled={!confirmedAccount || h.workspaceBusy || !h.workspaceSlug.trim() || !h.workspaceJoinCode.trim()}>Join workspace</SSButton>
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
          {view === "resources" ? (
            <div className="ss-workspace-section">
              <ResourceList catalog={catalog} selectedResource={incomingShare.resource} />
              <div className="ss-workspace-invite">
                <h3>Add a public resource</h3>
                <p>Add a scanned public release to this workspace's collection. This records local curation and a trust snapshot; it never grants a SuperSkill reviewed badge.</p>
                <form className="ss-workspace-form" onSubmit={approve}>
                  <label>Public resource ID<input required value={h.workspaceApprovalResourceId} onChange={(event) => h.setWorkspaceApprovalResourceId(event.target.value)} placeholder="onlyharness:packages/my-agent-skill" /></label>
                  {h.workspaceApprovalVersion && h.workspaceApprovalArtifactDigest ? <div className="ss-auth-notice"><strong>Exact release:</strong> {h.workspaceApprovalVersion}<br /><code>{h.workspaceApprovalArtifactDigest}</code></div> : null}
                  <label>Collection slug<input required pattern="[a-z0-9][a-z0-9._-]{0,80}" value={h.workspaceCollectionSlug} onChange={(event) => h.setWorkspaceCollectionSlug(event.target.value)} placeholder="approved" /></label>
                  <label>Approval note<textarea rows={3} maxLength={500} value={h.workspaceApprovalNote} onChange={(event) => h.setWorkspaceApprovalNote(event.target.value)} placeholder="Why this exact release belongs in the workspace" /></label>
                  <SSButton variant="secondary" type="submit" disabled={h.workspaceBusy || !h.workspaceApprovalResourceId.trim() || !h.workspaceCollectionSlug.trim()}>Add to workspace</SSButton>
                </form>
                {h.workspaceCollectionStatus ? <p className="ss-workspace-status" role="status">{h.workspaceCollectionStatus}</p> : null}
              </div>
            </div>
          ) : null}
          {view === "members" ? (
            <div className="ss-workspace-section">
              <div className="ss-workspace-section-head"><h3>Members</h3><SSButton variant="secondary" type="button" disabled={h.workspaceBusy} onClick={() => void h.loadWorkspaceMembers()}>Refresh</SSButton></div>
              {h.workspaceMembers.length ? <ul className="ss-workspace-list">{h.workspaceMembers.map((member) => <li key={member.id ?? member.user_id}><div><strong>{memberLabel(member.user_id)}</strong><span>{member.source}</span></div><span>{member.role} · {member.status}</span></li>)}</ul> : <p className="ss-muted">No members are visible with your current role.</p>}
              <div className="ss-workspace-invite">
                <h3>Share workspace</h3>
                <p>Create a bounded invite. The raw code is returned once and placed after <code>#</code>, so it is not sent in HTTP requests.</p>
                <div className="ss-publish-grid">
                  <label>Invite role<select value={h.workspaceInviteRole} onChange={(event) => h.setWorkspaceInviteRole(event.target.value as typeof h.workspaceInviteRole)}><option value="member">Member</option><option value="viewer">Viewer</option></select></label>
                  <label>Maximum uses<input type="number" inputMode="numeric" min="1" max="10000" step="1" required value={h.workspaceInviteMaxUses} onChange={(event) => h.setWorkspaceInviteMaxUses(event.target.value)} /></label>
                </div>
                <SSButton variant="secondary" type="button" disabled={h.workspaceBusy} onClick={() => void h.createWorkspaceInvite()}>Create invite link</SSButton>
                {h.workspaceInviteStatus ? <p className="ss-workspace-status" role="status">{h.workspaceInviteStatus}</p> : null}
                {h.workspaceInviteCode ? <CopyField label="One-time workspace link" value={workspaceShareUrl(catalog.workspace.slug, h.workspaceInviteCode)} /> : null}
              </div>
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

function workspaceShareFromHash(): { workspace?: string; invite?: string; resource?: string; version?: string; digest?: string; approve?: boolean; invalidApproval?: boolean } {
  if (typeof window === "undefined") return {};
  const query = window.location.hash.split("?", 2)[1];
  if (!query) return {};
  const params = new URLSearchParams(query);
  const workspace = params.get("workspace")?.trim().toLowerCase();
  const invite = params.get("invite")?.trim();
  const resource = params.get("resource")?.trim();
  const version = params.get("version")?.trim();
  const digest = params.get("digest")?.trim().toLowerCase();
  const approveRequested = params.get("approve") === "1";
  const exactRelease = Boolean(version && isReleaseVersion(version) && digest && /^[a-f0-9]{64}$/.test(digest));
  const resourceValid = Boolean(resource && validWorkspaceResourceRef(resource));
  const approve = approveRequested && resourceValid && exactRelease;
  return {
    ...(workspace && /^[a-z][a-z0-9_-]{1,48}$/.test(workspace) ? { workspace } : {}),
    ...(invite && /^ohwi_[A-Za-z0-9_-]{20,80}$/.test(invite) ? { invite } : {}),
    ...(resourceValid ? { resource } : {}),
    ...(approve && exactRelease ? { version, digest } : {}),
    ...(approve ? { approve: true } : {}),
    ...(approveRequested && !approve ? { invalidApproval: true } : {})
  };
}

function workspaceShareUrl(workspace: string, invite: string): string {
  return `${window.location.origin}/#/superskill/workspaces?workspace=${encodeURIComponent(workspace)}&invite=${encodeURIComponent(invite)}`;
}

function scrubWorkspaceInviteFromHash() {
  const [route, query = ""] = window.location.hash.split("?", 2);
  const params = new URLSearchParams(query);
  params.delete("invite");
  const nextQuery = params.toString();
  const nextHash = `${route}${nextQuery ? `?${nextQuery}` : ""}`;
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${nextHash}`);
}

function workspaceAccountHref(share: ReturnType<typeof workspaceShareFromHash>): string {
  const params = new URLSearchParams();
  if (share.workspace) params.set("workspace", share.workspace);
  if (share.invite) params.set("invite", share.invite);
  if (share.resource) params.set("resource", share.resource);
  if (share.version && share.digest) {
    params.set("version", share.version);
    params.set("digest", share.digest);
  }
  if (share.approve && share.resource) params.set("approve", "1");
  const query = params.toString();
  return `#/superskill/account${query ? `?${query}` : ""}`;
}

function memberLabel(userId: string): string {
  const suffix = userId.replace(/[^A-Za-z0-9]/g, "").slice(-6);
  return suffix ? `Member ···${suffix}` : "Workspace member";
}

function ResourceList({ catalog, selectedResource }: { catalog: WorkspaceCatalog; selectedResource?: string }) {
  return (
    <div>
      <h3>Resources</h3>
      {catalog.resources.length ? <ul className="ss-workspace-list">{catalog.resources.map((resource) => {
        const pin = exactWorkspaceResourcePin(catalog, resource);
        return <li key={resource.id} aria-current={resourceMatchesSelection(resource.id, selectedResource) ? "true" : undefined}>
          <div><strong>{resource.title}</strong><span>{resource.summary}</span>{pin ? <ShellLink href={buildSuperSkillRoute({ name: "resource", resourceId: pin.sourceResourceId, version: pin.version })}>Open exact {pin.version}</ShellLink> : resource.workspaceApproval ? <span>Exact release pin missing — latest is not used.</span> : <span>Private package access stays workspace-token only.</span>}</div>
          <span>{resource.resourceType} · {resource.installability}{pin ? ` · sha256:${pin.digest.slice(0, 12)}…` : ""}</span>
        </li>;
      })}</ul> : <p className="ss-muted">No workspace resources are indexed yet.</p>}
    </div>
  );
}

function exactWorkspaceResourcePin(catalog: WorkspaceCatalog, resource: WorkspaceCatalog["resources"][number]): { sourceResourceId: string; version: string; digest: string } | undefined {
  const approval = resource.workspaceApproval;
  if (!approval) return undefined;
  const item = catalog.collections
    .find((collection) => collection.slug === approval.collectionSlug)
    ?.items.find((candidate) => candidate.itemRef === resource.id && candidate.sourceResourceId === approval.sourceResourceId);
  if (!item?.pinnedVersion || !item.pinnedArchiveHash || !isReleaseVersion(item.pinnedVersion) || !/^[a-f0-9]{64}$/.test(item.pinnedArchiveHash)) return undefined;
  return { sourceResourceId: approval.sourceResourceId, version: item.pinnedVersion, digest: item.pinnedArchiveHash };
}

function validWorkspaceResourceRef(value: string): boolean {
  return value.length >= 2 && value.length <= 180 && /^[A-Za-z0-9@._:+/-]+$/.test(value) && !value.includes("..") && !value.startsWith("/") && !value.endsWith("/");
}

function isReleaseVersion(value: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function resourceMatchesSelection(id: string, selected: string | undefined): boolean {
  return Boolean(selected && (id === selected || id.endsWith(`/${selected}`)));
}
