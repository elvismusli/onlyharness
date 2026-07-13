import { superskillInstallCommands } from "../../../core/superskill-install";
import { superskillRuntime } from "../../../generated/superskill-runtime";
import { CopyField } from "../components/CopyField";
import { PageHeading, ShellLink } from "../primitives";

export function DocsPage() {
  const claude = superskillInstallCommands("claude-code");
  const codex = superskillInstallCommands("codex");
  return (
    <main className="ss-content ss-page ss-docs-page">
      <PageHeading eyebrow="human documentation">Install and use SuperSkill</PageHeading>
      <p className="ss-page-lede">SuperSkill keeps discovery in the browser and activation in your existing terminal agent. The client shows exact-release evidence and asks for explicit consent before managed activation.</p>

      <section className="ss-doc-section" aria-labelledby="ss-doc-install">
        <h2 id="ss-doc-install">Install in your client</h2>
        <p>Use one client path, start a fresh session, then describe the task in plain text. The shared runtime is pinned to <code>{superskillRuntime.cliPackage}@{superskillRuntime.cliVersion}</code>.</p>
        <div className="ss-doc-command-grid">
          <article><h3>Claude Code</h3><CopyField label="Add marketplace" value={claude.marketplaceCommand} /><CopyField label="Install plugin" value={claude.pluginCommand} /></article>
          <article><h3>Codex CLI</h3><CopyField label="Add marketplace" value={codex.marketplaceCommand} /><CopyField label="Install plugin" value={codex.pluginCommand} /></article>
        </div>
        <CopyField label="Verify the exact OnlyHarness runtime" value={claude.runtimeCheckCommand} />
        <p className="ss-honest-state">Copying commands does not prove that a plugin is Installed, Detected, Loaded, or Invoked. Verify the command result in the terminal and start a new client session.</p>
      </section>

      <section className="ss-doc-section" aria-labelledby="ss-doc-use">
        <h2 id="ss-doc-use">Use the showroom safely</h2>
        <ol>
          <li>Describe a task without secrets or credentials.</li>
          <li>Inspect the exact release, named checks, permissions, evidence dates, and limitations.</li>
          <li>Continue in the client only when handoff is available.</li>
          <li>Review the permission delta and explicitly consent before activation.</li>
        </ol>
        <p>Task text stays in browser memory until you copy it into the terminal. The public showroom does not send it to recommendation APIs, analytics, URLs, or storage.</p>
      </section>

      <section className="ss-doc-section" aria-labelledby="ss-doc-trust">
        <h2 id="ss-doc-trust">Understand trust states</h2>
        <dl className="ss-doc-definitions">
          <div><dt>Selected · review pending</dt><dd>Discovery-only intake candidate. It is not approved, verified, recommended, or available for managed activation.</dd></div>
          <div><dt>Approved exact release</dt><dd>The immutable artifact digest has current named evidence and may expose managed client handoff.</dd></div>
          <div><dt>Quarantined or revoked</dt><dd>The trust report remains visible for honest shared links, but managed activation fails closed.</dd></div>
        </dl>
      </section>

      <section className="ss-doc-section" aria-labelledby="ss-doc-help">
        <h2 id="ss-doc-help">Troubleshooting</h2>
        <ul>
          <li>If the plugin command is unavailable, confirm Node.js, npm, and your terminal client are available.</li>
          <li>Run the exact runtime check shown above instead of substituting another CLI version.</li>
          <li>Start a new client session after install so the shared SuperSkill skill can be discovered.</li>
          <li>If a release is blocked, return to its trust report or choose a currently approved alternative.</li>
        </ul>
      </section>

      <aside className="ss-raw-links" aria-label="Machine-readable documentation">
        <strong>Machine-readable sources</strong>
        <span><ShellLink href="/llms.txt">Raw llms.txt</ShellLink><ShellLink href="/AGENTS.md">Raw AGENTS.md</ShellLink></span>
      </aside>
    </main>
  );
}
