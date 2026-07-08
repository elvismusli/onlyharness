import { useHarness } from "../../core/store";
import type { Surface } from "../../core/useAppNav";
import { Btn } from "./primitives";
import "./publish.css";

/* What the markdown-to-harness import scaffolds — the same "what gets created"
   checklist the Modern/Win98 wizards show, field-for-field, just dressed in the
   friendly Fans voice. Nothing here overstates the result: the eval is honestly
   marked unverified. */
const CREATED: { emoji: string; line: string }[] = [
  { emoji: "📄", line: "harness.yaml with conservative permissions" },
  { emoji: "💬", line: "Agent prompt plus example input & output" },
  { emoji: "🧪", line: "An unverified eval case, ready for hh eval && hh gate" },
  { emoji: "💙", line: "Your creator card on the Explore frontier" }
];

/**
 * Fans Publish surface — the quick markdown scaffold as a compact post box. A full-viewport overlay on the blue wash (rendered on
 * top of the landing by the surface router), driving the SAME shared publish
 * state as every other skin: `importName`, `importMarkdown`, `importStatus`,
 * `importBusy` and `submitImport`.
 *
 * Honest states:
 * - Logged out, the primary pill becomes "Log in to publish" → `openLogon`
 *   (and `submitImport` itself also gates on auth, so this is belt-and-braces).
 * - `importStatus` renders verbatim from the store — no invented success copy.
 * - The scaffolded eval is labelled unverified; the microcopy jokes, the facts
 *   don't.
 */
export function FansPublish({ surface }: { surface: Surface }) {
  const h = useHarness();
  const loggedIn = Boolean(h.user);
  const close = () => h.closeSurface(surface.id);

  return (
    <div className="fa-overlay fans-publish" role="dialog" aria-label="Quick markdown scaffold">
      <div className="fans-publish-card">
        <header className="fans-publish-head">
          <div className="fans-publish-head-main">
            <span className="fans-publish-kicker">💙 New resource</span>
            <h2 className="fans-publish-title">Quick markdown scaffold</h2>
            <p className="fans-publish-sub">
              Paste a rough workflow for a small scaffold. Full skills, plugins, MCP servers,
              command packs and repos with scripts use <b>hh publish-resource</b>.
            </p>
          </div>
          <button type="button" className="fans-publish-close" aria-label="Close" onClick={close}>
            ✕
          </button>
        </header>

        <label className="fans-publish-field">
          <span className="fans-publish-label">Resource name</span>
          <input
            className="fans-publish-name"
            value={h.importName}
            onChange={(event) => h.setImportName(event.target.value)}
            placeholder="customer-research-pipeline"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <label className="fans-publish-field">
          <span className="fans-publish-label">Workflow markdown</span>
          <textarea
            className="fans-publish-md"
            rows={11}
            value={h.importMarkdown}
            onChange={(event) => h.setImportMarkdown(event.target.value)}
            spellCheck={false}
          />
        </label>

        <section className="fans-publish-created">
          <h3 className="fans-publish-created-title">What gets created 🎁</h3>
          <ul className="fans-publish-check">
            {CREATED.map((row) => (
              <li className="fans-publish-check-row" key={row.line}>
                <span className="fans-publish-check-emoji" aria-hidden>
                  {row.emoji}
                </span>
                <span>{row.line}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="fans-publish-actions">
          {loggedIn ? (
            <Btn
              variant="primary"
              className="fans-publish-cta"
              onClick={h.submitImport}
              disabled={h.importBusy}
            >
              {h.importBusy ? "⌛ Publishing…" : "🚀 Create & publish"}
            </Btn>
          ) : (
            <Btn
              variant="primary"
              className="fans-publish-cta"
              onClick={() => h.openLogon("Log in to publish a resource.")}
            >
              🔑 Log in to publish
            </Btn>
          )}

          {h.importStatus ? (
            <span className="fans-publish-status" role="status">
              {h.importStatus}
            </span>
          ) : (
            <span className="fans-publish-hint">
              {loggedIn
                ? "Hosted packages use hh publish-resource."
                : "Publishing needs an account — it's free."}
            </span>
          )}
        </div>

        <p className="fans-publish-fine">
          This web path creates a markdown-derived scaffold. Hosted multi-file packages use{" "}
          <span className="fans-publish-mono">hh publish-resource</span>; verified native packages use eval and gate.
        </p>
      </div>
    </div>
  );
}
