import { fmtK, heatPct, isoWeek } from "./format";
import type { HarnessDetail, RegistryItem } from "./types";
import { Btn, HeatMeter, InfoLine } from "./win98";

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

/* ---------- MS-DOS Prompt (CLI) ---------- */

export function CliBody({ item, onCopy, copied }: { item?: RegistryItem; onCopy: (text: string) => void; copied: boolean }) {
  const pull = item?.cliCommand ?? "hh pull harnesses/deep-market-researcher";
  const commands = `${pull}\nhh run --input examples/input.md\nhh eval && hh gate\nhh publish`;
  return (
    <div className="win-body">
      <div className="term">
        <span className="dim">OnlyHarness CLI [Version 0.98]{"\n"}(C) Season 4 — Wild West. Fork responsibly.{"\n\n"}</span>
        C:\hub&gt; {pull}{"\n"}
        C:\hub&gt; hh run --input examples/input.md{"\n"}
        C:\hub&gt; hh eval &amp;&amp; hh gate{"\n"}
        C:\hub&gt; hh publish{"\n\n"}
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
        Semantic review of the open pull request for <b>{item?.title ?? "…"}</b>.
        This view is for maintainers: it reports permission and workflow changes before anything merges.
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

export function ShareBody({ item, starred, onCopy, copied }: { item: RegistryItem; starred: boolean; onCopy: (text: string) => void; copied: boolean }) {
  const stars = item.stars + (starred ? 1 : 0);
  const heat = item.heat + (starred ? 0.4 : 0);
  const brag = `★ LOOK AT MY HARNESS ★\n${item.title} — ${item.summary}\n★ ${fmtK(stars)} · ⑂ ${fmtK(item.forks)} · 💬 ${item.threads} · eval ${item.evalScore ? item.evalScore.toFixed(2) : "—"} · Heat ${heat.toFixed(1)}🔥\n> ${item.cliCommand}`;
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
                <div className="share-banner">★ LOOK AT MY HARNESS ★</div>
                <div className="share-title-box">
                  <div className="wordart">{item.title}</div>
                </div>
                <div className="share-promise">{item.summary}</div>
                <div className="share-tags">
                  {item.tags.slice(0, 2).map((tag) => <span key={tag} className="tag98">#{tag.replace(/^#/, "")}</span>)}
                  {item.riskTier === "LOW" && <span className="tag98 safe">✓ safety reviewed</span>}
                </div>
                <div style={{ flex: 1 }} />
                <div className="share-stats">
                  <div className="share-stat"><div className="num">★ {fmtK(stars)}</div><div className="cap">stars</div></div>
                  <div className="share-stat"><div className="num">⑂ {fmtK(item.forks)}</div><div className="cap">forks</div></div>
                  <div className="share-stat"><div className="num">💬 {item.threads}</div><div className="cap">threads</div></div>
                  <div className="share-stat"><div className="num ok">{item.evalScore ? item.evalScore.toFixed(2) : "—"}</div><div className="cap">eval</div></div>
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
                  <span>{item.badge.includes("Wild") ? <>Best Harness in the<br />Wild West · Wk {isoWeek(new Date())} 🤠</> : <>Certified frontier<br />harness 🤠</>}</span>
                </div>
              </div>
            </div>
            <div className="share-footer">
              <span>&gt; {item.cliCommand}</span>
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
