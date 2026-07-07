import { fmtContextCost, fmtK, isoWeek, keyFor } from "../../core/format";
import { topTargetLabels } from "../../core/compat";
import { useHarness } from "../../core/store";
import type { RegistryItem } from "../../core/types";
import type { Surface } from "../../core/useAppNav";
import { Btn, HeatBar, Tag } from "./primitives";

/* Modern heat percentage matches the Explore card / detail meter (heat / 24) so
   the share card's heat bar agrees with the rest of the Modern skin. */
function heatPctModern(heat: number): number {
  return Math.min(100, Math.round((heat / 24) * 100));
}

/**
 * Modern Share card — the `harness_flex.exe` brag card rebuilt on Modern tokens.
 * A full-viewport `.ohd` layer above Explore (near-black canvas + top-right glow)
 * that renders a single dark OG-style card matching the site's `og.png` vibe: a
 * WordArt-ish accent title, the promise, tags, the five share-stats
 * (stars/forks/threads/eval-or-items/context), a big Harness Heat number + trend
 * + heat bar, a season/award badge, and an install command + `onlyharness.com`
 * footer. A "Copy brag text" button emits the exact same brag string the Win98
 * `ShareBody` produces, so both skins copy identical text.
 *
 * Every state is honest: directory ("link-only") harnesses swap eval for
 * item-count / category, and Harness Heat shows "—" until the harness qualifies —
 * no fabricated numbers.
 */
export function ModernShare({ surface }: { surface: Surface }) {
  const h = useHarness();
  const item: RegistryItem | undefined = surface.key ? h.knownItems[surface.key] : undefined;

  if (!item) {
    return (
      <main className="oh-main ohd">
        <div className="oh-empty">Nothing to brag about yet. Head back to Explore and open a harness.</div>
        <div style={{ marginTop: 16 }}>
          <Btn variant="secondary" onClick={() => h.closeSurface(surface.id)}>← Back to Explore</Btn>
        </div>
      </main>
    );
  }

  const key = keyFor(item);
  const starred = Boolean(h.starred[key]);
  const copied = h.copiedTag === "brag";

  /* Star nudges the shown numbers exactly like the Win98 card (+1 star, +0.4 heat
     only when the harness is heat-qualified). */
  const stars = item.stars + (starred ? 1 : 0);
  const heat = item.heat + (item.heatQualified && starred ? 0.4 : 0);
  const isDirectory = item.contentType === "directory";
  const shareBanner = isDirectory ? "★ LOOK AT MY DIRECTORY ★" : "★ LOOK AT MY HARNESS ★";
  const shareCommand = item.cliCommand ?? (isDirectory && item.directory?.url ? `open ${item.directory.url}` : `hh install ${item.owner}/${item.name}`);
  const worksWith = topTargetLabels(item, undefined, 5);
  const evalLabel = isDirectory ? "link-only" : `eval ${item.evalScore ? item.evalScore.toFixed(2) : item.evalStatus}`;
  const riskLabel = `risk ${item.riskTier} ${item.riskScore}`;
  const evalWarn = !(item.evalStatus === "passed" || isDirectory);
  const riskWarn = item.riskTier !== "LOW";
  const week = isoWeek(new Date());

  /* the five footer stats — directory mode swaps eval→items and ctx→category */
  const statEval = isDirectory ? (item.directory?.itemCount ?? "—") : (item.evalScore ? item.evalScore.toFixed(2) : "—");
  const statEvalCap = isDirectory ? "items" : "eval";
  const statCtx = isDirectory ? (item.directory?.category ?? "index") : fmtK(item.contextCost.approxTokens);
  const statCtxCap = isDirectory ? "category" : "ctx tokens";

  /* one-line metric summary + full brag text — byte-for-byte the Win98 string so
     both skins paste identically. */
  const metricLine = isDirectory
    ? `★ ${fmtK(stars)} · ⑂ ${fmtK(item.forks)} · 💬 ${item.threads} · ${item.directory?.itemCount ?? "curated"} items · ${item.heatQualified ? `Heat ${heat.toFixed(1)}🔥` : "Heat collecting signals"}`
    : `★ ${fmtK(stars)} · ⑂ ${fmtK(item.forks)} · 💬 ${item.threads} · eval ${item.evalScore ? item.evalScore.toFixed(2) : "—"} · context ${fmtContextCost(item.contextCost)} · ${item.heatQualified ? `Heat ${heat.toFixed(1)}🔥` : "Heat collecting signals"}`;
  const baseUrl = typeof window === "undefined" ? "https://onlyharness.com" : window.location.origin;
  const shareUrl = `${baseUrl}/#/h/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.name)}${h.refCode ? `?ref=${encodeURIComponent(h.refCode)}` : ""}`;
  const brag = `${shareBanner}\n${item.title} — ${item.summary}\n${metricLine}\nEval: ${evalLabel} · Risk: ${riskLabel}\nWorks with: ${worksWith.join(", ")}\n${shareUrl}\nInstall: ${shareCommand}`;

  const badgeLine = isDirectory
    ? `Curated link-only directory · Wk ${week}`
    : item.badge.includes("Wild")
      ? `Best Harness in the Wild West · Wk ${week}`
      : item.heatQualified
        ? "Qualified frontier harness"
        : "Collecting real signals";

  return (
    <main className="oh-main ohd">
      <button type="button" className="ohd-back" onClick={() => h.closeSurface(surface.id)}>
        ← Explore
      </button>

      <header className="ohd-head">
        <div className="ohd-head-main">
          <div className="ohd-owner">Share card · {isDirectory ? "directory" : "harness"}</div>
          <h1 className="ohd-title">Flex your harness</h1>
          <p className="ohd-summary">
            A share-ready brag card for {item.title}. Copy the text and paste it in Telegram, X or the group
            chat that doubts you.
          </p>
        </div>
      </header>

      <div className="oh-share-wrap">
        {/* ---- the brag card (dark OG-style) ---- */}
        <div className="oh-share-card" role="img" aria-label={`Share card for ${item.title}`}>
          <div className="oh-share-glow" aria-hidden />
          <div className="oh-share-top">
            <div className="oh-share-brand">
              <span className="oh-share-logo" aria-hidden>O</span>
              <span className="oh-share-wordmark">OnlyHarness</span>
            </div>
            <span className="oh-share-season">Season 4 · Week {week}</span>
          </div>

          <div className="oh-share-body">
            <div className="oh-share-left">
              <div className="oh-share-banner">{shareBanner}</div>
              <div className="oh-share-title">{item.title}</div>
              <p className="oh-share-promise">{item.summary}</p>
              <div className="oh-share-tags">
                {item.tags.slice(0, 1).map((tag) => <Tag key={tag}>#{tag.replace(/^#/, "")}</Tag>)}
                <span className={evalWarn ? "oh-tag oh-tag-warn" : "oh-safe-badge"}>{evalLabel}</span>
                <span className={riskWarn ? "oh-tag oh-tag-warn" : "oh-safe-badge"}>{riskLabel}</span>
                {worksWith.map((target) => <span key={target} className="oh-safe-badge">{target}</span>)}
              </div>
              <div className="oh-share-stats">
                <div className="oh-share-stat"><span className="oh-share-stat-n">★ {fmtK(stars)}</span><span className="oh-share-stat-c">stars</span></div>
                <div className="oh-share-stat"><span className="oh-share-stat-n">⑂ {fmtK(item.forks)}</span><span className="oh-share-stat-c">forks</span></div>
                <div className="oh-share-stat"><span className="oh-share-stat-n">💬 {item.threads}</span><span className="oh-share-stat-c">threads</span></div>
                <div className="oh-share-stat"><span className="oh-share-stat-n ok">{statEval}</span><span className="oh-share-stat-c">{statEvalCap}</span></div>
                <div className="oh-share-stat"><span className="oh-share-stat-n">{statCtx}</span><span className="oh-share-stat-c">{statCtxCap}</span></div>
              </div>
            </div>

            <div className="oh-share-right">
              <div className="oh-share-heat">
                <span className="oh-share-heat-label">🔥 Harness Heat</span>
                <span className="oh-share-heat-num">{item.heatQualified ? heat.toFixed(1) : "—"}</span>
                <span className={`oh-share-heat-trend ${item.heatQualified && item.heatDelta >= 0 ? "up" : "flat"}`}>
                  {item.heatQualified ? `▲ +${Math.max(0, item.heatDelta).toFixed(1)} this week` : "collecting signals"}
                </span>
                <HeatBar pct={item.heatQualified ? heatPctModern(heat) : 0} />
              </div>
              <div className="oh-share-award">
                <span className="oh-share-award-ic" aria-hidden>🏆</span>
                <span className="oh-share-award-text">{badgeLine}</span>
              </div>
            </div>
          </div>

          <div className="oh-share-footer">
            <span className="oh-share-install">Install: <span className="oh-share-cmd">{shareCommand}</span></span>
            <span className="oh-share-site">onlyharness.com 🌐</span>
          </div>
        </div>

        <div className="oh-share-actions">
          <Btn variant="primary" size="lg" onClick={() => h.copyText(brag, "Share text copied", "brag")}>
            {copied ? "✓ Copied" : "📋 Copy brag text"}
          </Btn>
          <span className="ohd-fine">Community signals are not safety guarantees. The card shows real numbers only.</span>
        </div>
      </div>
    </main>
  );
}
