import { useHarness } from "../../core/store";
import type { Surface } from "../../core/useAppNav";
import { Btn } from "./primitives";

/* What the markdown-to-harness import scaffolds — mirrors the Win98 wizard's
   "what gets created" checklist field-for-field. */
const CREATED = [
  "harness.yaml with conservative permissions",
  "Agent prompt plus example input/output",
  "Unverified eval case ready for hh eval && hh gate",
  "A registry card on the Explore frontier"
];

/**
 * Modern Publish surface — the quick markdown scaffold rebuilt on Modern tokens. A
 * full-viewport layer above Explore (same `.ohd` canvas + top-right glow) that
 * drives the shared publish state: `importName`, `importMarkdown`, `importStatus`
 * and `submitImport`. Logged out it swaps the accent Publish action for "Log on
 * to publish" (`openLogon`), exactly like the Win98 `PublishBody`; `submitImport`
 * itself also gates on auth, so this is belt-and-braces.
 */
export function ModernPublish({ surface }: { surface: Surface }) {
  const h = useHarness();
  const loggedIn = Boolean(h.user);

  return (
    <main className="oh-main ohd oh-publish">
      <button type="button" className="ohd-back" onClick={() => h.closeSurface(surface.id)}>
        ← Explore
      </button>

      <header className="ohd-head">
        <div className="ohd-head-main">
          <div className="ohd-owner">New Resource Wizard</div>
          <h1 className="ohd-title">Quick markdown scaffold</h1>
          <p className="ohd-summary">
            Paste a rough workflow when you want a small scaffold. For a full skill, plugin, MCP server,
            command pack or repo with scripts, use the package path: npx onlyharness@latest
            publish-resource ./repo --name my-agent-resource.
          </p>
        </div>
      </header>

      <div className="oh-publish-grid">
        <section className="ohd-panel">
          <label className="oh-pub-field">
            <span className="ohd-h" style={{ marginTop: 0 }}>Resource name</span>
            <input
              className="ohd-input oh-pub-name"
              value={h.importName}
              onChange={(event) => h.setImportName(event.target.value)}
              placeholder="customer-research-pipeline"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label className="oh-pub-field">
            <span className="ohd-h">Workflow markdown</span>
            <textarea
              className="oh-pub-md"
              rows={12}
              value={h.importMarkdown}
              onChange={(event) => h.setImportMarkdown(event.target.value)}
              spellCheck={false}
            />
          </label>

          <div className="oh-pub-actions">
            {loggedIn ? (
              <Btn variant="primary" size="lg" onClick={h.submitImport} disabled={h.importBusy}>
                {h.importBusy ? "⌛ Publishing…" : "📦 Publish scaffold"}
              </Btn>
            ) : (
              <>
                <Btn variant="primary" size="lg" onClick={() => h.openLogon("Log on to publish a resource.")}>
                  🔑 Log on to publish
                </Btn>
                <span className="ohd-fine">Publishing needs an account.</span>
              </>
            )}
            {h.importStatus && <span className="oh-pub-status">{h.importStatus}</span>}
          </div>
        </section>

        <aside className="ohd-aside">
          <section className="ohd-box">
            <h4 className="ohd-box-title">What gets created</h4>
            <ul className="oh-pub-check">
              {CREATED.map((line) => (
                <li className="oh-pub-check-row" key={line}>
                  <span className="oh-pub-check-mark" aria-hidden>✓</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </section>
          <p className="ohd-fine">
            This web path creates a markdown-derived scaffold. Hosted multi-file packages use{" "}
            <span className="oh-pub-mono">hh publish-resource</span>; verified native packages use eval and gate.
          </p>
        </aside>
      </div>
    </main>
  );
}
