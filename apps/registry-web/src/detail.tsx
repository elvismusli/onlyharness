import { cleanReadme, fmtContextCost, fmtK, heatPct, relativeTime } from "./format";
import { DETAIL_TABS, type CompatibilityTarget, type DetailTab, type HarnessDetail, type RegistryItem, type ThreadItem } from "./types";
import { Btn, HeatMeter, InfoLine, TabStrip } from "./win98";

const THREAD_KINDS = ["question", "recipe", "result", "proposal", "bug/risk"];

export function DetailBody({ item, detail, tab, setTab, starred, forked, thread, draft, setDraft, kind, setKind, onPost, tryState, onRunSample, onStar, onFork, onCopyCli, onInstall, onShare, copied }: {
  item: RegistryItem;
  detail?: HarnessDetail;
  tab: DetailTab;
  setTab: (tab: DetailTab) => void;
  starred: boolean;
  forked: boolean;
  thread: ThreadItem[];
  draft: string;
  setDraft: (value: string) => void;
  kind: string;
  setKind: (value: string) => void;
  onPost: () => void;
  tryState: "idle" | "running" | "done";
  onRunSample: () => void;
  onStar: () => void;
  onFork: () => void;
  onCopyCli: () => void;
  onInstall: () => void;
  onShare: () => void;
  copied: boolean;
}) {
  const manifest = detail?.manifest;
  const stars = item.stars + (starred ? 1 : 0);
  const heat = item.heat + (starred ? 0.4 : 0);
  const permissions = manifest?.permissions ?? {};
  const grantedPermissions = Object.entries(permissions)
    .filter(([, value]) => value === true)
    .map(([key]) => key.replaceAll("_", " "));
  const targets = compatibilityTargets(item, detail);
  const version = manifest?.version ?? "current";
  const installConfirms = detail?.social?.installConfirms ?? item.installConfirms ?? 0;
  const isDirectory = item.contentType === "directory" || manifest?.content?.type === "directory";
  const directory = item.directory ?? manifestDirectory(manifest);
  const directoryUrl = directory?.url ?? item.forgeUrl;
  const installLoop = isDirectory
    ? [
        `open ${directoryUrl}`,
        "# Link-only directory: inspect upstream source and license before importing content.",
        "# Do not treat this as a runnable harness."
      ].join("\n")
    : [
        `npx onlyharness install ${item.owner}/${item.name}`,
        `npx onlyharness run ${item.name} --json`,
        `npx onlyharness eval ${item.name} --json`,
        `npx onlyharness gate --dir ${item.name} --json`
      ].join("\n");

  return (
    <div className="win-body">
      <div className="detail-head">
        <div className="owner-line">{item.ownerLabel}/{item.name} · updated {relativeTime(item.updatedAt)}</div>
        <h2>{item.title}</h2>
        <div className="promise">{item.summary}</div>
        <div className="tagrow">
          {item.tags.map((tag) => <span key={tag} className="tag98">#{tag.replace(/^#/, "")}</span>)}
          {(detail?.standard ?? item.standard) === "conformant" && <span className="tag98 safe">✓ OnlyHarness Standard</span>}
          {isDirectory && <span className="tag98 warn">link-only directory</span>}
          {isDirectory && directory?.itemCount !== undefined && <span className="tag98">{directory.itemCount} items</span>}
          {installConfirms > 0 && <span className="tag98 safe">Claude Code: {installConfirms} confirms</span>}
          {item.badge.includes("Wild") && <span className="tag98 warn">🏆 {item.badge}</span>}
        </div>
      </div>

      <div className="detail-grid">
        <section>
          <TabStrip tabs={DETAIL_TABS} active={tab} onSelect={setTab} />
          <div className="tabpanel">
            {tab === "Overview" && (
              <div>
                <h4>What it does</h4>
                <p style={{ margin: "0 0 10px", fontSize: 12.5 }}>{cleanReadme(detail?.readme) || item.summary}</p>
                {isDirectory && (
                  <div className="plate" style={{ marginBottom: 10, fontSize: 12 }}>
                    Link-only directory. Open upstream, inspect current source state, and review licensing before importing or installing anything.
                    {directory?.notes ? <><br />Notes: {directory.notes}</> : null}
                  </div>
                )}
                <h4>Workflow</h4>
                <div className="workflow-steps">
                  {(manifest?.workflow.stages ?? []).map((stage, index) => (
                    <div className="workflow-step" key={`${stage.id}-${index}`}>
                      <span className="n">{index + 1}</span>
                      <span>{stage.id.replaceAll("_", " ")}</span>
                      <em>{stage.agent}</em>
                    </div>
                  ))}
                  {!manifest && <div className="plate">Loading manifest...</div>}
                </div>
                <h4 style={{ marginTop: 10 }}>Works best for</h4>
                <div className="tagrow" style={{ margin: 0 }}>
                  <span className="tag98">{item.outcome}</span>
                  {item.tags.slice(0, 4).map((tag) => <span key={tag} className="tag98">#{tag.replace(/^#/, "")}</span>)}
                </div>
              </div>
            )}

            {tab === "Install" && (
              <div>
                <h4>{isDirectory ? "Directory link" : "Install loop"}</h4>
                <pre className="pre98">{installLoop}</pre>
                <div className="tagrow" style={{ marginTop: 8 }}>
                  {targets.map((target) => (
                    <span key={target.name} className={`tag98 ${target.status === "verified" || target.status === "available" ? "safe" : "warn"}`}>
                      {target.name}: {target.status}
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  <Btn strong onClick={onInstall}>{isDirectory ? "🌐 Open directory" : "💿 Open Install Center"}</Btn>
                  <Btn strong onClick={onCopyCli}>{copied ? "✓ Copied" : isDirectory ? "📋 Copy link" : ">_ Copy CLI"}</Btn>
                </div>
                <div className="plate" style={{ marginTop: 8, fontSize: 11 }}>
                  {isDirectory ? "Directory entries are discovery indexes, not runnable harnesses." : "Adapter targets generate local instruction files. Use eval and gate before real work."}
                </div>
              </div>
            )}

            {tab === "Trust" && (
              <div className="trust-questions">
                <div className="trust-box">
                  <h4>1. Safe enough to inspect?</h4>
                  <InfoLine label="Security scan" value={detail?.security ? `${detail.security.verdict} · ${detail.security.findings.length} findings` : `${item.security.verdict} · ${item.security.findings} findings`} />
                  <InfoLine label="Risk" value={`${detail?.risk.tier ?? item.riskTier} (${detail?.risk.score ?? item.riskScore})`} />
                  <InfoLine label="Permissions" value={grantedPermissions.length ? grantedPermissions.join(", ") : "conservative"} />
                  {detail?.risk.blocking?.length ? <p className="trust-note">{detail.risk.blocking[0]}</p> : null}
                </div>
                <div className="trust-box">
                  <h4>2. Works in my setup?</h4>
                  <InfoLine label={isDirectory ? "Content type" : "Runtime"} value={isDirectory ? "link-only directory" : manifest?.runtime.primary ?? item.runtime} />
                  <InfoLine label="Adapters" value={manifest?.runtime.adapters?.length ? manifest.runtime.adapters.join(", ") : "none declared"} />
                  <InfoLine label="Claude Code confirms" value={installConfirms ? `${installConfirms} real install${installConfirms === 1 ? "" : "s"}` : "no confirms yet"} />
                  <InfoLine label="Context" value={fmtContextCost(detail?.contextCost ?? item.contextCost)} />
                  <div className="tagrow" style={{ marginTop: 6 }}>
                    {targets.map((target) => <span key={target.name} className={`tag98 ${target.status === "planned" ? "warn" : "safe"}`}>{target.name}: {target.status}</span>)}
                  </div>
                </div>
                <div className="trust-box">
                  <h4>3. Better than alternatives?</h4>
                  <InfoLine label="Eval" value={detail?.evalResult ? `${detail.evalResult.score} (${detail.evalResult.status})` : item.evalStatus} />
                  <InfoLine label="Gate" value={manifest ? `score >= ${manifest.quality_gates.min_score}` : "not loaded"} />
                  <InfoLine label="Last verified" value={lastVerifiedLabel(detail)} />
                  {(detail?.evalResult?.cases ?? []).slice(0, 4).map((entry) => (
                    <div className={`eval-row ${entry.passed ? "pass" : "fail"}`} key={entry.id}>
                      <span>{entry.passed ? "✓" : "✗"}</span>
                      <strong>{entry.title}</strong>
                      <span className="score">{entry.score.toFixed(2)}</span>
                    </div>
                  ))}
                  {detail && !detail.evalResult?.cases?.length && <div className="plate">No recorded eval cases for this harness yet.</div>}
                </div>
              </div>
            )}

            {tab === "Try sample" && (
              <div className="try-grid">
                <div>
                  <h4>Example input</h4>
                  <pre className="pre98">{detail ? detail.example?.input || "This harness ships without an example input." : "Loading example..."}</pre>
                </div>
                <div>
                  <h4>Expected output</h4>
                  <pre className="pre98">{detail ? detail.example?.expected || "This harness ships without an expected output." : "Loading expected output..."}</pre>
                </div>
                <div className="try-run">
                  <Btn strong onClick={onRunSample} disabled={tryState === "running" || isDirectory}>{isDirectory ? "Link-only" : "▶ Preview sample"}</Btn>
                  {tryState === "running" && <span className="run-status" style={{ color: "var(--navy)" }}>⌛ Opening bundled sample...</span>}
                  {tryState === "done" && <span className="run-status">Sample preview opened. Run the CLI eval before trusting it.</span>}
                  <span style={{ fontSize: 11, color: "#404040", flexBasis: "100%" }}>
                    {isDirectory ? "Directory entries do not run samples. Open upstream and inspect current source state." : "Shows the bundled example only. No LLM, credentials or eval gate run in this browser."}
                  </span>
                </div>
              </div>
            )}

            {tab === "Thread" && (
              <div>
                <div className="composer">
                  <select className="select98" value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Post kind">
                    {THREAD_KINDS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                  </select>
                  <label className="field98">
                    <input
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) onPost(); }}
                      placeholder="Share a recipe, question or run result..."
                    />
                  </label>
                  <Btn strong onClick={onPost}>Post</Btn>
                </div>
                <div className="thread-list">
                  {thread.map((post) => (
                    <article className="post98" key={post.id}>
                      <div className="post-head">
                        <strong>{post.author}</strong>
                        <span className={`kind-chip ${post.role === "maintainer" ? "pin" : ""}`}>
                          {post.role === "maintainer" ? "📌 " : ""}{post.kind}
                        </span>
                        <span className="post-meta">{post.role} · {post.at}</span>
                      </div>
                      <p>{post.body}</p>
                      <small>👍 {post.likes}</small>
                    </article>
                  ))}
                  {thread.length === 0 && (
                    <div className="empty-state">
                      <span className="tumbleweed">🌵</span>
                      Nobody has posted yet. Break the silence, partner.
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === "Files" && (
              <div>
                <div className="file-list">
                  {(detail?.files ?? []).map((file) => (
                    <div className="file-row" key={file}>
                      <span>{file.endsWith(".yaml") || file.endsWith(".yml") ? "⚙️" : file.endsWith(".md") ? "📄" : "🗒️"}</span>
                      <span>{file}</span>
                    </div>
                  ))}
                  {!detail?.files?.length && <div className="file-row"><span>⌛</span><span>Loading file list...</span></div>}
                </div>
                <div style={{ marginTop: 8 }}>
                  <a href={detail?.forgeUrl ?? item.forgeUrl} target="_blank" rel="noreferrer" style={{ color: "var(--navy)" }}>
                    Open repository ↗
                  </a>
                </div>
              </div>
            )}

            {tab === "Versions" && (
              <div>
                <h4>Current version</h4>
                <div className="file-list">
                  <div className="file-row">
                    <span className="tag98 safe">{version}</span>
                    <span>{detail ? "Current manifest/archive version" : "Loading version..."}</span>
                  </div>
                </div>
                <div className="plate" style={{ marginTop: 8 }}>
                  Immutable archive snapshots are served with <code>?version=</code>. Full version history UI is not populated until more publish events exist.
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="trust-panel">
          <div className="trust-stats">
            <div className="trust-stat"><span className="num">★ {fmtK(stars)}</span><span className="cap">stars</span></div>
            <div className="trust-stat"><span className="num">⑂ {fmtK(item.forks + (forked ? 1 : 0))}</span><span className="cap">forks</span></div>
            <div className="trust-stat"><span className="num">💬 {item.threads}</span><span className="cap">threads</span></div>
            <div className="trust-stat"><span className="num">✓ {fmtK(installConfirms)}</span><span className="cap">confirms</span></div>
          </div>

          <div className="trust-box">
            <h4>🔥 Harness Heat</h4>
            <div className="heat-head">
              <span className="heat-num" style={{ fontSize: 26 }}>{heat.toFixed(1)}</span>
              <span className={`lb-delta ${item.heatDelta >= 0 ? "up" : "down"}`}>
                {item.heatDelta >= 0 ? "▲" : "▼"} {Math.abs(item.heatDelta).toFixed(1)} this week
              </span>
            </div>
            <HeatMeter heat={heat} pct={heatPct(heat)} />
            <div style={{ fontSize: 11, marginTop: 4, color: "#404040" }}>Status: {item.freshness}</div>
            <div style={{ fontSize: 11, marginTop: 4, color: "#404040" }}>Community signals are not safety guarantees.</div>
          </div>

          <div className="trust-box">
            <h4>Trust &amp; safety</h4>
            <InfoLine label="Eval" value={detail?.evalResult ? `${detail.evalResult.score} (${detail.evalResult.status})` : item.evalStatus} />
            <InfoLine label="Risk" value={`${detail?.risk.tier ?? item.riskTier} (${detail?.risk.score ?? item.riskScore})`} />
            <InfoLine label={isDirectory ? "Content type" : "Runtime"} value={isDirectory ? "link-only directory" : manifest?.runtime.primary ?? item.runtime} />
            <InfoLine label="Context" value={fmtContextCost(detail?.contextCost ?? item.contextCost)} />
            <InfoLine label="Eval gate" value={manifest ? `score ≥ ${manifest.quality_gates.min_score}` : "…"} />
            <InfoLine label="Permissions" value={grantedPermissions.length ? grantedPermissions.join(", ") : "conservative"} />
            {detail?.risk.reasons?.[0] && (
              <p style={{ fontSize: 11, color: "#404040", margin: "6px 0 0" }}>{detail.risk.reasons[0]}</p>
            )}
          </div>

          <div className="trust-actions">
            <Btn strong onClick={onInstall}>{isDirectory ? "🌐 Open directory" : "💿 Install"}</Btn>
            <Btn strong onClick={onCopyCli}>{copied ? "✓ Copied" : isDirectory ? "📋 Copy link" : ">_ Copy CLI"}</Btn>
            <Btn pressed={starred} onClick={onStar}>★ {starred ? "Starred" : "Star"}</Btn>
            <Btn pressed={forked} onClick={onFork}>⑂ {forked ? "Forked" : "Fork"}</Btn>
            <Btn onClick={onShare}>💾 Share card</Btn>
          </div>
        </aside>
      </div>

      <div className="win-statusbar">
        <span className="status-plate" style={{ flex: 1 }}>{item.cliCommand}</span>
        <span className="status-plate">eval {item.evalScore ? item.evalScore.toFixed(2) : "—"} · risk {item.riskTier}</span>
      </div>
    </div>
  );
}

function compatibilityTargets(item: RegistryItem, detail?: HarnessDetail): CompatibilityTarget[] {
  if (item.contentType === "directory" || detail?.manifest?.content?.type === "directory") {
    return [
      { name: "Open link", status: "available", notes: item.directory?.url ?? detail?.manifest?.content?.directory?.url },
      { name: "License review", status: "planned", notes: "Required before vendoring upstream content" },
      { name: "Harness import", status: "planned", notes: "Convert selected entries only after source review" }
    ];
  }
  const declared = detail?.manifest?.compatibility?.targets ?? [];
  if (declared.length) return declared;
  return [
    { name: "CLI", status: "available", notes: item.cliCommand },
    { name: "HTTP archive", status: "available" },
    { name: "MCP pull_harness", status: "available" },
    { name: "Claude Code adapter", status: "available", notes: "hh adapt --target claude-code" },
    { name: "Codex adapter", status: "available", notes: "hh adapt --target codex" },
    { name: "Cursor adapter", status: "available", notes: "hh adapt --target cursor" },
    { name: "Team bundle", status: "available", notes: "hh setup @org" }
  ];
}

function manifestDirectory(manifest: HarnessDetail["manifest"] | undefined): RegistryItem["directory"] | undefined {
  const directory = manifest?.content?.directory;
  if (!directory) return undefined;
  return {
    ...(directory.url ? { url: directory.url } : {}),
    ...(directory.item_count !== undefined ? { itemCount: directory.item_count } : {}),
    ...(directory.category ? { category: directory.category } : {}),
    ...(directory.notes ? { notes: directory.notes } : {})
  };
}

function lastVerifiedLabel(detail?: HarnessDetail): string {
  if (!detail?.verification?.lastVerifiedAt) return "not recorded";
  return relativeTime(detail.verification.lastVerifiedAt);
}
