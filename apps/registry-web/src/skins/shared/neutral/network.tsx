import { useState } from "react";
import type { ReactNode } from "react";

import { useHarness } from "../../../core/store";
import type { ResourceItem, WorkspaceCollection, WorkspaceMember } from "../../../core/types";

/*
 * Shared-neutral Network / Workspace — the "serious" admin surface
 * rendered identically in every skin (only the `--neutral-*` palette changes).
 * Resource-first: it uses `/workspaces/{slug}/...` through `core/useWorkspace`
 * for private skills, plugins, workflows, MCP servers, command packs, scripts,
 * docs, source bundles and native harness packages. Legacy `/orgs` stays in the
 * store only as a compatibility path; this surface is the company/community UI.
 */

const NETWORK_TABS = ["Resources", "Approvals", "Members", "Invites", "Audit", "Access"] as const;
type NetworkTab = (typeof NETWORK_TABS)[number];
const MEMBER_ROLES: WorkspaceMember["role"][] = ["owner", "admin", "moderator", "publisher", "member", "viewer"];

/** One label/value line in a neutral box (mono value, hairline rows). */
function InfoLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="ohn-info">
      <span className="ohn-info-k">{label}</span>
      <span className="ohn-info-v">{value}</span>
    </div>
  );
}

export function NeutralNetwork() {
  const h = useHarness();
  const [tab, setTab] = useState<NetworkTab>("Resources");
  const catalog = h.workspaceCatalog;
  const workspace = catalog?.workspace;
  const riskCounts = catalog?.permissions.riskTiers;
  const riskyCount = (riskCounts?.HIGH ?? 0) + (riskCounts?.CRITICAL ?? 0);
  const riskClass = riskyCount > 0 ? "warn" : "safe";
  const connectedSlug = workspace?.slug ?? h.workspaceSlug.replace(/^@/, "").trim().toLowerCase();

  return (
    <div className="oh-neutral">
      <header className="ohn-head">
        <div className="ohn-owner">Workspaces</div>
        <h2 className="ohn-title">{workspace ? workspace.name : "Workspace catalog"}</h2>
        {workspace && (
          <div className="ohn-tagrow">
            <span className="ohn-tag safe">@{workspace.slug}</span>
            <span className="ohn-tag">{workspace.type}</span>
            <span className="ohn-tag">{workspace.visibility}</span>
            <span className="ohn-tag">{workspace.plan}</span>
            <span className={`ohn-tag ${riskClass}`}>{riskyCount ? `${riskyCount} high risk` : "no high risk"}</span>
          </div>
        )}
      </header>

      <section className="ohn-box" style={{ marginBottom: 14 }}>
        <h4 className="ohn-box-title">Connect a workspace</h4>
        <form
          className="ohn-form"
          onSubmit={(event) => {
            event.preventDefault();
            void h.loadWorkspace();
          }}
        >
          <div className="ohn-field">
            <label className="ohn-label" htmlFor="ohn-network-org">Workspace</label>
            <input
              id="ohn-network-org"
              className="ohn-input"
              value={h.workspaceSlug}
              onChange={(event) => h.setWorkspaceSlug(event.target.value)}
              placeholder="acme"
              autoComplete="organization"
            />
          </div>
          <div className="ohn-field">
            <label className="ohn-label" htmlFor="ohn-network-token">Workspace token</label>
            <input
              id="ohn-network-token"
              className="ohn-input"
              type="password"
              value={h.workspaceToken}
              onChange={(event) => h.setWorkspaceToken(event.target.value)}
              placeholder="Optional when logged in as a member"
              autoComplete="current-password"
            />
          </div>
          <button type="submit" className="ohn-btn ohn-btn-primary" disabled={h.workspaceBusy || !h.workspaceSlug.trim()}>
            {h.workspaceBusy ? "Loading..." : "Connect"}
          </button>
        </form>
        {h.workspaceStatus && (
          <p className={`ohn-status${isErrorStatus(h.workspaceStatus) ? " is-error" : ""}`}>{h.workspaceStatus}</p>
        )}
      </section>

      <div className="ohn-tabs" role="tablist">
        {NETWORK_TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={entry === tab}
            className="ohn-tab"
            data-active={entry === tab ? "" : undefined}
            onClick={() => setTab(entry)}
          >
            {entry}
          </button>
        ))}
      </div>

      {tab === "Resources" && (
        <div className="ohn-rows" style={{ marginTop: 12 }}>
          {(catalog?.resources ?? catalog?.items ?? []).map((item) => (
            <div className="ohn-row" key={item.id}>
              <span className="ohn-row-glyph">{resourceGlyph(item)}</span>
              <span className="ohn-row-main">
                <span><b>{item.title}</b> · {item.summary}</span>
                <span className="ohn-tagrow" style={{ marginTop: 0 }}>
                  <span className="ohn-tag">{item.id}</span>
                  <span className="ohn-tag">{item.resourceType}</span>
                  <span className={`ohn-tag ${trustClass(item)}`}>{item.trust.securityScan ?? "not scanned"}</span>
                  <span className="ohn-tag">{item.installability}</span>
                  {item.workspaceApproval && <span className="ohn-tag safe">Approved by {item.workspaceApproval.workspaceName}</span>}
                </span>
                <span className="ohn-btnrow" style={{ marginTop: 8 }}>
                  <button type="button" className="ohn-btn ohn-btn-secondary" onClick={() => h.openResource(item)}>Use</button>
                  <button
                    type="button"
                    className="ohn-btn ohn-btn-mono"
                    onClick={() => h.copyText(resourceDetailCommand(item, connectedSlug), "Workspace resource command copied", `workspace:${item.id}:detail`)}
                  >
                    Copy detail
                  </button>
                  <button
                    type="button"
                    className="ohn-btn ohn-btn-mono"
                    onClick={() => h.copyText(resourceOpenCommand(item, connectedSlug), "Workspace open command copied", `workspace:${item.id}:open`)}
                  >
                    Copy open
                  </button>
                </span>
              </span>
            </div>
          ))}
          {catalog && !catalog.resources.length && (
            <div className="ohn-row"><span className="ohn-row-glyph">□</span><span className="ohn-row-main">No workspace resources indexed yet.</span></div>
          )}
          {!catalog && (
            <div className="ohn-row"><span className="ohn-row-glyph">▣</span><span className="ohn-row-main">Connect with a workspace token or signed-in membership to load private and approved resources.</span></div>
          )}
        </div>
      )}

      {tab === "Members" && (
        <div className="ohn-rows" style={{ marginTop: 12 }}>
          {h.workspaceMembers.map((member) => (
            <div className="ohn-row" key={member.user_id}>
              <span className="ohn-row-glyph">◉</span>
              <span className="ohn-row-main">
                <span><b>{member.user_id}</b></span>
                <span className="ohn-tagrow" style={{ marginTop: 0 }}>
                  <span className="ohn-tag safe">{member.role}</span>
                  <span className="ohn-tag">{member.status}</span>
                  <span className="ohn-tag">{member.source}</span>
                  <span className="ohn-tag">{member.joined_at ? new Date(member.joined_at).toLocaleString() : "unknown time"}</span>
                </span>
              </span>
            </div>
          ))}
          {catalog && !h.workspaceMembers.length && (
            <div className="ohn-row"><span className="ohn-row-glyph">□</span><span className="ohn-row-main">No visible members for this workspace.</span></div>
          )}
          {!catalog && (
            <div className="ohn-row"><span className="ohn-row-glyph">◉</span><span className="ohn-row-main">Connect first to list active members.</span></div>
          )}
        </div>
      )}

      {tab === "Approvals" && (
        <div className="ohn-grid" style={{ marginTop: 12 }}>
          <div className="ohn-col">
            <section className="ohn-box">
              <h4 className="ohn-box-title">Approve into workspace</h4>
              <form
                className="ohn-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void h.approveWorkspaceResource();
                }}
              >
                <div className="ohn-field">
                  <label className="ohn-label" htmlFor="ohn-approval-resource">Public resource ID</label>
                  <input
                    id="ohn-approval-resource"
                    className="ohn-input"
                    value={h.workspaceApprovalResourceId}
                    onChange={(event) => h.setWorkspaceApprovalResourceId(event.target.value)}
                    placeholder="onlyharness:harnesses/deep-market-researcher"
                  />
                </div>
                <div className="ohn-field">
                  <label className="ohn-label" htmlFor="ohn-approval-collection">Approval list</label>
                  <input
                    id="ohn-approval-collection"
                    className="ohn-input"
                    value={h.workspaceCollectionSlug}
                    onChange={(event) => h.setWorkspaceCollectionSlug(event.target.value)}
                    placeholder="approved"
                  />
                </div>
                <div className="ohn-field">
                  <label className="ohn-label" htmlFor="ohn-approval-name">Workspace name</label>
                  <input
                    id="ohn-approval-name"
                    className="ohn-input"
                    value={h.workspaceApprovalName}
                    onChange={(event) => h.setWorkspaceApprovalName(event.target.value)}
                    placeholder="optional slug"
                  />
                </div>
                <div className="ohn-field">
                  <label className="ohn-label" htmlFor="ohn-approval-note">Note</label>
                  <input
                    id="ohn-approval-note"
                    className="ohn-input"
                    value={h.workspaceApprovalNote}
                    onChange={(event) => h.setWorkspaceApprovalNote(event.target.value)}
                    placeholder="why this is approved here"
                  />
                </div>
                <button type="submit" className="ohn-btn ohn-btn-primary" disabled={h.workspaceBusy || !h.workspaceSlug.trim() || !h.workspaceApprovalResourceId.trim()}>
                  Approve
                </button>
              </form>
              {h.workspaceCollectionStatus && <p className={`ohn-status${isErrorStatus(h.workspaceCollectionStatus) ? " is-error" : ""}`}>{h.workspaceCollectionStatus}</p>}
              <p className="ohn-note">Approval is scoped to this workspace. It is not a public marketplace collection or an OnlyHarness Verified badge.</p>
            </section>
          </div>

          <aside className="ohn-aside">
            <section className="ohn-box">
              <h4 className="ohn-box-title">CLI equivalent</h4>
              <pre className="ohn-pre">{collectionApproveCommand(connectedSlug, h.workspaceApprovalResourceId, h.workspaceCollectionSlug, h.workspaceApprovalName)}</pre>
              <div className="ohn-btnrow" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="ohn-btn ohn-btn-mono"
                  onClick={() => h.copyText(collectionApproveCommand(connectedSlug, h.workspaceApprovalResourceId, h.workspaceCollectionSlug, h.workspaceApprovalName), "Workspace approval command copied", "workspace-approve-command")}
                >
                  Copy approve command
                </button>
              </div>
            </section>
          </aside>

          <div className="ohn-col" style={{ gridColumn: "1 / -1" }}>
            <div className="ohn-rows">
              {(catalog?.collections ?? []).map((collection) => (
                <CollectionRows
                  key={collection.slug}
                  collection={collection}
                  workspaceSlug={connectedSlug}
                  busy={h.workspaceBusy}
                  onRemove={(itemId) => void h.removeWorkspaceCollectionItem(collection.slug, itemId)}
                  onCopy={(text, label, tag) => h.copyText(text, label, tag)}
                />
              ))}
              {catalog && !catalog.collections.length && (
                <div className="ohn-row"><span className="ohn-row-glyph">□</span><span className="ohn-row-main">No workspace approval lists yet.</span></div>
              )}
              {!catalog && (
                <div className="ohn-row"><span className="ohn-row-glyph">□</span><span className="ohn-row-main">Connect first to manage approved resources.</span></div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "Invites" && (
        <div className="ohn-grid" style={{ marginTop: 12 }}>
          <div className="ohn-col">
            <section className="ohn-box">
              <h4 className="ohn-box-title">Create invite</h4>
              <form
                className="ohn-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void h.createWorkspaceInvite();
                }}
              >
                <div className="ohn-field">
                  <label className="ohn-label" htmlFor="ohn-invite-role">Role</label>
                  <select
                    id="ohn-invite-role"
                    className="ohn-input"
                    value={h.workspaceInviteRole}
                    onChange={(event) => h.setWorkspaceInviteRole(event.target.value as WorkspaceMember["role"])}
                  >
                    {MEMBER_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                  </select>
                </div>
                <div className="ohn-field">
                  <label className="ohn-label" htmlFor="ohn-invite-uses">Max uses</label>
                  <input
                    id="ohn-invite-uses"
                    className="ohn-input"
                    inputMode="numeric"
                    value={h.workspaceInviteMaxUses}
                    onChange={(event) => h.setWorkspaceInviteMaxUses(event.target.value)}
                    placeholder="1"
                  />
                </div>
                <button type="submit" className="ohn-btn ohn-btn-primary" disabled={h.workspaceBusy || !h.workspaceSlug.trim()}>
                  Create invite
                </button>
              </form>
              {h.workspaceInviteStatus && <p className={`ohn-status${isErrorStatus(h.workspaceInviteStatus) ? " is-error" : ""}`}>{h.workspaceInviteStatus}</p>}
              {h.workspaceInviteCode && (
                <div className="ohn-term" style={{ marginTop: 10 }}>
                  <div className="ohn-term-body">{h.workspaceInviteCode}</div>
                  <div className="ohn-term-foot">
                    <button type="button" className="ohn-btn ohn-btn-mono" onClick={() => h.copyText(h.workspaceInviteCode, "Invite code copied", "workspace-invite")}>
                      Copy invite code
                    </button>
                    <span className="ohn-term-foot-note">OnlyHarness stores the hash, not this raw code.</span>
                  </div>
                </div>
              )}
            </section>
          </div>

          <aside className="ohn-aside">
            <section className="ohn-box">
              <h4 className="ohn-box-title">Join workspace</h4>
              <form
                className="ohn-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void h.joinWorkspace();
                }}
              >
                <div className="ohn-field">
                  <label className="ohn-label" htmlFor="ohn-join-code">Invite code</label>
                  <input
                    id="ohn-join-code"
                    className="ohn-input"
                    value={h.workspaceJoinCode}
                    onChange={(event) => h.setWorkspaceJoinCode(event.target.value)}
                    placeholder="ohwi_..."
                    autoComplete="one-time-code"
                  />
                </div>
                <button type="submit" className="ohn-btn ohn-btn-secondary" disabled={h.workspaceBusy || !h.workspaceSlug.trim() || !h.workspaceJoinCode.trim()}>
                  Join
                </button>
              </form>
              {h.workspaceJoinStatus && <p className={`ohn-status${isErrorStatus(h.workspaceJoinStatus) ? " is-error" : ""}`}>{h.workspaceJoinStatus}</p>}
              <p className="ohn-note">Joining requires a signed-in user session. Workspace tokens are for automation and admin flows.</p>
            </section>
          </aside>
        </div>
      )}

      {tab === "Audit" && (
        <div className="ohn-rows" style={{ marginTop: 12 }}>
          {(catalog?.audit ?? []).map((row) => (
            <div className="ohn-row" key={`${row.at}-${row.action}-${row.target ?? ""}`}>
              <span className="ohn-row-glyph">□</span>
              <span className="ohn-row-main">
                <span><b>{row.action}</b> · {row.target ?? "no target"}</span>
                <span className="ohn-tagrow" style={{ marginTop: 0 }}>
                  <span className="ohn-tag">{row.token_name ?? "member/session"}</span>
                  <span className="ohn-tag">{row.subject ?? "anonymous"}</span>
                  <span className="ohn-tag">{row.at ? new Date(row.at).toLocaleString() : "unknown time"}</span>
                </span>
              </span>
            </div>
          ))}
          {catalog && !catalog.audit.length && (
            <div className="ohn-row"><span className="ohn-row-glyph">□</span><span className="ohn-row-main">No audit rows for this workspace yet.</span></div>
          )}
          {!catalog && (
            <div className="ohn-row"><span className="ohn-row-glyph">□</span><span className="ohn-row-main">Audit appears after a successful connection.</span></div>
          )}
        </div>
      )}

      {tab === "Access" && (
        <div className="ohn-grid" style={{ marginTop: 12 }}>
          <div className="ohn-col">
            <section className="ohn-box">
              <h4 className="ohn-box-title">Resource summary</h4>
              <InfoLine label="Resources" value={String(catalog?.permissions.totalResources ?? 0)} />
              <InfoLine label="Hosted archives" value={String(catalog?.permissions.hostedArchives ?? 0)} />
              <InfoLine label="Unscanned" value={String(catalog?.permissions.unscanned ?? 0)} />
              <InfoLine
                label="Risk tiers"
                value={catalog
                  ? `LOW ${catalog.permissions.riskTiers.LOW} · MED ${catalog.permissions.riskTiers.MEDIUM} · HIGH ${catalog.permissions.riskTiers.HIGH} · CRIT ${catalog.permissions.riskTiers.CRITICAL} · UNKNOWN ${catalog.permissions.riskTiers.UNKNOWN}`
                  : "not loaded"}
              />
            </section>
          </div>
          <aside className="ohn-aside">
            <section className="ohn-box">
              <h4 className="ohn-box-title">Agent setup commands</h4>
              <pre className="ohn-pre">{workspaceCommands(connectedSlug)}</pre>
              <div className="ohn-btnrow" style={{ marginTop: 10 }}>
                <button type="button" className="ohn-btn ohn-btn-mono" onClick={() => h.copyText(workspaceCommands(connectedSlug), "Workspace commands copied", "workspace-commands")}>
                  Copy commands
                </button>
              </div>
              <p className="ohn-note">CLI workspace access is still token-based. Web/API can also use active workspace membership.</p>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

function CollectionRows({ collection, workspaceSlug, busy, onRemove, onCopy }: {
  collection: WorkspaceCollection;
  workspaceSlug: string;
  busy: boolean;
  onRemove: (itemId: string) => void;
  onCopy: (text: string, label: string, tag: string) => void;
}) {
  return (
    <>
      <div className="ohn-row">
        <span className="ohn-row-glyph">▤</span>
        <span className="ohn-row-main">
          <span><b>{collection.title}</b>{collection.summary ? ` · ${collection.summary}` : ""}</span>
          <span className="ohn-tagrow" style={{ marginTop: 0 }}>
            <span className="ohn-tag">{collection.slug}</span>
            <span className="ohn-tag">{collection.visibility}</span>
            <span className="ohn-tag">{collection.items.length} items</span>
          </span>
        </span>
      </div>
      {collection.items.map((item) => (
        <div className="ohn-row" key={item.id}>
          <span className="ohn-row-glyph">□</span>
          <span className="ohn-row-main">
            <span><b>{item.itemRef}</b>{item.sourceResourceId ? ` · ${item.sourceResourceId}` : ""}</span>
            <span className="ohn-tagrow" style={{ marginTop: 0 }}>
              <span className={`ohn-tag ${item.approvalState === "approved" ? "safe" : item.approvalState === "approved_with_warning" ? "warn" : ""}`}>{item.approvalState}</span>
              <span className="ohn-tag">{item.itemSource}</span>
              <span className="ohn-tag">{item.id}</span>
              {item.approvedAt && <span className="ohn-tag">{new Date(item.approvedAt).toLocaleString()}</span>}
            </span>
            <span className="ohn-btnrow" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="ohn-btn ohn-btn-mono"
                onClick={() => onCopy(collectionRemoveCommand(workspaceSlug, collection.slug, item.id), "Workspace remove command copied", `workspace:${collection.slug}:${item.id}:remove`)}
              >
                Copy remove
              </button>
              <button type="button" className="ohn-btn ohn-btn-secondary" disabled={busy} onClick={() => onRemove(item.id)}>
                Remove
              </button>
            </span>
            {item.note && <span className="ohn-note">{item.note}</span>}
          </span>
        </div>
      ))}
    </>
  );
}

function isErrorStatus(value: string): boolean {
  return /failed|required|denied|not enabled|not found|invalid|expired|error/i.test(value);
}

function resourceGlyph(item: ResourceItem): string {
  if (item.resourceType === "harness") return "▣";
  if (item.resourceType === "skill") return "◇";
  if (item.resourceType === "plugin") return "▧";
  if (item.resourceType === "mcp_server") return "⌁";
  if (item.resourceType === "workflow") return "↔";
  return "□";
}

function trustClass(item: ResourceItem): "safe" | "warn" | "danger" {
  if (item.trust.securityScan === "pass") return "safe";
  if (item.trust.securityScan === "fail") return "danger";
  return "warn";
}

function resourceDetailCommand(item: ResourceItem, workspaceSlug: string): string {
  const ref = item.id.startsWith("@") ? item.id : `${item.id} --workspace ${workspaceSlug || "<workspace>"}`;
  return `HH_WORKSPACE_TOKEN=<token> npx onlyharness@latest resources detail ${ref} --json`;
}

function resourceOpenCommand(item: ResourceItem, workspaceSlug: string): string {
  const ref = item.id.startsWith("@") ? item.id : `${item.id} --workspace ${workspaceSlug || "<workspace>"}`;
  return `HH_WORKSPACE_TOKEN=<token> npx onlyharness@latest resources open ${ref} --json`;
}

function workspaceCommands(workspaceSlug: string): string {
  const slug = workspaceSlug || "<workspace>";
  return [
    `export HH_WORKSPACE_TOKEN=<token>`,
    `npx onlyharness@latest resources search --workspace ${slug}`,
    `npx onlyharness@latest publish-resource ./agent-resource --workspace ${slug} --name my-agent-tool --type command_pack`,
    `npx onlyharness@latest resources detail @${slug}/my-agent-tool --json`
  ].join("\n");
}

function collectionApproveCommand(workspaceSlug: string, resourceId: string, collectionSlug: string, name: string): string {
  const slug = workspaceSlug || "<workspace>";
  const resource = resourceId.trim() || "<public-resource-id>";
  const collection = collectionSlug.trim() || "approved";
  const nameArg = name.trim() ? ` --name ${name.trim()}` : "";
  return `HH_WORKSPACE_TOKEN=<token> npx onlyharness@latest resources approve ${resource} --workspace ${slug} --collection ${collection}${nameArg} --json`;
}

function collectionRemoveCommand(workspaceSlug: string, collectionSlug: string, itemId: string): string {
  const slug = workspaceSlug || "<workspace>";
  return `HH_WORKSPACE_TOKEN=<token> npx onlyharness@latest resources unapprove ${itemId} --workspace ${slug} --collection ${collectionSlug} --json`;
}
