import { heatPct, isoWeek, keyFor } from "../../core/format";
import { useHarness } from "../../core/store";
import type { RegistryItem } from "../../core/types";
import type { Surface } from "../../core/useAppNav";
import { Avatar, Btn, Pill, Stat } from "./primitives";

import "./leaderboard.css";

/**
 * Fans Leaderboard surface — the "Top creators this week" board in the friendly
 * sky-blue parody skin. It renders the real `leaderboard` (RegistryItem[]) as a
 * ranked, podium-flavoured list: rank #, round avatar, title, `@handle`, the heat
 * number with 🔥, a ▲/▼ `heatDelta` chip, and a heat bar. Clicking a card opens
 * that harness (`openHarness`).
 *
 * Same data + wiring as the Modern leaderboard (`ModernLeaderboard`), just a
 * different look. Every state stays honest:
 * - the board is hidden until harnesses have enough real social / verified-install
 *   signals (empty `leaderboard`);
 * - heat, the delta chip and the bar only render for `heatQualified` rows, so an
 *   unqualified entry never shows a fabricated number.
 *
 * IP note: original parody surface — own copy, no third-party marks. Matches the
 * landing's "🏆 Top creator this week" badge energy.
 */

/* Medal emoji for the top three ranks; everyone else gets their numeral. Purely
   decorative rank ornament — asserts nothing about the harness itself. */
const MEDALS = ["🥇", "🥈", "🥉"] as const;

/* Rotating friendly avatar tints/emoji, indexed by rank. Decorative only (a
   registry item carries no icon), so this never claims anything real. Mirrors the
   landing collage's palette so the two Fans surfaces feel like one product. */
const AVATAR_EMOJI = ["🔬", "🧩", "🛡️", "🕹️", "🤖", "📊", "🧠", "⚙️"] as const;
const AVATAR_BG = ["#e5f6ff", "#efe9ff", "#e6faed", "#e5f9f7", "#fdeede", "#eaf0ff"] as const;

export function FansLeaderboard({ surface }: { surface?: Surface } = {}) {
  const h = useHarness();
  const rows: RegistryItem[] = h.leaderboard;
  const week = isoWeek(new Date());

  /* Close back to the landing/Explore. When mounted as a real surface we close
     that surface by id; standalone (no surface) we just fall back to closing the
     leaderboard kind so the button is never dead. */
  const close = () => h.closeSurface(surface?.id ?? "leaderboard");

  return (
    <div className="fans-leaderboard fa-overlay" role="dialog" aria-label="Top creators this week">
      <div className="fans-leaderboard-card">
        <button type="button" className="fans-leaderboard-back" onClick={close}>
          ← Back to Explore
        </button>

        <header className="fans-leaderboard-head">
          <Pill tone="dark">🏆 Top creators this week</Pill>
          <h2 className="fans-leaderboard-title">
            Top <b>creators</b> this week
          </h2>
          <p className="fans-leaderboard-sub">
            The hottest harnesses right now, ranked by Harness Heat — a blend of eval, risk,
            freshness, stars, forks, thread replies and Claude Code install confirms. Not a safety
            guarantee, just the vibe check. 💙
          </p>
          <div className="fans-leaderboard-week">ISO week {week}</div>
        </header>

        {rows.length === 0 ? (
          <div className="fans-leaderboard-empty">
            <div className="fans-leaderboard-empty-emoji" aria-hidden>
              🫧
            </div>
            <div className="fans-leaderboard-empty-title">No creators on the board yet</div>
            <p className="fans-leaderboard-empty-body">
              The leaderboard stays hidden until harnesses have enough real social or verified
              install signals. No fake heat here, cowboy. 🤠
            </p>
          </div>
        ) : (
          <ol className="fans-leaderboard-list">
            {rows.map((item, index) => {
              const qualified = item.heatQualified;
              const up = item.heatDelta >= 0;
              const emoji = AVATAR_EMOJI[index % AVATAR_EMOJI.length];
              const bg = AVATAR_BG[index % AVATAR_BG.length];
              const rankLabel = index < MEDALS.length ? MEDALS[index] : `#${index + 1}`;
              return (
                <li key={keyFor(item)}>
                  <button
                    type="button"
                    className={`fans-leaderboard-row${index === 0 ? " is-top" : ""}${
                      index < MEDALS.length ? " is-podium" : ""
                    }`}
                    onClick={() => h.openHarness(item)}
                    title={`Open ${item.title}`}
                  >
                    <span className="fans-leaderboard-rank" aria-hidden>
                      {rankLabel}
                    </span>
                    <Avatar emoji={emoji} bg={bg} size={44} />
                    <div className="fans-leaderboard-main">
                      <div className="fans-leaderboard-titleline">
                        <span className="fans-leaderboard-name">{item.title}</span>
                        <span className="fans-leaderboard-handle">@{item.ownerLabel || item.owner}</span>
                      </div>
                      <div className="fans-leaderboard-bar" aria-hidden>
                        <div
                          className="fans-leaderboard-bar-fill"
                          style={{ width: `${qualified ? heatPct(item.heat) : 0}%` }}
                        />
                      </div>
                    </div>
                    <div className="fans-leaderboard-heatcol">
                      <span className="fans-leaderboard-heat">
                        {qualified ? (
                          <>
                            🔥 <b>{item.heat.toFixed(1)}</b>
                          </>
                        ) : (
                          <span className="fans-leaderboard-heat-pending">building heat…</span>
                        )}
                      </span>
                      {qualified ? (
                        <Stat color={up ? "var(--fa-eval-green)" : "#e0555f"}>
                          {up ? "▲" : "▼"} {Math.abs(item.heatDelta).toFixed(1)}
                        </Stat>
                      ) : null}
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>
        )}

        <p className="fans-leaderboard-fine">
          Community signals are not safety guarantees. Always read the eval evidence and the safety
          review before you subscribe.
        </p>

        <div className="fans-leaderboard-actions">
          <Btn variant="outline" onClick={close}>
            ← Back to Explore
          </Btn>
        </div>
      </div>
    </div>
  );
}
