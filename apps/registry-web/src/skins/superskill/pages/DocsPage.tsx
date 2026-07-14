import { superskillInstallHandoff } from "../../../core/superskill-install";
import { CopyField } from "../components/CopyField";
import { StatePanel } from "../components/StatePanel";
import { PageHeading, ShellLink } from "../primitives";

export function DocsPage() {
  const handoff = superskillInstallHandoff();
  return (
    <main className="ss-content ss-page ss-docs-page">
      <PageHeading eyebrow="human documentation">Install and use SuperSkill</PageHeading>
      <p className="ss-page-lede">SuperSkill keeps discovery in the browser and activation in your existing terminal agent. The client shows exact-release evidence and asks for explicit consent before managed activation.</p>

      <section className="ss-doc-section" aria-labelledby="ss-doc-install">
        <h2 id="ss-doc-install">Install in your client</h2>
        <p>The installer is pinned to one integrity-pinned public release.</p>
        {handoff.status === "available" ? <><CopyField label="Universal install command" value={handoff.installCommand} /><p>The installer transactionally writes the matching project-native skill root and merges one project-local <code>superskill_local</code> MCP entry into <code>.mcp.json</code> or <code>.codex/config.toml</code>. An exact capability link also writes one private pending handoff. Existing unrelated config is preserved; collisions or rollback faults fail closed. No token is stored.</p><p>Ambiguous or absent client detection fails closed; choose <code>--target</code> explicitly or use <code>--all</code> only when both adapters are intended.</p></> : <StatePanel kind="blocked" title="Install command not published" reason={handoff.reason} next="Wait until the exact npm release and official integrity are both published. Do not use @latest or an unverified substitute." />}
        <p className="ss-honest-state">Copying commands does not prove that a plugin is Installed, Detected, Loaded, or Invoked. Verify the command result in the terminal and start a new client session.</p>
      </section>

      <section className="ss-doc-section" aria-labelledby="ss-doc-use">
        <h2 id="ss-doc-use">Evaluate a resource before you activate it</h2>
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
          <li>If the install command is not published, wait for the exact runtime and official integrity pin. Local Node.js or npm changes cannot bypass this gate.</li>
          <li>Append <code>--dry-run</code> to verify the pinned manifest and target plan without writing.</li>
          <li>Start a new client session after install and approve the project-local MCP through the client's normal trust prompt.</li>
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
