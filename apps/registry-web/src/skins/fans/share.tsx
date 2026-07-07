import { fmtContextCost, fmtK, isoWeek, keyFor } from "../../core/format";
import { topTargetLabels } from "../../core/compat";
import { useHarness } from "../../core/store";
import type { RegistryItem } from "../../core/types";
import type { Surface } from "../../core/useAppNav";
import { Avatar, Btn, Pill, Stat } from "./primitives";
import "./share.css";

/* Fans heat percentage mirrors the Modern share card (heat / 24) so the heat bar
   agrees with the rest of the app; callers only pass a real, qualified heat. */
function heatPctFans(heat: number): number {
  return Math.min(100, Math.round((heat / 24) * 100));
}

/* Emoji "avatar" for a harness — deterministic per key so the same harness always
   gets the same face, purely cosmetic (no data meaning). */
const FANS_FACES = ["🤠", "🚀", "🛸", "🦾", "🧠", "🛰️", "🐎", "⚡", "🔧", "🪄", "🎯", "🧪"];
function faceFor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return FANS_FACES[hash % FANS_FACES.length];
}

/**
 * Fans Share card — the on-brand "flex card" the whole parody is about: a bright,
 * blue "brag card" you screenshot and drop in the group chat. Rendered as a
 * centered overlay above the Fans landing (same `.fa-overlay` pattern the other
 * Fans surfaces use), it shows a round avatar + title, `@handle`, promise, tags,
 * the five share-stats (stars/forks/threads/eval-or-items/context), a big Harness
 * Heat number + trend + heat bar, a "🏆 Top creator" badge, a playful banner, and
 * an install command + `onlyharness.com` footer. A "Copy brag text" button emits
 * the exact same brag string the Win98 `ShareBody` / Modern `ModernShare` produce,
 * so every skin copies identical text.
 *
 * Every state is honest: directory ("link-only") harnesses swap eval for
 * item-count / category, and Harness Heat shows "—" until the harness qualifies —
 * no fabricated numbers.
 */
export function FansShare({ surface }: { surface: Surface }) {
  const h = useHarness();
  const item: RegistryItem | undefined = surface.key ? h.knownItems[surface.key] : undefined;

  if (!item) {
    return (
      <div className="fa-overlay" role="dialog" aria-label="Share">
        <div className="fa-overlay-card">
          <div className="fa-overlay-head">
            <h2 className="fa-overlay-title">Nothing to flex yet 💙</h2>
            <button
              type="button"
              className="fa-overlay-close"
              aria-label="Close"
              onClick={() => h.closeSurface(surface.id)}
            >
              ✕
            </button>
          </div>
          <p className="fa-overlay-body">Head back and open a harness, then come brag about it.</p>
          <div className="fa-overlay-actions">
            <Btn variant="outline" onClick={() => h.closeSurface(surface.id)}>← Back to feed</Btn>
          </div>
        </div>
      </div>
    );
  }

  const key = keyFor(item);
  const starred = Boolean(h.starred[key]);
  const copied = h.copiedTag === "brag";

  /* Star nudges the shown numbers exactly like the Win98 / Modern card (+1 star,
     +0.4 heat only when the harness is heat-qualified). */
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
  const handle = `@${item.owner.toLowerCase()}`;

  /* the five footer stats — directory mode swaps eval→items and ctx→category */
  const statEval = isDirectory ? (item.directory?.itemCount ?? "—") : (item.evalScore ? item.evalScore.toFixed(2) : "—");
  const statEvalCap = isDirectory ? "items" : "eval";
  const statCtx = isDirectory ? (item.directory?.category ?? "index") : fmtK(item.contextCost.approxTokens);
  const statCtxCap = isDirectory ? "category" : "ctx tokens";

  /* one-line metric summary + full brag text — byte-for-byte the Win98 / Modern
     string so every skin pastes identically. */
  const metricLine = isDirectory
    ? `★ ${fmtK(stars)} · ⑂ ${fmtK(item.forks)} · 💬 ${item.threads} · ${item.directory?.itemCount ?? "curated"} items · ${item.heatQualified ? `Heat ${heat.toFixed(1)}🔥` : "Heat collecting signals"}`
    : `★ ${fmtK(stars)} · ⑂ ${fmtK(item.forks)} · 💬 ${item.threads} · eval ${item.evalScore ? item.evalScore.toFixed(2) : "—"} · context ${fmtContextCost(item.contextCost)} · ${item.heatQualified ? `Heat ${heat.toFixed(1)}🔥` : "Heat collecting signals"}`;
  const baseUrl = typeof window === "undefined" ? "https://onlyharness.com" : window.location.origin;
  const shareUrl = `${baseUrl}/#/h/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.name)}${h.refCode ? `?ref=${encodeURIComponent(h.refCode)}` : ""}`;
  const brag = `${shareBanner}\n${item.title} — ${item.summary}\n${metricLine}\nEval: ${evalLabel} · Risk: ${riskLabel}\nWorks with: ${worksWith.join(", ")}\n${shareUrl}\nInstall: ${shareCommand}`;

  const badgeLine = isDirectory
    ? "Top curator this week"
    : item.badge.includes("Wild")
      ? "Best in the Wild West"
      : item.heatQualified
        ? "Top creator this week"
        : "Rising creator";

  const flexBanner = isDirectory ? "★ look at my directory 🤠 ★" : "★ look at my harness 🤠 ★";

  return (
    <div className="fa-overlay fans-share-overlay" role="dialog" aria-label={`Flex card for ${item.title}`}>
      <div className="fans-share-shell">
        <button
          type="button"
          className="fans-share-dismiss"
          aria-label="Close"
          onClick={() => h.closeSurface(surface.id)}
        >
          ✕
        </button>

        {/* ---- the flex card (bright blue brag card) ---- */}
        <div className="fans-share-card" role="img" aria-label={`Flex card for ${item.title}`}>
          <div className="fans-share-glow" aria-hidden />

          <div className="fans-share-top">
            <div className="fans-share-brand">
              <span className="fans-share-logo" aria-hidden>O</span>
              <span className="fans-share-wordmark">Only<b>Harness</b></span>
            </div>
            <span className="fans-share-season">Season 4 · Wk {week}</span>
          </div>

          <div className="fans-share-hero">
            <Avatar emoji={faceFor(key)} size={64} />
            <div className="fans-share-id">
              <div className="fans-share-title">{item.title}</div>
              <div className="fans-share-handle">{handle}</div>
            </div>
            <Pill tone="dark">🏆 {badgeLine}</Pill>
          </div>

          <div className="fans-share-banner">{flexBanner}</div>

          <p className="fans-share-promise">{item.summary}</p>

          <div className="fans-share-tags">
            {item.tags.slice(0, 1).map((tag) => <Pill key={tag} tone="soft">#{tag.replace(/^#/, "")}</Pill>)}
            <span className={evalWarn ? "fans-share-chip warn" : "fans-share-chip ok"}>{evalLabel}</span>
            <span className={riskWarn ? "fans-share-chip warn" : "fans-share-chip ok"}>{riskLabel}</span>
            {worksWith.map((target) => <span key={target} className="fans-share-chip">{target}</span>)}
          </div>

          <div className="fans-share-stats">
            <div className="fans-share-stat"><span className="fans-share-stat-n">★ {fmtK(stars)}</span><span className="fans-share-stat-c">stars</span></div>
            <div className="fans-share-stat"><span className="fans-share-stat-n">⑂ {fmtK(item.forks)}</span><span className="fans-share-stat-c">forks</span></div>
            <div className="fans-share-stat"><span className="fans-share-stat-n">💬 {item.threads}</span><span className="fans-share-stat-c">threads</span></div>
            <div className="fans-share-stat"><Stat eval={!isDirectory}><span className="fans-share-stat-n">{statEval}</span></Stat><span className="fans-share-stat-c">{statEvalCap}</span></div>
            <div className="fans-share-stat"><span className="fans-share-stat-n">{statCtx}</span><span className="fans-share-stat-c">{statCtxCap}</span></div>
          </div>

          <div className="fans-share-heat">
            <div className="fans-share-heat-head">
              <span className="fans-share-heat-label">🔥 Harness Heat</span>
              <span className={`fans-share-heat-trend ${item.heatQualified && item.heatDelta >= 0 ? "up" : "flat"}`}>
                {item.heatQualified ? `▲ +${Math.max(0, item.heatDelta).toFixed(1)} this week` : "collecting signals"}
              </span>
            </div>
            <div className="fans-share-heat-row">
              <span className="fans-share-heat-num">{item.heatQualified ? heat.toFixed(1) : "—"}</span>
              <div className="fans-share-heat-bar" role="presentation">
                <div className="fans-share-heat-fill" style={{ width: `${item.heatQualified ? heatPctFans(heat) : 0}%` }} />
              </div>
            </div>
          </div>

          <div className="fans-share-footer">
            <span className="fans-share-install">
              <span className="fans-share-install-cap">install</span>
              <span className="fans-share-cmd">{shareCommand}</span>
            </span>
            <span className="fans-share-site">onlyharness.com 🌐</span>
          </div>
        </div>

        {/* ---- actions ---- */}
        <div className="fans-share-actions">
          <Btn variant="primary" onClick={() => h.copyText(brag, "Brag text copied", "brag")}>
            {copied ? "✓ Copied!" : "📋 Copy brag text"}
          </Btn>
          <Btn variant="outline" onClick={() => h.closeSurface(surface.id)}>Close</Btn>
        </div>
        <p className="fans-share-fine">
          Community signals aren't safety guarantees — the card only ever shows real numbers. Fork responsibly, cowboy. 🤠
        </p>
      </div>
    </div>
  );
}
