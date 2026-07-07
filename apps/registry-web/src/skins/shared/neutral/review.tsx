import type { ReactNode } from "react";

import { useHarness } from "../../../core/store";

/*
 * Shared-neutral Maintainer Review — the "serious" review surface rendered
 * identically in every skin (only the `--neutral-*` palette changes). Mirrors the
 * Win98 `ReviewBody` field-for-field: the demo-vs-connected-source intro, the
 * 🛡️ risk-after-merge plate (with risk delta), the semantic-diff change rows
 * (severity chip + area + message), and a right panel with the gate-command <pre>
 * + Copy commands and a Merge-policy InfoLine list.
 *
 * Pure consumer of `useHarness()`: the harness (`knownItems[surface.key]`) and its
 * PR-review payload (`details[surface.key].prReview`) come from the store, as does
 * `copyText`/`copiedTag`. Review is a preview — merge decisions still require the
 * eval gate and a human. Loading state shows until the detail (and its diff) load.
 */

/** One label/value line in a neutral box (mono value, hairline rows). */
function InfoLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="ohn-info">
      <span className="ohn-info-k">{label}</span>
      <span className="ohn-info-v">{value}</span>
    </div>
  );
}

export function NeutralReview({ surfaceKey }: { surfaceKey?: string }) {
  const h = useHarness();
  const item = surfaceKey ? h.knownItems[surfaceKey] : undefined;
  const detail = surfaceKey ? h.details[surfaceKey] : undefined;
  const review = detail?.prReview;
  const diff = review?.diff;

  const name = item?.name ?? "deep-market-researcher";
  const gateCommands = `hh validate seed-harnesses/${name} --strict\nhh eval seed-harnesses/${name}\nhh gate --dir seed-harnesses/${name}`;
  const copied = h.copiedTag === "neutral-review";

  function copyCommands() {
    void h.copyText(gateCommands, "Gate commands copied", "neutral-review");
  }

  return (
    <div className="oh-neutral">
      <header className="ohn-head">
        <div className="ohn-owner">Maintainer Review</div>
        <h2 className="ohn-title">{item?.title ?? "Maintainer review"}</h2>
      </header>

      <p className="ohn-intro">
        Local maintainer review preview for <b>{item?.title ?? "…"}</b>.
        {review
          ? review.demo
            ? " Generated from a local variant; it is not an open pull request."
            : " Backed by a connected review source."
          : " Loading review source…"}
      </p>

      <div className="ohn-grid">
        <div className="ohn-col">
          <div className="ohn-risk-plate">
            <span className="ohn-shield">🛡️</span>
            <div>
              <div className="ohn-risk-head">Risk after merge: {diff?.riskTier ?? "…"}</div>
              <div className="ohn-risk-sub">
                Risk delta {diff ? (diff.riskDelta >= 0 ? `+${diff.riskDelta}` : diff.riskDelta) : "…"} · review required before release
              </div>
            </div>
          </div>

          {(diff?.changes ?? []).map((change, index) => (
            <div className="ohn-change-row" key={`${change.area}-${index}`}>
              <span className={`ohn-severity ${change.severity.toLowerCase()}`}>{change.severity}</span>
              <div className="ohn-row-main">
                <span className="ohn-change-area">{change.area}</span>
                <p className="ohn-change-msg">{change.message}</p>
              </div>
            </div>
          ))}
          {!detail && <div className="ohn-empty">Loading semantic diff…</div>}
        </div>

        <aside className="ohn-aside">
          <section className="ohn-box">
            <h4 className="ohn-box-title">Gate commands</h4>
            <pre className="ohn-pre">{gateCommands}</pre>
            <div className="ohn-btnrow">
              <button type="button" className="ohn-btn ohn-btn-primary" onClick={copyCommands}>
                {copied ? "✓ Copied" : "Copy commands"}
              </button>
            </div>
          </section>
          <section className="ohn-box">
            <h4 className="ohn-box-title">Merge policy</h4>
            <InfoLine label="Source" value={review?.source ?? "loading"} />
            <InfoLine label="Eval gate" value="must pass" />
            <InfoLine label="Risk" value="no new HIGH" />
            <InfoLine label="Permissions" value="reviewed by human" />
            <InfoLine label="Next" value={review?.next ?? "loading"} />
          </section>
        </aside>
      </div>
    </div>
  );
}
