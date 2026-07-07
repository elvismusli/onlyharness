import { isoWeek, keyFor } from "../../core/format";
import { useHarness } from "../../core/store";
import type { RegistryItem } from "../../core/types";
import type { Surface } from "../../core/useAppNav";
import { Btn } from "./primitives";

/* Modern heat percentage matches the Explore card / detail meter (heat / 24) so
   the leaderboard bar agrees with the rest of the Modern skin. */
function heatPctModern(heat: number): number {
  return Math.min(100, Math.round((heat / 24) * 100));
}

/**
 * Modern Leaderboard surface — the Wild West leaderboard rebuilt on Modern
 * tokens. A full-viewport layer above Explore (same `.ohd` canvas + glow) that
 * renders the real `leaderboard` (RegistryItem[]) as ranked rows: rank #, title,
 * a ▲/▼ heatDelta chip, the heat number with 🔥, and a heat bar. Clicking a row
 * opens that harness (`openHarness`).
 *
 * Every state is honest: the leaderboard is hidden until harnesses have enough
 * real social / verified-install signals, and heat is only shown for qualified
 * rows — no fabricated numbers.
 */
export function ModernLeaderboard({ surface }: { surface: Surface }) {
  const h = useHarness();
  const rows: RegistryItem[] = h.leaderboard;
  const week = isoWeek(new Date());

  return (
    <main className="oh-main ohd oh-lb">
      <button type="button" className="ohd-back" onClick={() => h.closeSurface(surface.id)}>
        ← Explore
      </button>

      <header className="ohd-head">
        <div className="ohd-head-main">
          <div className="ohd-owner">Harness Heat · ISO week {week}</div>
          <h1 className="ohd-title">🔥 Leaderboard</h1>
          <p className="ohd-summary">
            Qualified harness heat for this week. Heat blends eval, risk, freshness, stars, fork
            records, thread replies and Claude Code install confirms.
          </p>
        </div>
      </header>

      <div className="oh-lb-wrap">
        {rows.length === 0 ? (
          <div className="oh-empty">
            Leaderboard is hidden until harnesses have enough real social or verified install signals.
          </div>
        ) : (
          <ol className="oh-lb-rows">
            {rows.map((item, index) => {
              const qualified = item.heatQualified;
              const up = item.heatDelta >= 0;
              return (
                <li key={keyFor(item)}>
                  <button
                    type="button"
                    className={`oh-lb-row${index === 0 ? " top" : ""}`}
                    onClick={() => h.openHarness(item)}
                  >
                    <span className="oh-lb-rank">{index + 1}</span>
                    <div className="oh-lb-main">
                      <div className="oh-lb-titleline">
                        <span className="oh-lb-title">{item.title}</span>
                        <span className="oh-lb-author">by @{item.ownerLabel || item.owner}</span>
                      </div>
                      <div className="oh-lb-bar">
                        <div
                          className="oh-lb-bar-fill"
                          style={{ width: `${qualified ? heatPctModern(item.heat) : 0}%` }}
                        />
                      </div>
                    </div>
                    {qualified && (
                      <span className={`oh-lb-delta ${up ? "up" : "down"}`}>
                        {up ? "▲" : "▼"} {Math.abs(item.heatDelta).toFixed(1)}
                      </span>
                    )}
                    <span className="oh-lb-heat">{qualified ? item.heat.toFixed(1) : "—"} 🔥</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}

        <p className="ohd-fine oh-lb-fine">Community signals are not safety guarantees.</p>

        <div style={{ marginTop: 18 }}>
          <Btn variant="secondary" onClick={() => h.closeSurface(surface.id)}>← Back to Explore</Btn>
        </div>
      </div>
    </main>
  );
}
