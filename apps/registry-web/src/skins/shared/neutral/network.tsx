import { useState } from "react";
import type { ReactNode } from "react";

import { fmtContextCost } from "../../../core/format";
import { useHarness } from "../../../core/store";

/*
 * Shared-neutral Network / Workspace — the "serious" admin surface
 * rendered identically in every skin (only the `--neutral-*` palette changes).
 * Mirrors the Win98 `NetworkBody` field-for-field: the workspace header (name / @slug /
 * plan / max-risk tag), the Connect form (Workspace + token password -> connect),
 * the connection status line, and the Catalog / Audit / Permissions tabs.
 *
 * Pure consumer of `useHarness()`: the org connection form state
 * (`networkOrg`/`setNetworkOrg`, `networkToken`/`setNetworkToken`), the request
 * status/busy flags (`networkStatus`, `networkBusy`), the loaded `orgWorkspace`,
 * `loadOrgWorkspace`, and `openHarness` all come from the store. Private catalog
 * rows deep-link into the harness detail; permissions summarise risk exposure and
 * echo the highest-risk markdown report. Honest empty states before a connection.
 */

const NETWORK_TABS = ["Catalog", "Audit", "Permissions"] as const;
type NetworkTab = (typeof NETWORK_TABS)[number];

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
  const [tab, setTab] = useState<NetworkTab>("Catalog");
  const workspace = h.orgWorkspace;
  const maxRiskTier = workspace?.permissions.maxRiskTier;
  const riskClass = maxRiskTier === "LOW" || maxRiskTier === "NONE" ? "safe" : "warn";

  return (
    <div className="oh-neutral">
      <header className="ohn-head">
        <div className="ohn-owner">Network / Workspace</div>
        <h2 className="ohn-title">{workspace ? workspace.organization.name : "Workspace catalog"}</h2>
        {workspace && (
          <div className="ohn-tagrow">
            <span className="ohn-tag safe">@{workspace.organization.slug}</span>
            <span className="ohn-tag">{workspace.organization.plan}</span>
            <span className={`ohn-tag ${riskClass}`}>max risk {maxRiskTier}</span>
          </div>
        )}
      </header>

      <section className="ohn-box" style={{ marginBottom: 14 }}>
        <h4 className="ohn-box-title">Connect a workspace</h4>
        <form
          className="ohn-form"
          onSubmit={(event) => {
            event.preventDefault();
            void h.loadOrgWorkspace();
          }}
        >
          <div className="ohn-field">
            <label className="ohn-label" htmlFor="ohn-network-org">Workspace</label>
            <input
              id="ohn-network-org"
              className="ohn-input"
              value={h.networkOrg}
              onChange={(event) => h.setNetworkOrg(event.target.value)}
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
              value={h.networkToken}
              onChange={(event) => h.setNetworkToken(event.target.value)}
              placeholder="Bearer token"
              autoComplete="current-password"
            />
          </div>
          <button type="submit" className="ohn-btn ohn-btn-primary" disabled={h.networkBusy || !h.networkOrg.trim()}>
            {h.networkBusy ? "⌛ Loading…" : "Connect"}
          </button>
        </form>
        {h.networkStatus && (
          <p className={`ohn-status${h.networkStatus.toLowerCase().includes("fail") ? " is-error" : ""}`}>{h.networkStatus}</p>
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

      {tab === "Catalog" && (
        <div className="ohn-rows" style={{ marginTop: 12 }}>
          {(workspace?.items ?? []).map((item) => (
            <button type="button" className="ohn-row" key={`${item.owner}/${item.name}`} onClick={() => h.openHarness(item)}>
              <span className="ohn-row-glyph">🔒</span>
              <span className="ohn-row-main">
                <span><b>{item.title}</b> · {item.summary}</span>
                <span className="ohn-tagrow" style={{ marginTop: 0 }}>
                  <span className="ohn-tag">{item.owner}/{item.name}</span>
                  <span className={`ohn-tag ${item.riskTier === "LOW" ? "safe" : "warn"}`}>{item.riskTier} {item.riskScore}</span>
                  <span className="ohn-tag">ctx {fmtContextCost(item.contextCost)}</span>
                  <span className="ohn-tag safe">private</span>
                </span>
              </span>
            </button>
          ))}
          {workspace && !workspace.items.length && (
            <div className="ohn-row"><span className="ohn-row-glyph">□</span><span className="ohn-row-main">No workspace-private resources indexed yet.</span></div>
          )}
          {!workspace && (
            <div className="ohn-row"><span className="ohn-row-glyph">🌐</span><span className="ohn-row-main">Connect with a workspace token to load private resources.</span></div>
          )}
        </div>
      )}

      {tab === "Audit" && (
        <div className="ohn-rows" style={{ marginTop: 12 }}>
          {(workspace?.audit ?? []).map((row) => (
            <div className="ohn-row" key={`${row.at}-${row.action}-${row.target ?? ""}`}>
              <span className="ohn-row-glyph">🧾</span>
              <span className="ohn-row-main">
                <span><b>{row.action}</b> · {row.target ?? "no target"}</span>
                <span className="ohn-tagrow" style={{ marginTop: 0 }}>
                  <span className="ohn-tag">{row.token_name ?? "unknown token"}</span>
                  <span className="ohn-tag">{row.subject ?? "anonymous"}</span>
                  <span className="ohn-tag">{row.at ? new Date(row.at).toLocaleString() : "unknown time"}</span>
                </span>
              </span>
            </div>
          ))}
          {workspace && !workspace.audit.length && (
            <div className="ohn-row"><span className="ohn-row-glyph">□</span><span className="ohn-row-main">No audit rows for this workspace yet.</span></div>
          )}
          {!workspace && (
            <div className="ohn-row"><span className="ohn-row-glyph">🧾</span><span className="ohn-row-main">Audit appears after a successful connection.</span></div>
          )}
        </div>
      )}

      {tab === "Permissions" && (
        <div className="ohn-grid" style={{ marginTop: 12 }}>
          <div className="ohn-col">
            <section className="ohn-box">
              <h4 className="ohn-box-title">Permission summary</h4>
              <InfoLine label="Harnesses" value={String(workspace?.permissions.totalHarnesses ?? 0)} />
              <InfoLine
                label="Risk tiers"
                value={workspace
                  ? `LOW ${workspace.permissions.riskTiers.LOW} · MED ${workspace.permissions.riskTiers.MEDIUM} · HIGH ${workspace.permissions.riskTiers.HIGH} · CRIT ${workspace.permissions.riskTiers.CRITICAL}`
                  : "not loaded"}
              />
              <InfoLine label="External send" value={String(workspace?.permissions.permissionCounts.externalSend ?? 0)} />
              <InfoLine label="Credentials" value={String(workspace?.permissions.permissionCounts.credentials ?? 0)} />
              <InfoLine label="Money movement" value={String(workspace?.permissions.permissionCounts.moneyMovement ?? 0)} />
              <InfoLine
                label="Shell / browser"
                value={`${workspace?.permissions.permissionCounts.shell ?? 0} / ${workspace?.permissions.permissionCounts.browser ?? 0}`}
              />
            </section>
          </div>
          <aside className="ohn-aside">
            <section className="ohn-box">
              <h4 className="ohn-box-title">Highest risk report</h4>
              <pre className="ohn-pre">{workspace?.permissions.riskMarkdown ?? "# Harness Risk\n\nNot loaded."}</pre>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
