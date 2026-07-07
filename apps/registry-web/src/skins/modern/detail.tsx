import type { ReactNode } from "react";

import { compatibilityTargetsFor, targetLabel, targetTone } from "../../core/compat";
import { cleanReadme, fmtContextCost, fmtK, keyFor, relativeTime } from "../../core/format";
import { useHarness } from "../../core/store";
import { DETAIL_TABS, type DetailTab, type HarnessDetail, type RegistryItem, type ThreadItem } from "../../core/types";
import type { Surface } from "../../core/useAppNav";
import { Btn, HeatBar, IconTile, Tag } from "./primitives";

/* Same post kinds the Win98 composer offers, so both skins drive the shared
   `kinds`/`addThreadPost` state identically. */
const THREAD_KINDS = ["question", "recipe", "result", "proposal", "bug/risk"];
const LOCAL_HH = "node packages/harness-cli/dist/hh.mjs";

/* Modern heat percentage matches the Explore card divisor (heat/24) rather than
   the Win98 meter's /30, so the detail meter and the card agree. */
function heatPctModern(heat: number): number {
  return Math.min(100, Math.round((heat / 24) * 100));
}

/** One label/value line in a Modern trust box (mono value, hairline rows). */
function InfoLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="ohd-info">
      <span className="ohd-info-k">{label}</span>
      <span className="ohd-info-v">{value}</span>
    </div>
  );
}

/** A titled trust/section box (surface fill, hairline, display heading). */
function Box({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="ohd-box">
      <h4 className="ohd-box-title">{title}</h4>
      {children}
    </section>
  );
}

/** Deterministic emoji + tint per harness, mirroring the Explore card icon. */
const ICON_PALETTE: Array<{ emoji: string; bg: string }> = [
  { emoji: "🔬", bg: "rgba(255,107,53,.14)" },
  { emoji: "🛡️", bg: "rgba(74,222,128,.12)" },
  { emoji: "📮", bg: "rgba(96,165,250,.13)" },
  { emoji: "🧩", bg: "rgba(167,139,250,.14)" },
  { emoji: "🚀", bg: "rgba(251,191,36,.14)" },
  { emoji: "🕹️", bg: "rgba(45,212,191,.13)" },
  { emoji: "📊", bg: "rgba(255,138,92,.13)" },
  { emoji: "⚙️", bg: "rgba(148,163,184,.14)" }
];

function iconFor(item: RegistryItem): { emoji: string; bg: string } {
  const key = keyFor(item);
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return ICON_PALETTE[hash % ICON_PALETTE.length];
}

function fileIcon(file: string): string {
  if (file.endsWith(".yaml") || file.endsWith(".yml")) return "⚙️";
  if (file.endsWith(".md")) return "📄";
  if (file.endsWith(".json")) return "🧾";
  if (file.endsWith(".ts") || file.endsWith(".js") || file.endsWith(".mjs")) return "📜";
  return "🗒️";
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

function versionPullCommand(item: RegistryItem, version: string): string {
  const out = `${item.name}-${version.replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
  return `${LOCAL_HH} pull ${item.owner}/${item.name} --version ${version} --out ${out}`;
}

/**
 * Modern harness detail — a two-column route rendered for a `harness` surface.
 * Left = the seven `DETAIL_TABS` as a hairline pill row over a tab panel; right =
 * a sticky trust panel (stats, honest Harness-Heat meter, InfoLines, actions).
 * Shows the *same* data as the Win98 `DetailBody`, field-for-field, restyled onto
 * the Modern token system. Every empty/unqualified state is honest — no
 * fabricated heat/eval — and directory ("link-only") harnesses drop Try/Install
 * loops for an open-upstream path.
 */
export function ModernDetail({ surface }: { surface: Surface }) {
  const h = useHarness();
  const item = surface.key ? h.knownItems[surface.key] : undefined;

  if (!item) {
    return (
      <main className="oh-main ohd">
        <div className="oh-empty">This harness rode off into the sunset. Head back to Explore.</div>
        <div style={{ marginTop: 16 }}>
          <Btn variant="secondary" onClick={() => h.closeSurface(surface.id)}>← Back to Explore</Btn>
        </div>
      </main>
    );
  }

  const key = keyFor(item);
  const detail = h.details[key];
  const tab = surface.tab ?? "Overview";
  const setTab = (next: DetailTab) => h.setTab(surface.id, next);

  const starred = Boolean(h.starred[key]);
  const remixed = Boolean(h.remixed[key]);
  const thread = h.threadFor(item, detail);
  const draft = h.drafts[key] ?? "";
  const kind = h.kinds[key] ?? "question";
  const tryState = h.tryStates[key] ?? "idle";
  const cliCopied = h.copiedTag === `cli:${key}`;

  const manifest = detail?.manifest;
  const stars = item.stars + (starred ? 1 : 0);
  const heatQualified = detail?.social?.heatQualified ?? item.heatQualified;
  const heat = item.heat + (heatQualified && starred ? 0.4 : 0);
  const visibleHeat = heatQualified ? heat : 0;
  const permissions = manifest?.permissions ?? {};
  const grantedPermissions = Object.entries(permissions)
    .filter(([, value]) => value === true)
    .map(([permKey]) => permKey.replaceAll("_", " "));
  const targets = compatibilityTargetsFor(item, detail);
  const version = manifest?.version ?? "current";
  const versionHistory = detail?.versions?.length
    ? detail.versions
    : [{ version, createdAt: item.updatedAt, snapshot: false, current: true, fileCount: detail?.files?.length ?? 0 }];
  const installConfirms = detail?.social?.installConfirms ?? item.installConfirms ?? 0;
  const isDirectory = item.contentType === "directory" || manifest?.content?.type === "directory";
  const directory = item.directory ?? manifestDirectory(manifest);
  const directoryUrl = directory?.url ?? item.forgeUrl;
  const sourceUrl = detail?.forgeUrl ?? item.forgeUrl;
  const icon = iconFor(item);

  const installLoop = isDirectory
    ? [
        `open ${directoryUrl ?? "<upstream-url>"}`,
        "# Link-only directory: inspect upstream source and license before importing content.",
        "# Do not treat this as a runnable harness."
      ].join("\n")
    : [
        "# npm package pending; build the local CLI first:",
        "npm run build -w onlyharness",
        `${LOCAL_HH} install ${item.owner}/${item.name}`,
        `${LOCAL_HH} run ${item.name} --json`,
        `${LOCAL_HH} eval ${item.name} --json`,
        `${LOCAL_HH} gate --dir ${item.name} --json`
      ].join("\n");

  function copyCli() {
    h.recordHarnessEvent("copy", item!, "cli");
    void h.copyText(item!.cliCommand, `Copied: ${item!.cliCommand}`, `cli:${key}`);
  }

  const loadingManifest = !detail;

  return (
    <main className="oh-main ohd">
      <button type="button" className="ohd-back" onClick={() => h.closeSurface(surface.id)}>
        ← Explore
      </button>

      {/* ---- header ---- */}
      <header className="ohd-head">
        <IconTile emoji={isDirectory ? "🗂️" : icon.emoji} bg={isDirectory ? "rgba(255,138,92,.13)" : icon.bg} size={52} />
        <div className="ohd-head-main">
          <div className="ohd-owner">
            {item.ownerLabel || item.owner} / <span className="ohd-owner-name">{item.name}</span>
            <span className="ohd-dot" aria-hidden>·</span>
            updated {relativeTime(item.updatedAt)}
          </div>
          <h1 className="ohd-title">{item.title}</h1>
          <p className="ohd-summary">{item.summary}</p>
          <div className="ohd-tags">
            {item.tags.map((t) => <Tag key={t}>#{t.replace(/^#/, "")}</Tag>)}
            {(detail?.standard ?? item.standard) === "conformant" && (
              <span className="oh-safe-badge">✓ OnlyHarness Standard</span>
            )}
            {isDirectory && <span className="oh-tag oh-tag-warn">link-only directory</span>}
            {isDirectory && directory?.itemCount !== undefined && <Tag>{directory.itemCount} items</Tag>}
            {installConfirms > 0 && <span className="oh-safe-badge">Claude Code: {installConfirms} confirms</span>}
            {item.badge.includes("Wild") && <span className="oh-tag oh-tag-warn">🏆 {item.badge}</span>}
          </div>
        </div>
      </header>

      <div className="ohd-grid">
        {/* ================= LEFT: tabbed content ================= */}
        <section className="ohd-left">
          <div className="ohd-tabs" role="tablist">
            {DETAIL_TABS.map((entry) => (
              <button
                key={entry}
                role="tab"
                aria-selected={entry === tab}
                className="ohd-tab"
                data-active={entry === tab ? "" : undefined}
                onClick={() => setTab(entry)}
              >
                {entry}
              </button>
            ))}
          </div>

          <div className="ohd-panel">
            {tab === "Overview" && (
              <div>
                <h4 className="ohd-h">What it does</h4>
                <p className="ohd-prose">{cleanReadme(detail?.readme) || item.summary}</p>
                {isDirectory && (
                  <div className="ohd-note">
                    Link-only directory. Open upstream, inspect current source state, and review licensing before
                    importing or installing anything.
                    {directory?.notes ? <><br />Notes: {directory.notes}</> : null}
                  </div>
                )}
                <h4 className="ohd-h">Workflow</h4>
                <ol className="ohd-workflow">
                  {(manifest?.workflow.stages ?? []).map((stage, index) => (
                    <li className="ohd-wf" key={`${stage.id}-${index}`}>
                      <span className="ohd-wf-n">{index + 1}</span>
                      <span className="ohd-wf-label">{stage.id.replaceAll("_", " ")}</span>
                      <span className="ohd-wf-agent">{stage.agent}</span>
                    </li>
                  ))}
                  {!manifest && <li className="ohd-note">{loadingManifest ? "Loading manifest…" : "No workflow stages declared."}</li>}
                </ol>
                <h4 className="ohd-h">Works best for</h4>
                <div className="ohd-tags ohd-tags-flat">
                  <Tag>{item.job || item.outcome}</Tag>
                  {item.tags.slice(0, 4).map((t) => <Tag key={t}>#{t.replace(/^#/, "")}</Tag>)}
                </div>
              </div>
            )}

            {tab === "Install" && (
              <div>
                <h4 className="ohd-h">{isDirectory ? "Directory link" : "Install loop"}</h4>
                <pre className="ohd-pre">{installLoop}</pre>
                <div className="ohd-tags ohd-tags-flat" style={{ marginTop: 12 }}>
                  {targets.map((target) => (
                    <span key={targetLabel(target)} className={targetTone(target) === "warn" ? "oh-tag oh-tag-warn" : "oh-safe-badge"}>
                      {targetLabel(target)}: {target.status}
                    </span>
                  ))}
                </div>
                <div className="ohd-btnrow">
                  <Btn variant="primary" onClick={() => h.openInstall(item)}>
                    {isDirectory ? "🌐 Open directory" : "💿 Open Install Center"}
                  </Btn>
                  <Btn variant="mono" prefix={cliCopied ? "✓" : ">"} onClick={copyCli}>
                    {cliCopied ? "Copied" : isDirectory ? "Copy link" : "Copy CLI"}
                  </Btn>
                </div>
                <p className="ohd-fine">
                  {isDirectory
                    ? "Directory entries are discovery indexes, not runnable harnesses."
                    : "Adapter targets generate local instruction files. Use eval and gate before real work."}
                </p>
              </div>
            )}

            {tab === "Trust" && (
              <div className="ohd-trust">
                <Box title="1. Safe enough to inspect?">
                  <InfoLine
                    label="Security scan"
                    value={detail?.security
                      ? `${detail.security.verdict} · ${detail.security.findings.length} findings`
                      : `${item.security.verdict} · ${item.security.findings} findings`}
                  />
                  <InfoLine label="Risk" value={`${detail?.risk.tier ?? item.riskTier} (${detail?.risk.score ?? item.riskScore})`} />
                  <InfoLine label="Permissions" value={grantedPermissions.length ? grantedPermissions.join(", ") : "conservative"} />
                  {detail?.risk.blocking?.length ? <p className="ohd-fine ohd-warn">{detail.risk.blocking[0]}</p> : null}
                </Box>
                <Box title="2. Works in my setup?">
                  <InfoLine label={isDirectory ? "Content type" : "Runtime"} value={isDirectory ? "link-only directory" : manifest?.runtime.primary ?? item.runtime} />
                  <InfoLine label="Adapters" value={manifest?.runtime.adapters?.length ? manifest.runtime.adapters.join(", ") : "none declared"} />
                  <InfoLine label="Claude Code confirms" value={installConfirms ? `${installConfirms} real install${installConfirms === 1 ? "" : "s"}` : "no confirms yet"} />
                  <InfoLine label="Context" value={fmtContextCost(detail?.contextCost ?? item.contextCost)} />
                  <div className="ohd-tags ohd-tags-flat" style={{ marginTop: 10 }}>
                    {targets.map((target) => (
                      <span key={targetLabel(target)} className={targetTone(target) === "warn" ? "oh-tag oh-tag-warn" : "oh-safe-badge"}>
                        {targetLabel(target)}: {target.status}
                      </span>
                    ))}
                  </div>
                </Box>
                <Box title="3. Better than alternatives?">
                  <InfoLine label="Eval" value={detail?.evalResult ? `${detail.evalResult.score} (${detail.evalResult.status})` : item.evalStatus} />
                  <InfoLine label="Gate" value={manifest ? `score ≥ ${manifest.quality_gates.min_score}` : "not loaded"} />
                  <InfoLine label="Last verified" value={lastVerifiedLabel(detail)} />
                  <div className="ohd-evals">
                    {(detail?.evalResult?.cases ?? []).slice(0, 4).map((entry) => (
                      <div className={`ohd-eval ${entry.passed ? "pass" : "fail"}`} key={entry.id}>
                        <span className="ohd-eval-mark">{entry.passed ? "✓" : "✗"}</span>
                        <span className="ohd-eval-title">{entry.title}</span>
                        <span className="ohd-eval-score">{entry.score.toFixed(2)}</span>
                      </div>
                    ))}
                    {detail && !detail.evalResult?.cases?.length && (
                      <div className="ohd-note">No recorded eval cases for this harness yet.</div>
                    )}
                    {!detail && <div className="ohd-note">Loading eval cases…</div>}
                  </div>
                </Box>
              </div>
            )}

            {tab === "Try sample" && (
              <div className="ohd-try">
                <div className="ohd-try-pane">
                  <h4 className="ohd-h">Example input</h4>
                  <pre className="ohd-pre">{detail ? detail.example?.input || "This harness ships without an example input." : "Loading example…"}</pre>
                </div>
                <div className="ohd-try-pane">
                  <h4 className="ohd-h">Expected output</h4>
                  <pre className="ohd-pre">{detail ? detail.example?.expected || "This harness ships without an expected output." : "Loading expected output…"}</pre>
                </div>
                <div className="ohd-try-run">
                  <Btn variant="primary" onClick={() => h.runSample(item)} disabled={tryState === "running" || isDirectory}>
                    {isDirectory ? "Link-only" : "▶ Preview sample"}
                  </Btn>
                  {tryState === "running" && <span className="ohd-run-status">⌛ Opening bundled sample…</span>}
                  {tryState === "done" && <span className="ohd-run-status ohd-ok">Sample preview opened. Run the CLI eval before trusting it.</span>}
                  <span className="ohd-fine ohd-fine-block">
                    {isDirectory
                      ? "Directory entries do not run samples. Open upstream and inspect current source state."
                      : "Shows the bundled example only. No LLM, credentials or eval gate run in this browser."}
                  </span>
                </div>
              </div>
            )}

            {tab === "Thread" && (
              <div>
                <div className="ohd-composer">
                  <select
                    className="ohd-select"
                    value={kind}
                    onChange={(event) => h.setKind(key, event.target.value)}
                    aria-label="Post kind"
                  >
                    {THREAD_KINDS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                  </select>
                  <input
                    className="ohd-input"
                    value={draft}
                    onChange={(event) => h.setDraft(key, event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) h.addThreadPost(item); }}
                    placeholder="Share a recipe, question or run result…"
                  />
                  <Btn variant="primary" onClick={() => h.addThreadPost(item)}>Post</Btn>
                </div>
                <div className="ohd-thread">
                  {thread.map((post: ThreadItem) => (
                    <article className="ohd-post" key={post.id}>
                      <div className="ohd-post-head">
                        <strong className="ohd-post-author">{post.author}</strong>
                        <span className={`ohd-chip ${post.role === "maintainer" ? "pin" : ""}`}>
                          {post.role === "maintainer" ? "📌 " : ""}{post.kind}
                        </span>
                        <span className="ohd-post-meta">{post.role} · {post.at}</span>
                      </div>
                      <p className="ohd-post-body">{post.body}</p>
                      <small className="ohd-post-likes">👍 {post.likes}</small>
                    </article>
                  ))}
                  {thread.length === 0 && (
                    <div className="ohd-empty-thread">
                      <span className="ohd-tumbleweed" aria-hidden>💬</span>
                      Nobody has posted yet. Break the silence, partner.
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === "Files" && (
              <div>
                <div className="ohd-files">
                  {(detail?.files ?? []).map((file) => (
                    <div className="ohd-file" key={file}>
                      <span className="ohd-file-ic" aria-hidden>{fileIcon(file)}</span>
                      <span className="ohd-file-name">{file}</span>
                    </div>
                  ))}
                  {!detail?.files?.length && (
                    <div className="ohd-file"><span className="ohd-file-ic" aria-hidden>⌛</span><span className="ohd-file-name">Loading file list…</span></div>
                  )}
                </div>
                {sourceUrl && (
                  <div style={{ marginTop: 12 }}>
                    <a href={sourceUrl} target="_blank" rel="noreferrer">Open repository ↗</a>
                  </div>
                )}
              </div>
            )}

            {tab === "Versions" && (
              <div>
                <h4 className="ohd-h">Archive versions</h4>
                <div className="ohd-versions">
                  {versionHistory.map((entry) => (
                    <div className="ohd-version" key={entry.version}>
                      <span className={`ohd-ver-tag ${entry.current ? "cur" : entry.snapshot ? "" : "warn"}`}>{entry.version}</span>
                      <div className="ohd-ver-meta">
                        <strong>{entry.current ? "Current" : "Previous"}</strong>
                        <span>{entry.snapshot ? "immutable snapshot" : "live manifest"} · {entry.fileCount} files · {relativeTime(entry.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                  {!detail && (
                    <div className="ohd-version"><span className="ohd-ver-tag">…</span><div className="ohd-ver-meta"><strong>Loading</strong><span>Fetching archive history…</span></div></div>
                  )}
                </div>
                {!isDirectory && (
                  <>
                    <h4 className="ohd-h" style={{ marginTop: 16 }}>Pull a specific version</h4>
                    <pre className="ohd-pre">{versionHistory.map((entry) => versionPullCommand(item, entry.version)).join("\n")}</pre>
                  </>
                )}
                <p className="ohd-fine">
                  {isDirectory
                    ? "Directory entries are link-only; version rows document catalog snapshots, not runnable files."
                    : "Rows marked immutable snapshot are served from stored archive files. A live current row is generated from the current manifest until publish records a snapshot."}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ================= RIGHT: sticky trust panel ================= */}
        <aside className="ohd-aside">
          <div className="ohd-panel-stats">
            <div className="ohd-pstat"><span className="ohd-pstat-n">★ {fmtK(stars)}</span><span className="ohd-pstat-c">stars</span></div>
            <div className="ohd-pstat"><span className="ohd-pstat-n">⑂ {fmtK(item.forks)}</span><span className="ohd-pstat-c">forks</span></div>
            <div className="ohd-pstat"><span className="ohd-pstat-n">💬 {item.threads}</span><span className="ohd-pstat-c">threads</span></div>
            <div className="ohd-pstat"><span className="ohd-pstat-n">✓ {fmtK(installConfirms)}</span><span className="ohd-pstat-c">confirms</span></div>
          </div>

          <Box title="🔥 Harness Heat">
            <div className="ohd-heat-head">
              <span className="ohd-heat-num">{heatQualified ? heat.toFixed(1) : "—"}</span>
              {heatQualified && (
                <span className={`ohd-heat-delta ${item.heatDelta >= 0 ? "up" : "down"}`}>
                  {item.heatDelta >= 0 ? "▲" : "▼"} {Math.abs(item.heatDelta).toFixed(1)} this week
                </span>
              )}
            </div>
            <HeatBar pct={heatQualified ? heatPctModern(visibleHeat) : 0} />
            <p className="ohd-fine" style={{ marginTop: 8 }}>
              {heatQualified ? `Status: ${item.freshness}` : "Status hidden until enough real signals arrive."}
            </p>
            <p className="ohd-fine">Community signals are not safety guarantees.</p>
          </Box>

          <Box title="Trust & safety">
            <InfoLine label="Version" value={version} />
            <InfoLine label="Last verified" value={detail?.verification?.lastVerifiedAt ?? "no passed eval/gate event yet"} />
            <InfoLine label="Source" value={isDirectory ? directoryUrl ?? "upstream URL unavailable" : sourceUrl ?? "local registry"} />
            <InfoLine label="Works with" value={targets.filter((target) => target.status !== "planned").slice(0, 4).map(targetLabel).join(", ") || "review required"} />
            <InfoLine label="Eval" value={detail?.evalResult ? `${detail.evalResult.score} (${detail.evalResult.status})` : item.evalStatus} />
            <InfoLine label="Risk" value={`${detail?.risk.tier ?? item.riskTier} (${detail?.risk.score ?? item.riskScore})`} />
            <InfoLine label={isDirectory ? "Content type" : "Runtime"} value={isDirectory ? "link-only directory" : manifest?.runtime.primary ?? item.runtime} />
            <InfoLine label="Context" value={fmtContextCost(detail?.contextCost ?? item.contextCost)} />
            <InfoLine label="Eval gate" value={manifest ? `score ≥ ${manifest.quality_gates.min_score}` : "…"} />
            <InfoLine label="Permissions" value={grantedPermissions.length ? grantedPermissions.join(", ") : "conservative"} />
            {detail?.risk.reasons?.[0] && <p className="ohd-fine" style={{ marginTop: 8 }}>{detail.risk.reasons[0]}</p>}
          </Box>

          <div className="ohd-actions">
            <Btn variant="primary" onClick={() => h.openInstall(item)}>{isDirectory ? "🌐 Open directory" : "💿 Install"}</Btn>
            <Btn variant="mono" prefix={cliCopied ? "✓" : ">"} onClick={copyCli}>{cliCopied ? "Copied" : isDirectory ? "Copy link" : "Copy CLI"}</Btn>
            <Btn variant="secondary" className={starred ? "ohd-on" : undefined} onClick={() => h.toggleStar(item)}>
              ★ {starred ? "Starred" : "Star"}
            </Btn>
            <Btn variant="secondary" className={remixed ? "ohd-on" : undefined} onClick={() => h.remixHarness(item)}>
              ⑂ {remixed ? "Recipe copied" : "Remix"}
            </Btn>
            <Btn variant="ghost" onClick={() => h.openShare(item)}>Share ↗</Btn>
          </div>

          <div className="ohd-cliline">
            <span className="ohd-cliline-cmd">{item.cliCommand}</span>
            <span className="ohd-cliline-meta">eval {item.evalScore ? item.evalScore.toFixed(2) : "—"} · risk {item.riskTier}</span>
          </div>
        </aside>
      </div>
    </main>
  );
}
