import type { ReactNode } from "react";

import { compatibilityTargetsFor, targetLabel, targetTone } from "../../core/compat";
import { cleanReadme, fmtContextCost, fmtK, keyFor, relativeTime } from "../../core/format";
import { useHarness } from "../../core/store";
import { DETAIL_TABS, type DetailTab, type HarnessDetail, type RegistryItem, type ThreadItem } from "../../core/types";
import type { Surface } from "../../core/useAppNav";
import { Avatar, Btn, Pill, Stat } from "./primitives";
import "./detail.css";

/* Same post kinds the Win98 / Modern composers offer, so all three skins drive
   the shared `kinds`/`addThreadPost` state identically. */
const THREAD_KINDS = ["question", "recipe", "result", "proposal", "bug/risk"];
const LOCAL_HH = "node packages/harness-cli/dist/hh.mjs";

/* Fans heat percentage matches Modern's Explore-card divisor (heat/24) rather
   than the Win98 meter's /30, so the profile meter and the card agree. */
function heatPctFans(heat: number): number {
  return Math.min(100, Math.round((heat / 24) * 100));
}

/** One label/value row inside a Fans "verified creator" / info card. */
function InfoLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="fans-detail-info">
      <span className="fans-detail-info-k">{label}</span>
      <span className="fans-detail-info-v">{value}</span>
    </div>
  );
}

/** A titled rounded card (soft-blue surface, friendly heading). */
function Card({ title, children, tone }: { title?: ReactNode; children: ReactNode; tone?: "verified" }) {
  return (
    <section className={["fans-detail-card", tone === "verified" ? "fans-detail-card-verified" : ""].filter(Boolean).join(" ")}>
      {title ? <h4 className="fans-detail-card-title">{title}</h4> : null}
      {children}
    </section>
  );
}

/**
 * Deterministic emoji + tint per harness, mirroring the Explore card / Modern
 * detail icon so the same harness wears the same face across skins.
 */
const ICON_PALETTE: Array<{ emoji: string; bg: string }> = [
  { emoji: "🔬", bg: "rgba(0,175,240,.14)" },
  { emoji: "🛡️", bg: "rgba(22,179,100,.12)" },
  { emoji: "📮", bg: "rgba(96,165,250,.14)" },
  { emoji: "🧩", bg: "rgba(167,139,250,.14)" },
  { emoji: "🚀", bg: "rgba(251,191,36,.16)" },
  { emoji: "🕹️", bg: "rgba(45,212,191,.14)" },
  { emoji: "📊", bg: "rgba(0,150,208,.13)" },
  { emoji: "⚙️", bg: "rgba(148,163,184,.16)" }
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

/** Playful @handle for a harness, mirroring the landing collage's mono blue tag. */
function handleFor(item: RegistryItem): string {
  return `@${item.owner}/${item.name}`.toLowerCase();
}

/**
 * Fans harness detail — the "creator profile" for a `harness` surface. Same data
 * as the Win98 `DetailBody` and Modern `ModernDetail`, field-for-field, restyled
 * onto the friendly sky-blue Fans tokens: a big round avatar header, a mono blue
 * @handle, a Subscribe pill (the honest skin for the real star action), an honest
 * stat row (🔥 heat only when qualified, green eval only when passed), the seven
 * `DETAIL_TABS` as a rounded segmented control, and a "fan wall" thread.
 *
 * Every empty/unqualified/loading state stays honest — no fabricated heat or eval
 * — and directory ("link-only") harnesses drop the Try/Install loops for an
 * open-upstream path, exactly like the other skins.
 */
export function FansDetail({ surface }: { surface: Surface }) {
  const h = useHarness();
  const item = surface.key ? h.knownItems[surface.key] : undefined;

  if (!item) {
    return (
      <div className="fa-overlay fans-detail-overlay" role="dialog" aria-label="Harness">
        <div className="fans-detail-shell fans-detail-missing">
          <p className="fans-detail-missing-body">This creator logged off. Head back to Explore. 💙</p>
          <Btn variant="outline" onClick={() => h.closeSurface(surface.id)}>← Back to Explore</Btn>
        </div>
      </div>
    );
  }

  const key = keyFor(item);
  const detail = h.details[key];
  const tab: DetailTab = surface.tab ?? "Overview";
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

  const evalPassed = detail?.evalResult?.status === "passed";
  const evalLabel = detail?.evalResult ? `${detail.evalResult.score} (${detail.evalResult.status})` : item.evalStatus;

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
    <div className="fa-overlay fans-detail-overlay" role="dialog" aria-label={item.title}>
      <main className="fans-detail-shell">
        <button type="button" className="fans-detail-back" onClick={() => h.closeSurface(surface.id)}>
          ← Explore
        </button>

        {/* ---- creator-profile header ---- */}
        <header className="fans-detail-head">
          <Avatar emoji={isDirectory ? "🗂️" : icon.emoji} bg={isDirectory ? "rgba(0,150,208,.13)" : icon.bg} size={92} />
          <div className="fans-detail-head-main">
            <h1 className="fans-detail-title">{item.title}</h1>
            <div className="fans-detail-handle">{handleFor(item)}</div>
            <p className="fans-detail-summary">{item.summary}</p>

            <div className="fans-detail-head-row">
              <button
                type="button"
                className="fans-detail-subscribe"
                data-subscribed={starred ? "" : undefined}
                aria-pressed={starred}
                onClick={() => h.toggleStar(item)}
              >
                <span className="fans-detail-subscribe-label">{starred ? "Subscribed" : "Subscribe"}</span>
                <span className="fans-detail-subscribe-price">$0/mo</span>
              </button>

              <div className="fans-detail-stats">
                <Stat>🔥 {heatQualified && visibleHeat > 0 ? visibleHeat.toFixed(1) : "—"} heat</Stat>
                <Stat>⑂ {fmtK(item.forks)} forks</Stat>
                {evalPassed && detail?.evalResult ? (
                  <Stat eval>✓ eval {detail.evalResult.score}</Stat>
                ) : (
                  <Stat>eval {evalLabel}</Stat>
                )}
              </div>
            </div>

            <div className="fans-detail-tags">
              {item.tags.map((t) => <Pill key={t} tone="soft">#{t.replace(/^#/, "")}</Pill>)}
              {(detail?.standard ?? item.standard) === "conformant" && <Pill tone="brand">✓ OnlyHarness Standard</Pill>}
              {isDirectory && <Pill tone="soft">link-only directory</Pill>}
              {isDirectory && directory?.itemCount !== undefined && <Pill tone="soft">{directory.itemCount} items</Pill>}
              {installConfirms > 0 && <Pill tone="soft">Claude Code: {installConfirms} confirms</Pill>}
              {item.badge.includes("Wild") && <Pill tone="brand">🏆 {item.badge}</Pill>}
            </div>
          </div>
        </header>

        {/* ---- profile stat strip ---- */}
        <div className="fans-detail-statstrip">
          <div className="fans-detail-pstat"><span className="fans-detail-pstat-n">★ {fmtK(stars)}</span><span className="fans-detail-pstat-c">subscribers</span></div>
          <div className="fans-detail-pstat"><span className="fans-detail-pstat-n">⑂ {fmtK(item.forks)}</span><span className="fans-detail-pstat-c">forks</span></div>
          <div className="fans-detail-pstat"><span className="fans-detail-pstat-n">💬 {fmtK(item.threads)}</span><span className="fans-detail-pstat-c">wall posts</span></div>
          <div className="fans-detail-pstat"><span className="fans-detail-pstat-n">✓ {fmtK(installConfirms)}</span><span className="fans-detail-pstat-c">confirms</span></div>
        </div>

        {/* ---- segmented tab control ---- */}
        <div className="fans-detail-segbar" role="tablist" aria-label="Profile sections">
          {DETAIL_TABS.map((entry) => (
            <button
              key={entry}
              role="tab"
              aria-selected={entry === tab}
              className="fans-detail-seg"
              data-active={entry === tab ? "" : undefined}
              onClick={() => setTab(entry)}
            >
              {entry}
            </button>
          ))}
        </div>

        {/* ---- tab body ---- */}
        <div className="fans-detail-panel">
          {tab === "Overview" && (
            <div>
              <Card title="What it does">
                <p className="fans-detail-prose">{cleanReadme(detail?.readme) || item.summary}</p>
                {isDirectory && (
                  <p className="fans-detail-note">
                    Link-only directory. Open upstream, inspect current source state, and review licensing before
                    importing or installing anything.
                    {directory?.notes ? <><br />Notes: {directory.notes}</> : null}
                  </p>
                )}
              </Card>

              <Card title="Workflow">
                <ol className="fans-detail-workflow">
                  {(manifest?.workflow.stages ?? []).map((stage, index) => (
                    <li className="fans-detail-wf" key={`${stage.id}-${index}`}>
                      <span className="fans-detail-wf-n">{index + 1}</span>
                      <span className="fans-detail-wf-label">{stage.id.replaceAll("_", " ")}</span>
                      <span className="fans-detail-wf-agent">{stage.agent}</span>
                    </li>
                  ))}
                  {!manifest && (
                    <li className="fans-detail-note">{loadingManifest ? "Loading manifest…" : "No workflow stages declared."}</li>
                  )}
                </ol>
              </Card>

              <Card title="Works best for">
                <div className="fans-detail-taglist">
                  <Pill tone="soft">{item.job || item.outcome}</Pill>
                  {item.tags.slice(0, 4).map((t) => <Pill key={t} tone="soft">#{t.replace(/^#/, "")}</Pill>)}
                </div>
              </Card>
            </div>
          )}

          {tab === "Install" && (
            <Card title={isDirectory ? "Directory link" : "Install loop"}>
              <pre className="fans-detail-pre">{installLoop}</pre>
              <div className="fans-detail-taglist" style={{ marginTop: 12 }}>
                {targets.map((target) => (
                  <Pill key={targetLabel(target)} tone={targetTone(target) === "warn" ? "soft" : "brand"}>
                    {targetLabel(target)}: {target.status}
                  </Pill>
                ))}
              </div>
              <div className="fans-detail-btnrow">
                <Btn variant="primary" onClick={() => h.openInstall(item)}>
                  {isDirectory ? "🌐 Open directory" : "💿 Open Install Center"}
                </Btn>
                <Btn variant="cli" onClick={copyCli}>
                  {cliCopied ? "✓ Copied" : isDirectory ? "> Copy link" : "> Copy CLI"}
                </Btn>
              </div>
              <p className="fans-detail-fine">
                {isDirectory
                  ? "Directory entries are discovery indexes, not runnable harnesses."
                  : "Adapter targets generate local instruction files. Use eval and gate before real work."}
              </p>
            </Card>
          )}

          {tab === "Trust" && (
            <div className="fans-detail-trust">
              <Card tone="verified" title="✓ Verified creator — safe to inspect?">
                <InfoLine
                  label="Security scan"
                  value={detail?.security
                    ? `${detail.security.verdict} · ${detail.security.findings.length} findings`
                    : `${item.security.verdict} · ${item.security.findings} findings`}
                />
                <InfoLine label="Risk" value={`${detail?.risk.tier ?? item.riskTier} (${detail?.risk.score ?? item.riskScore})`} />
                <InfoLine label="Permissions" value={grantedPermissions.length ? grantedPermissions.join(", ") : "conservative"} />
                {detail?.risk.blocking?.length ? <p className="fans-detail-fine fans-detail-warn">{detail.risk.blocking[0]}</p> : null}
              </Card>

              <Card title="Works in my setup?">
                <InfoLine label={isDirectory ? "Content type" : "Runtime"} value={isDirectory ? "link-only directory" : manifest?.runtime.primary ?? item.runtime} />
                <InfoLine label="Adapters" value={manifest?.runtime.adapters?.length ? manifest.runtime.adapters.join(", ") : "none declared"} />
                <InfoLine label="Claude Code confirms" value={installConfirms ? `${installConfirms} real install${installConfirms === 1 ? "" : "s"}` : "no confirms yet"} />
                <InfoLine label="Context" value={fmtContextCost(detail?.contextCost ?? item.contextCost)} />
                <div className="fans-detail-taglist" style={{ marginTop: 10 }}>
                  {targets.map((target) => (
                    <Pill key={targetLabel(target)} tone={targetTone(target) === "warn" ? "soft" : "brand"}>
                      {targetLabel(target)}: {target.status}
                    </Pill>
                  ))}
                </div>
              </Card>

              <Card title="Better than alternatives?">
                <InfoLine label="Eval" value={evalLabel} />
                <InfoLine label="Gate" value={manifest ? `score ≥ ${manifest.quality_gates.min_score}` : "not loaded"} />
                <InfoLine label="Last verified" value={lastVerifiedLabel(detail)} />
                <div className="fans-detail-evals">
                  {(detail?.evalResult?.cases ?? []).slice(0, 4).map((entry) => (
                    <div className={`fans-detail-eval ${entry.passed ? "pass" : "fail"}`} key={entry.id}>
                      <span className="fans-detail-eval-mark">{entry.passed ? "✓" : "✗"}</span>
                      <span className="fans-detail-eval-title">{entry.title}</span>
                      <span className="fans-detail-eval-score">{entry.score.toFixed(2)}</span>
                    </div>
                  ))}
                  {detail && !detail.evalResult?.cases?.length && (
                    <div className="fans-detail-note">No recorded eval cases for this harness yet.</div>
                  )}
                  {!detail && <div className="fans-detail-note">Loading eval cases…</div>}
                </div>
              </Card>
            </div>
          )}

          {tab === "Try sample" && (
            <div className="fans-detail-try">
              <Card title="Example input">
                <pre className="fans-detail-pre">{detail ? detail.example?.input || "This harness ships without an example input." : "Loading example…"}</pre>
              </Card>
              <Card title="Expected output">
                <pre className="fans-detail-pre">{detail ? detail.example?.expected || "This harness ships without an expected output." : "Loading expected output…"}</pre>
              </Card>
              <div className="fans-detail-try-run">
                <Btn variant="primary" onClick={() => h.runSample(item)} disabled={tryState === "running" || isDirectory}>
                  {isDirectory ? "Link-only" : "▶ Preview sample"}
                </Btn>
                {tryState === "running" && <span className="fans-detail-run-status">⌛ Opening bundled sample…</span>}
                {tryState === "done" && <span className="fans-detail-run-status fans-detail-ok">Sample preview opened. Run the CLI eval before trusting it.</span>}
                <span className="fans-detail-fine fans-detail-fine-block">
                  {isDirectory
                    ? "Directory entries do not run samples. Open upstream and inspect current source state."
                    : "Shows the bundled example only. No LLM, credentials or eval gate run in this browser."}
                </span>
              </div>
            </div>
          )}

          {tab === "Thread" && (
            <div className="fans-detail-wall">
              <div className="fans-detail-composer">
                <select
                  className="fans-detail-select"
                  value={kind}
                  onChange={(event) => h.setKind(key, event.target.value)}
                  aria-label="Post kind"
                >
                  {THREAD_KINDS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                </select>
                <input
                  className="fans-detail-input"
                  value={draft}
                  onChange={(event) => h.setDraft(key, event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) h.addThreadPost(item); }}
                  placeholder="Show this creator some love — recipe, question or run result…"
                />
                <Btn variant="primary" onClick={() => h.addThreadPost(item)}>Post</Btn>
              </div>
              <div className="fans-detail-posts">
                {thread.map((post: ThreadItem) => (
                  <article className="fans-detail-post" key={post.id}>
                    <Avatar emoji={post.role === "maintainer" ? "📌" : "💬"} bg="var(--fa-wash)" size={38} />
                    <div className="fans-detail-post-main">
                      <div className="fans-detail-post-head">
                        <strong className="fans-detail-post-author">{post.author}</strong>
                        <Pill tone={post.role === "maintainer" ? "brand" : "soft"}>
                          {post.role === "maintainer" ? "📌 " : ""}{post.kind}
                        </Pill>
                        <span className="fans-detail-post-meta">{post.role} · {post.at}</span>
                      </div>
                      <p className="fans-detail-post-body">{post.body}</p>
                      <small className="fans-detail-post-likes">👍 {post.likes}</small>
                    </div>
                  </article>
                ))}
                {thread.length === 0 && (
                  <div className="fans-detail-empty">
                    <span className="fans-detail-empty-ic" aria-hidden>💬</span>
                    The wall is empty. Be the first fan to post. 💙
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "Files" && (
            <Card title="Files">
              <div className="fans-detail-files">
                {(detail?.files ?? []).map((file) => (
                  <div className="fans-detail-file" key={file}>
                    <span className="fans-detail-file-ic" aria-hidden>{fileIcon(file)}</span>
                    <span className="fans-detail-file-name">{file}</span>
                  </div>
                ))}
                {!detail?.files?.length && (
                  <div className="fans-detail-file"><span className="fans-detail-file-ic" aria-hidden>⌛</span><span className="fans-detail-file-name">Loading file list…</span></div>
                )}
              </div>
              {sourceUrl && (
                <div style={{ marginTop: 12 }}>
                  <a href={sourceUrl} target="_blank" rel="noreferrer">Open repository ↗</a>
                </div>
              )}
            </Card>
          )}

          {tab === "Versions" && (
            <div>
              <Card title="Archive versions">
                <div className="fans-detail-versions">
                  {versionHistory.map((entry) => (
                    <div className="fans-detail-version" key={entry.version}>
                      <span className={`fans-detail-ver-tag ${entry.current ? "cur" : entry.snapshot ? "" : "warn"}`}>{entry.version}</span>
                      <div className="fans-detail-ver-meta">
                        <strong>{entry.current ? "Current" : "Previous"}</strong>
                        <span>{entry.snapshot ? "immutable snapshot" : "live manifest"} · {entry.fileCount} files · {relativeTime(entry.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                  {!detail && (
                    <div className="fans-detail-version"><span className="fans-detail-ver-tag">…</span><div className="fans-detail-ver-meta"><strong>Loading</strong><span>Fetching archive history…</span></div></div>
                  )}
                </div>
              </Card>
              {!isDirectory && (
                <Card title="Pull a specific version">
                  <pre className="fans-detail-pre">{versionHistory.map((entry) => versionPullCommand(item, entry.version)).join("\n")}</pre>
                </Card>
              )}
              <p className="fans-detail-fine">
                {isDirectory
                  ? "Directory entries are link-only; version rows document catalog snapshots, not runnable files."
                  : "Rows marked immutable snapshot are served from stored archive files. A live current row is generated from the current manifest until publish records a snapshot."}
              </p>
            </div>
          )}
        </div>

        {/* ---- trust & safety + actions footer ---- */}
        <div className="fans-detail-foot">
          <Card tone="verified" title="🔥 Harness Heat">
            <div className="fans-detail-heat-head">
              <span className="fans-detail-heat-num">{heatQualified ? heat.toFixed(1) : "—"}</span>
              {heatQualified && (
                <span className={`fans-detail-heat-delta ${item.heatDelta >= 0 ? "up" : "down"}`}>
                  {item.heatDelta >= 0 ? "▲" : "▼"} {Math.abs(item.heatDelta).toFixed(1)} this week
                </span>
              )}
            </div>
            <div className="fans-detail-heatbar">
              <span className="fans-detail-heatbar-fill" style={{ width: `${heatQualified ? heatPctFans(visibleHeat) : 0}%` }} />
            </div>
            <p className="fans-detail-fine" style={{ marginTop: 8 }}>
              {heatQualified ? `Status: ${item.freshness}` : "Status hidden until enough real signals arrive."}
            </p>
            <p className="fans-detail-fine">Community signals are not safety guarantees.</p>
          </Card>

          <Card title="Trust & safety">
            <InfoLine label="Version" value={version} />
            <InfoLine label="Last verified" value={detail?.verification?.lastVerifiedAt ?? "no passed eval/gate event yet"} />
            <InfoLine label="Source" value={isDirectory ? directoryUrl ?? "upstream URL unavailable" : sourceUrl ?? "local registry"} />
            <InfoLine label="Works with" value={targets.filter((target) => target.status !== "planned").slice(0, 4).map(targetLabel).join(", ") || "review required"} />
            <InfoLine label="Eval" value={evalLabel} />
            <InfoLine label="Risk" value={`${detail?.risk.tier ?? item.riskTier} (${detail?.risk.score ?? item.riskScore})`} />
            <InfoLine label={isDirectory ? "Content type" : "Runtime"} value={isDirectory ? "link-only directory" : manifest?.runtime.primary ?? item.runtime} />
            <InfoLine label="Context" value={fmtContextCost(detail?.contextCost ?? item.contextCost)} />
            <InfoLine label="Eval gate" value={manifest ? `score ≥ ${manifest.quality_gates.min_score}` : "…"} />
            <InfoLine label="Permissions" value={grantedPermissions.length ? grantedPermissions.join(", ") : "conservative"} />
            {detail?.risk.reasons?.[0] && <p className="fans-detail-fine" style={{ marginTop: 8 }}>{detail.risk.reasons[0]}</p>}
          </Card>

          <div className="fans-detail-actions">
            <Btn variant="primary" onClick={() => h.openInstall(item)}>{isDirectory ? "🌐 Open directory" : "💿 Install"}</Btn>
            <Btn variant="cli" onClick={copyCli}>{cliCopied ? "✓ Copied" : isDirectory ? "> Copy link" : "> Copy CLI"}</Btn>
            <Btn variant="outline" className={starred ? "fans-detail-on" : undefined} onClick={() => h.toggleStar(item)}>
              ★ {starred ? "Subscribed" : "Subscribe"}
            </Btn>
            <Btn variant="outline" className={remixed ? "fans-detail-on" : undefined} onClick={() => h.remixHarness(item)}>
              ⑂ {remixed ? "Recipe copied" : "Remix"}
            </Btn>
            <Btn variant="outline" onClick={() => h.openShare(item)}>Share ↗</Btn>
          </div>

          <div className="fans-detail-cliline">
            <span className="fans-detail-cliline-cmd">{item.cliCommand}</span>
            <span className="fans-detail-cliline-meta">eval {item.evalScore ? item.evalScore.toFixed(2) : "—"} · risk {item.riskTier}</span>
          </div>
        </div>
      </main>
    </div>
  );
}
