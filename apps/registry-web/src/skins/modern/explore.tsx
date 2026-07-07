import { useEffect, useRef, useState } from "react";

import { fmtK, keyFor } from "../../core/format";
import { RESOURCE_TABS } from "../../core/resource-tabs";
import { useHarness } from "../../core/store";
import type { RegistryItem, ResourceItem } from "../../core/types";
import { Btn, HeatBar, IconTile, SafeBadge, Stat, StatRow, Tag } from "./primitives";

/* Sort options mirror the Win98 skin's SORT_OPTIONS values so both skins drive
   the same `sort` state; only the labels are restyled for the Modern menu. The
   `menu` label is what the "Sorted by …" control shows when that option is
   active. */
const SORT_OPTIONS = [
  { value: "trending", menu: "Harness Heat", item: "Trending" },
  { value: "stars", menu: "Stars", item: "Most starred" },
  { value: "forks", menu: "Forks", item: "Most forked" },
  { value: "threads", menu: "Threads", item: "Most discussed" },
  { value: "new", menu: "Freshness", item: "Newest" }
] as const;

/* Deterministic emoji + tinted tile per harness so cards feel distinct without
   any real icon asset (the handoff uses emoji-on-tinted-tile). Picked by hashing
   the harness key so the same harness always gets the same look across renders. */
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

/* Resource-type emoji + tint, so resource cards get a matching icon tile. */
const RESOURCE_ICON: Record<ResourceItem["resourceType"], { emoji: string; bg: string }> = {
  harness: { emoji: "💿", bg: "rgba(255,107,53,.14)" },
  skill: { emoji: "✨", bg: "rgba(251,191,36,.14)" },
  plugin: { emoji: "🧩", bg: "rgba(167,139,250,.14)" },
  workflow: { emoji: "🔀", bg: "rgba(45,212,191,.13)" },
  mcp_server: { emoji: "🔌", bg: "rgba(96,165,250,.13)" },
  service_endpoint: { emoji: "🛰️", bg: "rgba(96,165,250,.13)" },
  agent_team: { emoji: "🤝", bg: "rgba(74,222,128,.12)" },
  subagent_pack: { emoji: "🧬", bg: "rgba(74,222,128,.12)" },
  command_pack: { emoji: "⌨️", bg: "rgba(167,139,250,.14)" },
  config: { emoji: "⚙️", bg: "rgba(148,163,184,.14)" },
  guide: { emoji: "📚", bg: "rgba(255,138,92,.13)" },
  framework: { emoji: "🏗️", bg: "rgba(148,163,184,.14)" },
  agent_runtime: { emoji: "🖥️", bg: "rgba(148,163,184,.14)" },
  directory: { emoji: "🗂️", bg: "rgba(255,138,92,.13)" }
};

function iconFor(item: RegistryItem): { emoji: string; bg: string } {
  const key = keyFor(item);
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return ICON_PALETTE[hash % ICON_PALETTE.length];
}

/* Modern heat percentage: min(100, round(heat / 24 * 100)) per the Modern
   handoff (the Win98 heat meter uses a different divisor). */
function heatPctModern(heat: number): number {
  return Math.min(100, Math.round((heat / 24) * 100));
}

/**
 * "Browse by outcome" filter chips, rendered from the real `jobs[]` projection.
 * The first chip ("All") is a solid-accent toggle back to the unfiltered view;
 * the rest are elevated pills with a hairline that go accent-outline when active.
 * The starred job renders as "★ My stars". Bound to `jobFilter`/`setJobFilter`
 * with the same toggle-off-to-all semantics as Win98.
 */
function OutcomeChips({
  jobs,
  jobFilter,
  setJobFilter
}: {
  jobs: Array<{ label: string; count: number }>;
  jobFilter: string;
  setJobFilter: (value: string) => void;
}) {
  return (
    <section className="oh-chips" aria-label="Browse by outcome">
      <span className="oh-chips-label">Browse by outcome</span>
      <button
        type="button"
        className="oh-chip oh-chip-all"
        data-active={jobFilter === "all" ? "" : undefined}
        onClick={() => setJobFilter("all")}
      >
        All
      </button>
      {jobs.map((entry) => {
        const active = jobFilter === entry.label;
        const label = entry.label === "starred" ? "★ My stars" : entry.label;
        return (
          <button
            key={entry.label}
            type="button"
            className="oh-chip"
            data-active={active ? "" : undefined}
            onClick={() => setJobFilter(active ? "all" : entry.label)}
          >
            {label} <span className="oh-chip-count">{entry.count}</span>
          </button>
        );
      })}
    </section>
  );
}

/**
 * "Sorted by … ▾" control. Presented as the handoff's static section label but
 * wired to a real dropdown menu bound to `sort`/`setSort`. Closes on outside
 * click or Escape. Options match the Win98 SORT_OPTIONS values so the shared
 * `sort` state stays consistent across skins.
 */
function SortMenu({ sort, setSort }: { sort: string; setSort: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = SORT_OPTIONS.find((option) => option.value === sort) ?? SORT_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="oh-sort" ref={rootRef}>
      <button
        type="button"
        className="oh-sort-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Sorted by <span className="oh-sort-val">{current.menu} ▾</span>
      </button>
      {open && (
        <div className="oh-sort-menu" role="menu">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === sort}
              className="oh-sort-item"
              data-active={option.value === sort ? "" : undefined}
              onClick={() => {
                setSort(option.value);
                setOpen(false);
              }}
            >
              <span className="oh-sort-check" aria-hidden>{option.value === sort ? "✓" : ""}</span>
              {option.item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Resource-catalog tab strip (All / Skills / Plugins / Workflows / MCP /
 * Runtimes / Guides / Harnesses). Bound to `resourceTab`/`setResourceTab`; the
 * active tab is an accent-underlined pill. "Harnesses" flips Explore back to the
 * harness grid + outcome chips; every other tab shows ResourceCards.
 */
function ResourceTabs({
  resourceTab,
  setResourceTab
}: {
  resourceTab: string;
  setResourceTab: (value: (typeof RESOURCE_TABS)[number]) => void;
}) {
  return (
    <nav className="oh-restabs" aria-label="Resource catalog">
      {RESOURCE_TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          className="oh-restab"
          data-active={resourceTab === tab ? "" : undefined}
          onClick={() => setResourceTab(tab)}
        >
          {tab}
        </button>
      ))}
    </nav>
  );
}

/**
 * One Modern harness card, rendering a real `RegistryItem`. Icon tile, title +
 * `by @author`, an accent heat badge, promise, tags (+ optional safety badge),
 * heat bar, and a footer stat row with an interactive star and a mono `eval`
 * score. Whole card opens the harness; the star toggles and the fork remixes
 * independently.
 *
 * Directory ("link-only") harnesses never fabricate heat/eval: the heat badge
 * and bar go to "—" / empty and the footer shows the honest empty eval, exactly
 * like the Win98 card's `heatQualified` handling.
 */
function HarnessCard({ item }: { item: RegistryItem }) {
  const h = useHarness();
  const key = keyFor(item);
  const starred = Boolean(h.starred[key]);
  const icon = iconFor(item);
  const isDirectory = item.contentType === "directory";

  /* mirror the Win98 card's star/heat nudge so counts stay consistent between
     skins: +1 star and +0.4 heat (when heat-qualified) while starred. */
  const stars = item.stars + (starred ? 1 : 0);
  const heat = item.heat + (item.heatQualified && starred ? 0.4 : 0);
  const showHeat = item.heatQualified;
  const heatLabel = showHeat ? heat.toFixed(1) : "—";
  const author = item.ownerLabel || item.owner;

  return (
    <article
      className="oh-card"
      onClick={() => h.openHarness(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          h.openHarness(item);
        }
      }}
    >
      <div className="oh-card-head">
        <IconTile emoji={isDirectory ? "🗂️" : icon.emoji} bg={isDirectory ? "rgba(255,138,92,.13)" : icon.bg} />
        <div className="oh-card-heading">
          <div className="oh-card-title">{item.title}</div>
          <div className="oh-card-author">by @{author}</div>
        </div>
        <div className="oh-heat-badge" data-muted={showHeat ? undefined : ""}>🔥 {heatLabel}</div>
      </div>

      <p className="oh-card-promise">{item.summary}</p>

      <div className="oh-card-tags">
        {item.tags.slice(0, 3).map((tag) => (
          <Tag key={tag}>#{tag.replace(/^#/, "")}</Tag>
        ))}
        {isDirectory && <Tag>link-only directory</Tag>}
        {item.security?.verdict === "pass" && <SafeBadge />}
      </div>

      <HeatBar pct={showHeat ? heatPctModern(heat) : 0} />

      <StatRow>
        <Stat
          interactive
          active={starred}
          title={starred ? "Unstar" : "Star"}
          color={starred ? "var(--oh-star-gold)" : undefined}
          onClick={() => h.toggleStar(item)}
        >
          ★ {fmtK(stars)}
        </Stat>
        <Stat
          interactive
          title="Remix a draft recipe"
          onClick={() => h.remixHarness(item)}
        >
          ⑂ {fmtK(item.forks)}
        </Stat>
        <Stat>💬 {item.threads}</Stat>
        <StatRow.Spacer />
        <span className="oh-eval">eval {item.evalScore ? item.evalScore.toFixed(2) : "—"}</span>
      </StatRow>
    </article>
  );
}

/** Availability label mirrors the Win98 resource card exactly. */
function availabilityLabel(item: ResourceItem): string {
  if (item.actions.some((action) => action.id === "open_onlyharness")) return "OnlyHarness listing";
  if (item.mirror?.status === "ready") return "OnlyHarness mirror";
  if (item.installability === "verified") return "verified install";
  if (item.installability === "installable") return item.resourceType === "harness" ? "native install" : "installable";
  if (item.installability === "importable") return "ready to add";
  return "upstream listing";
}

/** Primary CTA label for a resource, driven by its first action's id. */
function primaryActionLabel(item: ResourceItem): string {
  const primary = item.actions[0];
  switch (primary?.id) {
    case "install":
      return "💿 Install";
    case "copy_mcp_config":
      return "📋 Copy config";
    case "open_onlyharness":
      return "Use in OnlyHarness";
    case "import_github":
      return "＋ Add from GitHub";
    case "open_mirror":
      return "🌐 Open mirror";
    default:
      return "🌐 Use";
  }
}

/**
 * One Modern resource card, rendering a real `ResourceItem` from the catalog.
 * Same card chrome as a harness card (icon tile + title + type author line),
 * then the resource meta tags (type / platform / availability / license),
 * worksWith chips, an upstream-or-native star stat with the source-check status,
 * an explicit "not safety proof" trust line, and the primary action button
 * (Install / Copy / Use — driven by `actions[0].id`) plus a secondary copy-ID.
 * The whole card and its primary button open the resource; the ID button copies.
 */
function ResourceCard({ item }: { item: ResourceItem }) {
  const h = useHarness();
  const icon = RESOURCE_ICON[item.resourceType] ?? RESOURCE_ICON.directory;
  const stars = item.upstreamPopularity.githubStarsCurrent ?? item.upstreamPopularity.githubStarsSnapshot;
  const availability = availabilityLabel(item);
  const verified = item.installability === "verified" || item.installability === "installable";
  const permissive = item.licenseStatus === "permissive";

  return (
    <article
      className="oh-card oh-rcard"
      onClick={() => h.openResource(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          h.openResource(item);
        }
      }}
    >
      <div className="oh-card-head">
        <IconTile emoji={icon.emoji} bg={icon.bg} />
        <div className="oh-card-heading">
          <div className="oh-card-title">{item.title}</div>
          <div className="oh-card-author">by @{item.upstreamOwner}</div>
        </div>
      </div>

      <p className="oh-card-promise">{item.summary}</p>

      <div className="oh-card-tags">
        <Tag>{item.resourceType.replace(/_/g, " ")}</Tag>
        <Tag>{item.sourcePlatform}</Tag>
        {verified ? <SafeBadge>{availability}</SafeBadge> : <Tag>{availability}</Tag>}
        {permissive ? (
          <SafeBadge>license {item.licenseStatus}</SafeBadge>
        ) : (
          <span className="oh-tag oh-tag-warn">license {item.licenseStatus}</span>
        )}
      </div>

      {item.worksWith.length > 0 && (
        <div className="oh-card-tags oh-worksrow">
          {item.worksWith.slice(0, 5).map((target) => (
            <span className="oh-wor" key={target}>{target}</span>
          ))}
        </div>
      )}

      <div className="oh-rstats">
        <span className="oh-rstat">
          {stars !== undefined ? `GitHub ★ ${fmtK(stars)}` : `OnlyHarness ★ ${item.onlyHarnessSignals.stars}`}
        </span>
        <span className="oh-rstat-sep" aria-hidden>·</span>
        <span className="oh-rstat">source {item.sourceCheckStatus}</span>
      </div>

      <div className="oh-trust-line">
        {item.trust.installVerifiedAt ? "Verified install" : "Source checked"} — popularity is upstream signal, not safety proof.
      </div>

      <div className="oh-rcard-actions">
        <Btn
          variant="primary"
          className="oh-rcard-primary"
          onClick={(event) => {
            event.stopPropagation();
            h.openResource(item);
          }}
        >
          {primaryActionLabel(item)}
        </Btn>
        <Btn
          variant="secondary"
          onClick={(event) => {
            event.stopPropagation();
            h.copyText(item.id, "Resource ID copied");
          }}
        >
          ID
        </Btn>
      </div>
    </article>
  );
}

/**
 * Mock terminal card matching the handoff: traffic-light dots + "terminal — oh"
 * label, then `$ oh pull` → a green success line → `$ oh run` with a blinking
 * accent cursor. Presentational only (the real CLI window opens elsewhere); the
 * pulled harness name tracks the current top card so it reads as live.
 */
function CliStrip({ item }: { item?: RegistryItem }) {
  const name = item?.name ?? "deep-market-researcher";
  const files = item?.contextCost.files ?? 12;
  const evalLabel = item?.evalScore ? item.evalScore.toFixed(2) : "0.91";
  const safe = item?.security?.verdict === "pass";
  return (
    <section className="oh-cli" aria-label="CLI example">
      <div className="oh-cli-bar">
        <span className="oh-cli-dot" style={{ background: "#ff5f57" }} />
        <span className="oh-cli-dot" style={{ background: "#febc2e" }} />
        <span className="oh-cli-dot" style={{ background: "#28c840" }} />
        <span className="oh-cli-label">terminal — oh</span>
      </div>
      <div className="oh-cli-body">
        <div className="oh-cli-cmd"><span className="oh-cli-prompt">$</span> oh pull {name}</div>
        <div className="oh-cli-ok">✓ fetched harness · {files} files · eval {evalLabel} · safety {safe ? "✓" : "—"}</div>
        <div className="oh-cli-cmd">
          <span className="oh-cli-prompt">$</span> oh run --input &quot;Q3 EV market&quot;
          <span className="oh-cli-cursor" aria-hidden />
        </div>
      </div>
    </section>
  );
}

/**
 * Full Modern Explore (Task 1.2). Hero → outcome chips (harness mode only) →
 * resource-catalog tabs → section head with the live sort menu → the grid
 * (harness cards from `items`, or ResourceCards from the tab-filtered
 * `visibleResources`) → CLI strip. Pure consumer of `useHarness()`; every field
 * is real and every empty/unqualified state is shown honestly.
 */
export function ModernExplore() {
  const h = useHarness();
  const resourceMode = h.resourceTab !== "Harnesses";
  const items = h.items;
  const resources = h.visibleResources;
  const count = h.totals.indexed;
  const top = items[0] ?? h.leader;

  return (
    <main className="oh-main">
      <section className="oh-hero">
        <span className="oh-status-pill">
          <span className="oh-status-dot" aria-hidden />
          {count > 0 ? `${fmtK(count)} harnesses` : "Loading harnesses"} · Season 4 live
        </span>
        <h1 className="oh-hero-title">
          The home for<br />agent <span className="oh-accent-text">harnesses</span>.
        </h1>
        <p className="oh-hero-sub">
          Discover, fork, run and improve proven AI-agent workflows. Every harness ships with eval
          evidence — no repo archaeology required.
        </p>
        <div className="oh-hero-actions">
          <Btn
            variant="primary"
            size="lg"
            onClick={() => document.getElementById("oh-trending")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            Explore trending
          </Btn>
          <Btn
            variant="mono"
            size="lg"
            prefix="$"
            onClick={() => (top ? h.openHarness(top) : h.openCli())}
          >
            oh pull {top ? top.name : "deep-market-researcher"}
          </Btn>
        </div>
      </section>

      {!resourceMode && (
        <OutcomeChips jobs={h.jobs} jobFilter={h.jobFilter} setJobFilter={h.setJobFilter} />
      )}

      <ResourceTabs resourceTab={h.resourceTab} setResourceTab={h.setResourceTab} />

      <div className="oh-section-head" id="oh-trending">
        <h2 className="oh-section-title">
          {resourceMode ? <>🌐 {h.resourceTab} resources</> : <>🔥 Trending this week</>}
        </h2>
        {!resourceMode && <SortMenu sort={h.sort} setSort={h.setSort} />}
      </div>

      {resourceMode ? (
        resources.length === 0 ? (
          <div className="oh-empty">
            {h.query
              ? "No resources match that search yet."
              : "No resources in this catalog tab yet. Try another tab."}
          </div>
        ) : (
          <section className="oh-grid">
            {resources.map((item) => (
              <ResourceCard key={item.id} item={item} />
            ))}
          </section>
        )
      ) : items.length === 0 ? (
        <div className="oh-empty">
          {h.jobFilter === "starred" && !h.session
            ? "Log on to see the harnesses you starred."
            : h.jobFilter === "starred"
              ? "You haven't starred anything yet. Go warm something up."
              : h.query
                ? "No harnesses match that search yet."
                : "Warming up the frontier… harnesses will appear here."}
        </div>
      ) : (
        <section className="oh-grid">
          {items.map((item) => (
            <HarnessCard key={keyFor(item)} item={item} />
          ))}
        </section>
      )}

      <CliStrip item={top} />
    </main>
  );
}
