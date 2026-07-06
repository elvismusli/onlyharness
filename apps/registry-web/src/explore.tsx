import type { Session } from "@supabase/supabase-js";
import { topTargetLabels } from "./compat";
import { fmtContextCost, fmtK, heatPct, keyFor } from "./format";
import type { DetailTab, RegistryItem } from "./types";
import { Btn, GroupBox, HeatMeter, MenuBar, TitleBar } from "./win98";

const PAINT_SWATCHES = ["#ff0000", "#ffff00", "#00a000", "#0000ff"];

export const SORT_OPTIONS = [
  { value: "trending", label: "by Heat" },
  { value: "stars", label: "by Stars" },
  { value: "forks", label: "by Forks" },
  { value: "threads", label: "by Threads" },
  { value: "new", label: "by Freshness" }
] as const;

export type ExploreActions = {
  openHarness: (item: RegistryItem, tab?: DetailTab) => void;
  star: (item: RegistryItem) => void;
  remix: (item: RegistryItem) => void;
  share: (item: RegistryItem) => void;
  openInstall: (item?: RegistryItem) => void;
  openPublish: () => void;
  openCli: () => void;
  openReview: () => void;
  openLeaderboard: () => void;
  openLogon: () => void;
  logOff: () => void;
  cantClose: () => void;
  about: () => void;
  copyText: (text: string, label: string) => void;
  refresh: () => void;
};

export function ExploreWindow({ items, jobs, jobFilter, setJobFilter, query, setQuery, sort, setSort, starred, remixed, session, totals, leader, flash, active, actions }: {
  items: RegistryItem[];
  jobs: Array<{ label: string; count: number }>;
  jobFilter: string;
  setJobFilter: (value: string) => void;
  query: string;
  setQuery: (value: string) => void;
  sort: string;
  setSort: (value: string) => void;
  starred: Record<string, boolean>;
  remixed: Record<string, boolean>;
  session: Session | null;
  totals: { stars: number; forks: number; threads: number; indexed: number };
  leader?: RegistryItem;
  flash: string;
  active: boolean;
  actions: ExploreActions;
}) {
  const top = items[0] ?? leader;

  const ticker = `★ ${fmtK(totals.stars)} stars flexed this week · ⑂ ${fmtK(totals.forks)} fork/remix records · 🔥 ${leader?.title ?? "the frontier"} is heating up · new season drops Monday · remix responsibly · onlyharness.com · `;

  const menus = [
    {
      key: "file",
      label: <span><u>F</u>ile</span>,
      items: [
        { icon: "📄", label: "New harness...", onClick: actions.openPublish },
        { icon: "💿", label: top ? `Install "${top.title}"...` : "Install Center...", onClick: () => actions.openInstall(top) },
        { icon: ">_", label: "Open MS-DOS Prompt", onClick: actions.openCli },
        "sep" as const,
        { icon: "🚪", label: "Exit", onClick: actions.cantClose }
      ]
    },
    {
      key: "view",
      label: <span><u>V</u>iew</span>,
      items: [
        ...SORT_OPTIONS.map((option) => ({
          label: `Sort ${option.label}`,
          checked: sort === option.value,
          onClick: () => setSort(option.value)
        })),
        "sep" as const,
        { icon: "🔄", label: "Refresh registry", onClick: actions.refresh }
      ]
    },
    {
      key: "harness",
      label: <span><u>H</u>arness</span>,
      items: [
        { icon: "▶", label: top ? `Preview "${top.title}"` : "Preview sample", onClick: () => top && actions.openHarness(top, "Try sample") },
        { icon: "💿", label: top ? `Install "${top.title}"` : "Install Center", onClick: () => actions.openInstall(top) },
        { icon: "⑂", label: top ? `Fork/remix "${top.title}"` : "Fork/remix", onClick: () => top && actions.remix(top) },
        "sep" as const,
        { icon: "🔧", label: "Maintainer review...", onClick: actions.openReview }
      ]
    },
    {
      key: "community",
      label: <span><u>C</u>ommunity</span>,
      items: [
        { icon: "💬", label: top ? `Thread: ${top.title}` : "Threads", onClick: () => top && actions.openHarness(top, "Thread") },
        { icon: "🏆", label: "Wild West leaderboard", onClick: actions.openLeaderboard },
        { icon: "★", label: "My starred harnesses", onClick: () => setJobFilter("starred") }
      ]
    },
    {
      key: "help",
      label: <span>Hel<u>p</u></span>,
      items: [
        { icon: "🧷", label: "About OnlyHarness 98", onClick: actions.about }
      ]
    }
  ];

  return (
    <div className="explore-shell">
      <div className="win" id="explore-window">
        <TitleBar icon="🌐" text="OnlyHarness — Explore" active={active} onClose={actions.cantClose} />

        <MenuBar menus={menus} />

        <div className="toolbar">
          <Btn onClick={actions.openPublish}>📄 New harness</Btn>
          <Btn onClick={() => top && actions.remix(top)}>⑂ Fork/remix</Btn>
          <Btn onClick={() => actions.openInstall(top)}>💿 Install</Btn>
          <Btn onClick={() => top && actions.openHarness(top, "Try sample")}>▶ Preview</Btn>
          <Btn onClick={actions.openCli}>&gt;_ CLI</Btn>
          <div className="vsep" />
          <label className="field98">
            <span style={{ fontSize: 13, color: "var(--shadow)" }}>🔍</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search harnesses..." aria-label="Search harnesses" />
          </label>
          <div className="swatches" aria-hidden>
            {PAINT_SWATCHES.map((color) => <span key={color} className="swatch" style={{ background: color }} />)}
          </div>
        </div>

        <div className="client">
          <div className="hero98">
            <div>
              <div className="wordart">OnlyHarness</div>
              <div className="hero-sub">
                Build with proven agent workflows. <b>Find, install, remix and improve</b> reusable AI-agent harnesses — no repo archaeology required.
              </div>
              <div className="hero-actions">
                <Btn strong big onClick={() => document.getElementById("trending")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  🔥 Explore trending
                </Btn>
                <Btn big onClick={actions.openPublish}>＋ Publish a harness</Btn>
                <Btn big onClick={() => actions.openInstall(top)}>💿 Install Center</Btn>
              </div>
              <div className="marquee">
                <div className="marquee-inner">{ticker}{ticker}</div>
              </div>
            </div>
          </div>

          <GroupBox legend="🔥 Trending this week" id="trending">
            {items.length === 0 ? (
              <div className="empty-state">
                <span className="tumbleweed">🌵</span>
                {jobFilter === "starred" && !session
                  ? "Log on to see the harnesses you starred."
                  : jobFilter === "starred"
                    ? "You haven't starred anything yet. Go warm something up."
                    : "No harnesses found on this frontier. Try another word, partner."}
              </div>
            ) : (
              <div className="hcards">
                {items.map((item) => (
                  <HarnessCard
                    key={keyFor(item)}
                    item={item}
                    starred={Boolean(starred[keyFor(item)])}
                    remixed={Boolean(remixed[keyFor(item)])}
                    onOpen={(tab) => actions.openHarness(item, tab)}
                    onStar={() => actions.star(item)}
                    onFork={() => actions.remix(item)}
                    onShare={() => actions.share(item)}
                  />
                ))}
              </div>
            )}
          </GroupBox>

          <GroupBox legend="Browse by job">
            <div className="outcome-row">
              {jobs.map((entry) => (
                <Btn key={entry.label} pressed={jobFilter === entry.label} onClick={() => setJobFilter(jobFilter === entry.label ? "all" : entry.label)}>
                  {entry.label === "starred" ? "★ My stars" : entry.label} ({entry.count})
                </Btn>
              ))}
            </div>
            <button
              type="button"
              className="crt-strip"
              style={{ width: "100%", border: "none", textAlign: "left", cursor: "pointer", display: "block" }}
              title="Copy CLI command"
              onClick={() => top && actions.copyText(top.cliCommand, "CLI command copied")}
            >
              C:\hub&gt; {top?.cliCommand ?? "hh install harnesses/deep-market-researcher"}<span className="cursor" />
            </button>
          </GroupBox>

          <div className="statusbar">
            <span className="status-plate">{flash || `Ready · ${totals.indexed} harnesses indexed`}</span>
            {session?.user ? (
              <button className="status-plate" onClick={actions.logOff} title="Log off">👤 {session.user.email} · Log off</button>
            ) : (
              <button className="status-plate" onClick={actions.openLogon} title="Log on">👤 Not logged on · Log on</button>
            )}
            <span className="status-plate">onlyharness.com · Season 4 · Wild West 🤠</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HarnessCard({ item, starred, remixed, onOpen, onStar, onFork, onShare }: {
  item: RegistryItem;
  starred: boolean;
  remixed: boolean;
  onOpen: (tab?: DetailTab) => void;
  onStar: () => void;
  onFork: () => void;
  onShare: () => void;
}) {
  const stars = item.stars + (starred ? 1 : 0);
  const heat = item.heat + (item.heatQualified && starred ? 0.4 : 0);
  const visibleHeat = item.heatQualified ? heat : 0;
  const isDirectory = item.contentType === "directory";
  return (
    <article className="win small hcard">
      <TitleBar text={item.title} decor onClick={() => onOpen()} />
      <div className="hcard-body">
        <div className="promise" onClick={() => onOpen()}>{item.summary}</div>
        <div className="tagrow">
          {item.tags.slice(0, 3).map((tag) => <span key={tag} className="tag98">#{tag.replace(/^#/, "")}</span>)}
          {isDirectory && <span className="tag98 warn">link-only directory</span>}
          {item.standard === "conformant" && <span className="tag98 safe">✓ Standard</span>}
          {item.installConfirms > 0 && <span className="tag98 safe">Claude Code: {item.installConfirms}</span>}
        </div>
        <div className="compat-chiprow">
          {isDirectory ? (
            <>
              <span className="tag98 safe">Open link</span>
              {item.directory?.itemCount !== undefined && <span className="tag98">{item.directory.itemCount} items</span>}
              {item.directory?.category && <span className="tag98">{item.directory.category}</span>}
            </>
          ) : topTargetLabels(item, undefined, 5).map((label) => <span className="tag98 safe" key={label}>{label}</span>)}
        </div>
        <div className="stats-plate">
          <span>⑂ {fmtK(item.forks)}</span>
          <span>💬 {item.threads}</span>
          <span>ctx {fmtK(item.contextCost.approxTokens)}</span>
          <span className="eval-ok">eval {item.evalScore ? item.evalScore.toFixed(2) : "—"}</span>
        </div>
        <div className="heat-block">
          <div className="heat-head">
            <span className="lbl">Harness Heat</span>
            <span className="heat-num">{item.heatQualified ? `${heat.toFixed(1)} 🔥` : "—"}</span>
          </div>
          <HeatMeter heat={visibleHeat} pct={heatPct(visibleHeat)} />
          <div style={{ fontSize: 11, marginTop: 3, color: "#404040" }}>
            {item.heatQualified ? `context: ${fmtContextCost(item.contextCost)}` : "collecting real signals"}
          </div>
        </div>
        <div className="hcard-actions hcard-cta-grid">
          <Btn className="star-btn" pressed={starred} onClick={onStar} title={starred ? "Unstar" : "Star"}>★ {fmtK(stars)}</Btn>
          <Btn strong onClick={() => isDirectory ? onOpen("Overview") : onOpen("Install")}>{isDirectory ? "🌐 Open" : "💿 Install"}</Btn>
          <Btn onClick={() => onOpen(isDirectory ? "Files" : "Try sample")}>{isDirectory ? "Source" : "Preview"}</Btn>
          <Btn onClick={onShare} title="Share card" ariaLabel="Share card">💾</Btn>
          <Btn pressed={remixed} onClick={onFork} title="Fork/remix recipe" ariaLabel="Fork/remix recipe">⑂</Btn>
        </div>
      </div>
    </article>
  );
}
