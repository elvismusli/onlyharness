import { fmtK, keyFor } from "../../core/format";
import { useHarness } from "../../core/store";
import type { RegistryItem } from "../../core/types";
import { Btn, HeatBar, IconTile, SafeBadge, Stat, StatRow, Tag } from "./primitives";

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
 * One Modern harness card, rendering a real `RegistryItem`. Icon tile, title +
 * `by @author`, an accent heat badge, promise, tags (+ optional safety badge),
 * heat bar, and a footer stat row with an interactive star and a mono `eval`
 * score. Whole card opens the harness; the star toggles independently.
 */
function HarnessCard({ item }: { item: RegistryItem }) {
  const h = useHarness();
  const key = keyFor(item);
  const starred = Boolean(h.starred[key]);
  const icon = iconFor(item);

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
        <IconTile emoji={icon.emoji} bg={icon.bg} />
        <div className="oh-card-heading">
          <div className="oh-card-title">{item.title}</div>
          <div className="oh-card-author">by @{author}</div>
        </div>
        <div className="oh-heat-badge">🔥 {heatLabel}</div>
      </div>

      <p className="oh-card-promise">{item.summary}</p>

      <div className="oh-card-tags">
        {item.tags.slice(0, 3).map((tag) => (
          <Tag key={tag}>#{tag.replace(/^#/, "")}</Tag>
        ))}
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
        <Stat>⑂ {fmtK(item.forks)}</Stat>
        <Stat>💬 {item.threads}</Stat>
        <StatRow.Spacer />
        <span className="oh-eval">eval {item.evalScore ? item.evalScore.toFixed(2) : "—"}</span>
      </StatRow>
    </article>
  );
}

/**
 * Modern Explore for Task 1.1: hero (live-status pill from `totals`, accent
 * headline, subhead, two buttons) + a 3-col grid of real harnesses from
 * `useHarness().items`. Filter chips / sort / resource tabs / CLI strip arrive
 * in Task 1.2 — a simple, on-brand grid with real data is the goal here.
 */
export function ModernExplore() {
  const h = useHarness();
  const items = h.items;
  const count = h.totals.indexed;
  const headline = items[0] ?? h.leader;

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
            onClick={() => (headline ? h.openHarness(headline) : h.openCli())}
          >
            oh pull {headline ? headline.name : "deep-market-researcher"}
          </Btn>
        </div>
      </section>

      <div className="oh-section-head" id="oh-trending">
        <h2 className="oh-section-title">🔥 Trending this week</h2>
        <span className="oh-section-sort">
          Sorted by <span className="oh-section-sort-val">Harness Heat ▾</span>
        </span>
      </div>

      {items.length === 0 ? (
        <div className="oh-empty">
          {h.query
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
    </main>
  );
}
