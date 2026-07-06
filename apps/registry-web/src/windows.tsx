import { useState } from "react";
import { fmtContextCost, fmtK, heatPct, isoWeek } from "./format";
import type { CompatibilityTarget, HarnessDetail, OrgWorkspace, RegistryItem, StorefrontPage } from "./types";
import { Btn, HeatMeter, InfoLine, TabStrip } from "./win98";

/* ---------- New Harness Wizard (publish) ---------- */

export function PublishBody({ name, setName, markdown, setMarkdown, status, busy, loggedIn, onSubmit, onLogon }: {
  name: string;
  setName: (value: string) => void;
  markdown: string;
  setMarkdown: (value: string) => void;
  status: string;
  busy: boolean;
  loggedIn: boolean;
  onSubmit: () => void;
  onLogon: () => void;
}) {
  return (
    <div className="win-body">
      <div className="wizard">
        <div className="wizard-side">
          <span className="big-glyph">🧷</span>
          <span className="side-title">New Harness Wizard</span>
        </div>
        <div className="wizard-main">
          <p style={{ margin: 0, fontSize: 12.5 }}>
            Paste a rough markdown workflow. The wizard turns it into a harness repo:
            manifest, agent prompt, example and an eval stub — ready to <b>run, eval and gate</b>.
          </p>
          <div>
            <label htmlFor="wiz-name">Harness name</label>
            <div className="field98">
              <input id="wiz-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="customer-research-pipeline" />
            </div>
          </div>
          <div>
            <label htmlFor="wiz-md">Workflow markdown</label>
            <div className="field98">
              <textarea id="wiz-md" rows={9} value={markdown} onChange={(event) => setMarkdown(event.target.value)} />
            </div>
          </div>
          <div className="plate">
            <b>What gets created</b>
            <ul className="check-list">
              <li>harness.yaml with conservative permissions</li>
              <li>Agent prompt plus example input/output</li>
              <li>Eval case ready for hh eval &amp;&amp; hh gate</li>
              <li>A registry card on the Explore frontier</li>
            </ul>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {loggedIn ? (
              <Btn strong big onClick={onSubmit} disabled={busy}>{busy ? "⌛ Publishing..." : "📦 Publish harness"}</Btn>
            ) : (
              <>
                <Btn strong big onClick={onLogon}>🔑 Log on to publish</Btn>
                <span style={{ fontSize: 11, color: "#404040" }}>Publishing needs an account.</span>
              </>
            )}
            {status && <span style={{ fontSize: 12, fontWeight: "bold" }}>{status}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Install Center ---------- */

const INSTALL_TABS = ["CLI", "MCP", "Plugin", "Planned"] as const;
type InstallTab = (typeof INSTALL_TABS)[number];

export function InstallBody({ item, onCopy, copied }: { item?: RegistryItem; onCopy: (text: string, target: "cli" | "archive" | "mcp" | "plugin") => void; copied: boolean }) {
  const [tab, setTab] = useState<InstallTab>("CLI");
  const target = item ? `${item.owner}/${item.name}` : "";
  const isDirectory = item?.contentType === "directory";
  const directoryUrl = item?.directory?.url ?? item?.forgeUrl;
  const cliCommands = item && isDirectory
    ? `open ${directoryUrl}\n# Link-only directory. Review upstream source and licensing before importing entries.`
    : item
    ? [
        `npx onlyharness pull ${target}`,
        `npx onlyharness run ${item.name} --json`,
        `npx onlyharness eval ${item.name} --json`,
        `npx onlyharness gate --dir ${item.name} --json`
      ].join("\n")
    : "Select a harness to generate install commands.";
  const archive = item && isDirectory ? directoryUrl ?? "" : item ? `curl -s https://onlyharness.com/api/repos/${target}/archive` : "";
  const mcpConfig = item && isDirectory
    ? `# Directory entries are link-only.\nopen ${directoryUrl}`
    : item
    ? `claude mcp add onlyharness https://onlyharness.com/mcp\n# then call pull_harness with { "owner": "${item.owner}", "name": "${item.name}" }`
    : "Select a harness to generate MCP setup.";
  const pluginGuide = item && isDirectory
    ? `# Plugin install is not needed for link-only directories.\nopen ${directoryUrl}`
    : item
    ? `cp -R plugins/onlyharness ~/.codex/plugins/onlyharness\n# plugin v0.1 exposes the OnlyHarness skill and MCP wiring guide.\n# Use: npx onlyharness pull ${target}`
    : "Select a harness to generate plugin setup.";
  const targets: CompatibilityTarget[] = isDirectory ? [
    { name: "Open link", status: "available", detail: directoryUrl },
    { name: "License review", status: "planned", detail: "required before vendoring upstream content" },
    { name: "Harness import", status: "planned", detail: "convert selected entries only after source review" }
  ] : [
    { name: "CLI", status: "available", detail: "npx onlyharness pull/run/eval/gate" },
    { name: "HTTP archive", status: "available", detail: "/api/repos/{owner}/{name}/archive" },
    { name: "MCP", status: "available", detail: "pull_instructions + harness_detail" },
    { name: "Claude Code plugin", status: "available", detail: "skill + .mcp.json" },
    { name: "Cursor adapter", status: "planned", detail: "adapter command not shipped yet" },
    { name: "Team bundle", status: "available", detail: "hh setup @org / hh publish --org with HH_ORG_TOKEN" }
  ];

  return (
    <div className="win-body">
      <div className="detail-head">
        <div className="owner-line">{isDirectory ? "Directory Shelf" : "Install Center"}</div>
        <h2>{item?.title ?? "Pick a harness"}</h2>
        <div className="promise">{item?.summary ?? "No harness selected."}</div>
      </div>

      <div className="detail-grid">
        <section>
          <TabStrip tabs={INSTALL_TABS} active={tab} onSelect={setTab} />
          <div className="trust-box">
            <h4>{isDirectory ? "Directory link" : tab === "CLI" ? "Recommended install loop" : tab === "MCP" ? "MCP setup" : tab === "Plugin" ? "Plugin v0.1" : "Planned adapters"}</h4>
            {tab === "CLI" && <pre className="pre98">{cliCommands}</pre>}
            {tab === "MCP" && <pre className="pre98">{mcpConfig}</pre>}
            {tab === "Plugin" && <pre className="pre98">{pluginGuide}</pre>}
            {tab === "Planned" && (
              <div className="file-list">
                {targets.filter((targetInfo) => targetInfo.status === "planned").map((targetInfo) => (
                  <div className="file-row" key={targetInfo.name}>
                    <span className="tag98 warn">planned</span>
                    <span><b>{targetInfo.name}</b> · {targetInfo.detail}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <Btn strong disabled={!item} onClick={() => onCopy(tab === "MCP" ? mcpConfig : tab === "Plugin" ? pluginGuide : cliCommands, tab === "MCP" ? "mcp" : tab === "Plugin" ? "plugin" : "cli")}>{copied ? "✓ Copied" : "📋 Copy shown setup"}</Btn>
              <Btn disabled={!item} onClick={() => onCopy(archive, "archive")}>{isDirectory ? "🌐 Copy directory URL" : "📦 Copy archive curl"}</Btn>
            </div>
          </div>

          <div className="trust-box" style={{ marginTop: 8 }}>
            <h4>Compatibility targets</h4>
            <div className="file-list">
              {targets.map((targetInfo) => (
                <div className="file-row" key={targetInfo.name}>
                  <span className={`tag98 ${targetInfo.status === "available" ? "safe" : "warn"}`}>
                    {targetInfo.status}
                  </span>
                  <span><b>{targetInfo.name}</b> · {targetInfo.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="trust-panel">
          <div className="trust-box">
            <h4>{isDirectory ? "Trust before import" : "Trust before install"}</h4>
            <InfoLine label="Eval" value={item ? `${item.evalScore ? item.evalScore.toFixed(2) : "unknown"} (${item.evalStatus})` : "select a harness"} />
            <InfoLine label="Risk" value={item ? `${item.riskTier} (${item.riskScore})` : "select a harness"} />
            <InfoLine label="Context" value={item ? fmtContextCost(item.contextCost) : "select a harness"} />
            <InfoLine label="Standard" value={item?.standard ?? "select a harness"} />
          </div>
          <div className="plate" style={{ fontSize: 11 }}>{isDirectory ? "Directory entries are discovery indexes, not runnable harnesses." : "Cursor adapter and team bundle are not shipped yet."}</div>
        </aside>
      </div>
    </div>
  );
}

export function StorefrontBody({ page, handle, referrer, onOpen, onCopy, copied }: {
  page?: StorefrontPage;
  handle: string;
  referrer?: string;
  onOpen: (item: RegistryItem) => void;
  onCopy: (text: string) => void;
  copied: boolean;
}) {
  const baseUrl = typeof window === "undefined" ? "https://onlyharness.com" : window.location.origin;
  const ref = page?.referralCode || referrer || "";
  const refLink = `${baseUrl}/#/@${encodeURIComponent(page?.profile.handle ?? handle)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`;
  return (
    <div className="win-body">
      <div className="detail-head">
        <div className="owner-line">My Briefcase</div>
        <h2>@{page?.profile.handle ?? handle}</h2>
        <div className="promise">{page?.profile.bio || "Creator storefront is loading."}</div>
        <div className="tagrow">
          {ref && <span className="tag98 safe">ref {ref}</span>}
          <span className="tag98">public safe profile</span>
        </div>
      </div>
      <div className="detail-grid">
        <section>
          <div className="trust-box">
            <h4>Published harnesses</h4>
            <div className="file-list">
              {(page?.items ?? []).map((item) => (
                <button className="file-row as-button" key={`${item.owner}/${item.name}`} onClick={() => onOpen(item)}>
                  <span>📦</span>
                  <span><b>{item.title}</b> · {item.summary}</span>
                </button>
              ))}
              {page && !page.items.length && <div className="file-row"><span>□</span><span>No public harnesses attached to this handle yet.</span></div>}
              {!page && <div className="file-row"><span>⌛</span><span>Loading storefront...</span></div>}
            </div>
          </div>
        </section>
        <aside className="trust-panel">
          <div className="trust-box">
            <h4>Creator ref-link</h4>
            <pre className="pre98" style={{ maxHeight: 86 }}>{refLink}</pre>
            <div style={{ marginTop: 8 }}>
              <Btn strong onClick={() => onCopy(refLink)}>{copied ? "✓ Copied" : "📋 Copy ref-link"}</Btn>
            </div>
          </div>
          <div className="plate" style={{ fontSize: 11 }}>Referral attribution is applied at checkout; it does not grant free access.</div>
        </aside>
      </div>
    </div>
  );
}

/* ---------- Network Neighborhood ---------- */

const NETWORK_TABS = ["Catalog", "Audit", "Permissions"] as const;
type NetworkTab = (typeof NETWORK_TABS)[number];

export function NetworkBody({ orgSlug, setOrgSlug, orgToken, setOrgToken, workspace, status, busy, onLoad, onOpen }: {
  orgSlug: string;
  setOrgSlug: (value: string) => void;
  orgToken: string;
  setOrgToken: (value: string) => void;
  workspace?: OrgWorkspace;
  status: string;
  busy: boolean;
  onLoad: () => void;
  onOpen: (item: RegistryItem) => void;
}) {
  const [tab, setTab] = useState<NetworkTab>("Catalog");
  const riskClass = workspace?.permissions.maxRiskTier === "LOW" || workspace?.permissions.maxRiskTier === "NONE" ? "safe" : "warn";
  return (
    <div className="win-body">
      <div className="detail-head">
        <div className="owner-line">Network Neighborhood</div>
        <h2>{workspace ? workspace.organization.name : "Organization workspace"}</h2>
        <div className="tagrow">
          {workspace && <span className="tag98 safe">@{workspace.organization.slug}</span>}
          {workspace && <span className="tag98">{workspace.organization.plan}</span>}
          {workspace && <span className={`tag98 ${riskClass}`}>max risk {workspace.permissions.maxRiskTier}</span>}
        </div>
      </div>

      <div className="trust-box" style={{ marginBottom: 8 }}>
        <form className="network-connect" onSubmit={(event) => { event.preventDefault(); onLoad(); }}>
          <div>
            <label htmlFor="network-org">Org</label>
            <div className="field98"><input id="network-org" value={orgSlug} onChange={(event) => setOrgSlug(event.target.value)} placeholder="acme" autoComplete="organization" /></div>
          </div>
          <div>
            <label htmlFor="network-token">Org token</label>
            <div className="field98"><input id="network-token" type="password" value={orgToken} onChange={(event) => setOrgToken(event.target.value)} placeholder="Bearer token" autoComplete="current-password" /></div>
          </div>
          <Btn strong type="submit" disabled={busy || !orgSlug.trim()}>{busy ? "⌛ Loading" : "🌐 Connect"}</Btn>
        </form>
        {status && <div style={{ marginTop: 6, fontSize: 12, fontWeight: "bold" }}>{status}</div>}
      </div>

      <TabStrip tabs={NETWORK_TABS} active={tab} onSelect={setTab} />

      {tab === "Catalog" && (
        <div className="file-list">
          {(workspace?.items ?? []).map((item) => (
            <button className="file-row as-button" key={`${item.owner}/${item.name}`} onClick={() => onOpen(item)}>
              <span>🔒</span>
              <span>
                <b>{item.title}</b> · {item.summary}
                <span className="tagrow" style={{ marginTop: 4 }}>
                  <span className="tag98">{item.owner}/{item.name}</span>
                  <span className={`tag98 ${item.riskTier === "LOW" ? "safe" : "warn"}`}>{item.riskTier} {item.riskScore}</span>
                  <span className="tag98">ctx {fmtContextCost(item.contextCost)}</span>
                  <span className="tag98 safe">private</span>
                </span>
              </span>
            </button>
          ))}
          {workspace && !workspace.items.length && <div className="file-row"><span>□</span><span>No org-private harnesses indexed yet.</span></div>}
          {!workspace && <div className="file-row"><span>🌐</span><span>Connect with an org token to load private harnesses.</span></div>}
        </div>
      )}

      {tab === "Audit" && (
        <div className="file-list">
          {(workspace?.audit ?? []).map((row) => (
            <div className="file-row" key={`${row.at}-${row.action}-${row.target ?? ""}`}>
              <span>🧾</span>
              <span>
                <b>{row.action}</b> · {row.target ?? "no target"}
                <span className="tagrow" style={{ marginTop: 4 }}>
                  <span className="tag98">{row.token_name ?? "unknown token"}</span>
                  <span className="tag98">{row.subject ?? "anonymous"}</span>
                  <span className="tag98">{row.at ? new Date(row.at).toLocaleString() : "unknown time"}</span>
                </span>
              </span>
            </div>
          ))}
          {workspace && !workspace.audit.length && <div className="file-row"><span>□</span><span>No audit rows for this org yet.</span></div>}
          {!workspace && <div className="file-row"><span>🧾</span><span>Audit appears after a successful connection.</span></div>}
        </div>
      )}

      {tab === "Permissions" && (
        <div className="detail-grid">
          <section>
            <div className="trust-box">
              <h4>Permission summary</h4>
              <InfoLine label="Harnesses" value={String(workspace?.permissions.totalHarnesses ?? 0)} />
              <InfoLine label="Risk tiers" value={workspace ? `LOW ${workspace.permissions.riskTiers.LOW} · MED ${workspace.permissions.riskTiers.MEDIUM} · HIGH ${workspace.permissions.riskTiers.HIGH} · CRIT ${workspace.permissions.riskTiers.CRITICAL}` : "not loaded"} />
              <InfoLine label="External send" value={String(workspace?.permissions.permissionCounts.externalSend ?? 0)} />
              <InfoLine label="Credentials" value={String(workspace?.permissions.permissionCounts.credentials ?? 0)} />
              <InfoLine label="Money movement" value={String(workspace?.permissions.permissionCounts.moneyMovement ?? 0)} />
              <InfoLine label="Shell/browser" value={`${workspace?.permissions.permissionCounts.shell ?? 0}/${workspace?.permissions.permissionCounts.browser ?? 0}`} />
            </div>
          </section>
          <aside className="trust-panel">
            <div className="trust-box">
              <h4>Highest risk report</h4>
              <pre className="pre98" style={{ maxHeight: 220 }}>{workspace?.permissions.riskMarkdown ?? "# Harness Risk\n\nNot loaded."}</pre>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

/* ---------- MS-DOS Prompt (CLI) ---------- */

export function CliBody({ item, onCopy, copied }: { item?: RegistryItem; onCopy: (text: string) => void; copied: boolean }) {
  const pull = item?.cliCommand ?? "hh pull harnesses/deep-market-researcher";
  const isDirectory = item?.contentType === "directory";
  const commands = isDirectory
    ? `${pull}\n# link-only directory: review upstream source and licensing before importing entries`
    : `${pull}\nhh run --input examples/input.md\nhh eval && hh gate\nhh publish`;
  return (
    <div className="win-body">
      <div className="term">
        <span className="dim">OnlyHarness CLI [Version 0.98]{"\n"}(C) Season 4 — Wild West. Fork responsibly.{"\n\n"}</span>
        C:\hub&gt; {pull}{"\n"}
        {isDirectory ? (
          <>
            <span className="dim">{"  "}link-only directory: no run/eval/gate loop{"\n\n"}</span>
          </>
        ) : (
          <>
            C:\hub&gt; hh run --input examples/input.md{"\n"}
            C:\hub&gt; hh eval &amp;&amp; hh gate{"\n"}
            C:\hub&gt; hh publish{"\n\n"}
          </>
        )}
        C:\hub&gt; hh doctor{"\n"}
        <span className="dim">
          {"  "}registry ui ....... http://127.0.0.1:5177 [OK]{"\n"}
          {"  "}harness api ....... http://127.0.0.1:8787 [OK]{"\n"}
          {"  "}forge ............. gitea sidecar [OK]{"\n\n"}
        </span>
        C:\hub&gt;<span className="cursor" />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Btn strong onClick={() => onCopy(commands)}>{copied ? "✓ Copied" : "📋 Copy commands"}</Btn>
        <span style={{ fontSize: 11, color: "#404040" }}>The interface is friendly; the command line stays exact.</span>
      </div>
    </div>
  );
}

/* ---------- Maintainer Review ---------- */

export function ReviewBody({ item, detail, onCopy, copied }: {
  item?: RegistryItem;
  detail?: HarnessDetail;
  onCopy: (text: string) => void;
  copied: boolean;
}) {
  const diff = detail?.prReview?.diff;
  const gateCommands = `hh validate seed-harnesses/${item?.name ?? "deep-market-researcher"} --strict\nhh eval seed-harnesses/${item?.name ?? "deep-market-researcher"}\nhh gate --dir seed-harnesses/${item?.name ?? "deep-market-researcher"}`;
  return (
    <div className="win-body">
      <p style={{ margin: "0 0 10px", fontSize: 12.5 }}>
        Demo semantic review for <b>{item?.title ?? "…"}</b>.
        This view shows the maintainer review shape using a generated local variant; it is not an open pull request.
      </p>
      <div className="review-grid">
        <section>
          <div className="risk-plate">
            <span className="shield">🛡️</span>
            <div>
              <div style={{ fontWeight: "bold" }}>Risk after merge: {diff?.riskTier ?? "…"}</div>
              <div style={{ fontSize: 11, color: "#404040" }}>Risk delta {diff ? (diff.riskDelta >= 0 ? `+${diff.riskDelta}` : diff.riskDelta) : "…"} · review required before release</div>
            </div>
          </div>
          {(diff?.changes ?? []).map((change, index) => (
            <div className="change-row" key={`${change.area}-${index}`}>
              <span className={`severity ${change.severity.toLowerCase()}`}>{change.severity}</span>
              <div>
                <strong>{change.area}</strong>
                <p>{change.message}</p>
              </div>
            </div>
          ))}
          {!diff && <div className="plate">Loading semantic diff...</div>}
        </section>
        <aside style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="trust-box">
            <h4>Gate commands</h4>
            <pre className="pre98" style={{ maxHeight: 120 }}>{gateCommands}</pre>
            <div style={{ marginTop: 6 }}>
              <Btn onClick={() => onCopy(gateCommands)}>{copied ? "✓ Copied" : "📋 Copy commands"}</Btn>
            </div>
          </div>
          <div className="trust-box">
            <h4>Merge policy</h4>
            <InfoLine label="Eval gate" value="must pass" />
            <InfoLine label="Risk" value="no new HIGH" />
            <InfoLine label="Permissions" value="reviewed by human" />
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ---------- Wild West Leaderboard ---------- */

export function LeaderboardBody({ items, onOpen }: { items: RegistryItem[]; onOpen: (item: RegistryItem) => void }) {
  return (
    <div className="win-body">
      <div className="plate" style={{ marginBottom: 8, textAlign: "center", fontWeight: "bold" }}>
        🤠 Week {isoWeek(new Date())} · hottest harnesses in the Wild West
      </div>
      {items.map((item, index) => (
        <button key={`${item.owner}/${item.name}`} className={`lb-row ${index === 0 ? "top" : ""}`} onClick={() => onOpen(item)}>
          <span className="rank">{index + 1}</span>
          <strong>{item.title}</strong>
          <span className={`lb-delta ${item.heatDelta >= 0 ? "up" : "down"}`}>{item.heatDelta >= 0 ? "▲" : "▼"}{Math.abs(item.heatDelta).toFixed(1)}</span>
          <span className="heat-num">{item.heat.toFixed(1)} 🔥</span>
        </button>
      ))}
      <div style={{ fontSize: 11, color: "#404040", marginTop: 6 }}>
        Heat grows with stars, forks, runs and thread replies — and cools down when a harness sits idle.
      </div>
    </div>
  );
}

/* ---------- harness_flex.exe (share card) ---------- */

export function ShareBody({ item, starred, refCode, onCopy, copied }: { item: RegistryItem; starred: boolean; refCode?: string; onCopy: (text: string) => void; copied: boolean }) {
  const stars = item.stars + (starred ? 1 : 0);
  const heat = item.heat + (starred ? 0.4 : 0);
  const isDirectory = item.contentType === "directory";
  const shareBanner = isDirectory ? "★ LOOK AT MY DIRECTORY ★" : "★ LOOK AT MY HARNESS ★";
  const shareCommand = item.cliCommand ?? (isDirectory && item.directory?.url ? `open ${item.directory.url}` : `hh pull ${item.owner}/${item.name}`);
  const metricLine = isDirectory
    ? `★ ${fmtK(stars)} · ⑂ ${fmtK(item.forks)} · 💬 ${item.threads} · ${item.directory?.itemCount ?? "curated"} items · Heat ${heat.toFixed(1)}🔥`
    : `★ ${fmtK(stars)} · ⑂ ${fmtK(item.forks)} · 💬 ${item.threads} · eval ${item.evalScore ? item.evalScore.toFixed(2) : "—"} · context ${fmtContextCost(item.contextCost)} · Heat ${heat.toFixed(1)}🔥`;
  const baseUrl = typeof window === "undefined" ? "https://onlyharness.com" : window.location.origin;
  const shareUrl = `${baseUrl}/#/h/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.name)}${refCode ? `?ref=${encodeURIComponent(refCode)}` : ""}`;
  const brag = `${shareBanner}\n${item.title} — ${item.summary}\n${metricLine}\nWorks with: ${isDirectory ? "Open link, source review" : "CLI, MCP, HTTP archive"}\n${shareUrl}\n> ${shareCommand}`;
  return (
    <div className="win-body">
      <div className="share-stage">
        <div className="share-canvas">
          <div className="win share-win">
            <div className="titlebar">
              <span className="tb-text"><span className="tb-icon">💾</span><span>harness_flex.exe</span></span>
              <span className="tb-controls"><span className="tb-btn">_</span><span className="tb-btn">×</span></span>
            </div>
            <div style={{ flex: 1, display: "flex", gap: 22, padding: 24, minHeight: 0 }}>
              <div style={{ flex: 1.5, display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div className="share-banner">{shareBanner}</div>
                <div className="share-title-box">
                  <div className="wordart">{item.title}</div>
                </div>
                <div className="share-promise">{item.summary}</div>
                <div className="share-tags">
                  {item.tags.slice(0, 2).map((tag) => <span key={tag} className="tag98">#{tag.replace(/^#/, "")}</span>)}
                  {item.riskTier === "LOW" && <span className="tag98 safe">✓ safety reviewed</span>}
                  <span className="tag98 safe">{isDirectory ? "Open link" : "CLI"}</span>
                  <span className="tag98 safe">{isDirectory ? "Source review" : "MCP"}</span>
                </div>
                <div style={{ flex: 1 }} />
                <div className="share-stats">
                  <div className="share-stat"><div className="num">★ {fmtK(stars)}</div><div className="cap">stars</div></div>
                  <div className="share-stat"><div className="num">⑂ {fmtK(item.forks)}</div><div className="cap">forks</div></div>
                  <div className="share-stat"><div className="num">💬 {item.threads}</div><div className="cap">threads</div></div>
                  <div className="share-stat"><div className="num ok">{isDirectory ? item.directory?.itemCount ?? "—" : item.evalScore ? item.evalScore.toFixed(2) : "—"}</div><div className="cap">{isDirectory ? "items" : "eval"}</div></div>
                  <div className="share-stat"><div className="num">{isDirectory ? item.directory?.category ?? "index" : fmtK(item.contextCost.approxTokens)}</div><div className="cap">{isDirectory ? "category" : "ctx tokens"}</div></div>
                </div>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
                <div className="win share-heat-panel" style={{ flex: 1 }}>
                  <div className="titlebar maroon"><span className="tb-text">🔥 Harness Heat</span></div>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 14 }}>
                    <div className="heat-giant">{heat.toFixed(1)}</div>
                    <div className="share-trend">▲ +{Math.max(0, item.heatDelta).toFixed(1)} this week</div>
                    <div className="heat-track" style={{ width: "100%", height: 26, marginTop: 14, padding: 3 }}>
                      <div className="heat-fill" style={{ width: `${heatPct(heat)}%` }} />
                    </div>
                  </div>
                </div>
                <div className="share-award">
                  <span style={{ fontSize: 40 }}>🏆</span>
                  <span>{isDirectory ? <>Curated link-only<br />directory · Wk {isoWeek(new Date())}</> : item.badge.includes("Wild") ? <>Best Harness in the<br />Wild West · Wk {isoWeek(new Date())} 🤠</> : <>Certified frontier<br />harness 🤠</>}</span>
                </div>
              </div>
            </div>
            <div className="share-footer">
              <span>&gt; {shareCommand}</span>
              <span className="site">onlyharness.com 🌐</span>
            </div>
          </div>
          <div style={{ position: "absolute", bottom: 20, right: 20, fontSize: 64, filter: "drop-shadow(2px 3px 1px rgba(0,0,0,.45))", zIndex: 3 }}>🧷</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Btn strong onClick={() => onCopy(brag)}>{copied ? "✓ Copied" : "📋 Copy brag text"}</Btn>
        <span style={{ fontSize: 11, color: "#404040" }}>Paste it in Telegram, X or the group chat that doubts you.</span>
      </div>
    </div>
  );
}
