import { superskillInstallCommands } from "../../../core/superskill-install";
import { superskillRuntime } from "../../../generated/superskill-runtime";
import { CopyField } from "../components/CopyField";
import { PageHeading, ShellLink } from "../primitives";

export function AgentGuidePage() {
  const claude = superskillInstallCommands("claude-code");
  const codex = superskillInstallCommands("codex");
  return (
    <main className="ss-content ss-page ss-docs-page">
      <PageHeading eyebrow="agent-first contract">Use SuperSkill from an agent</PageHeading>
      <p className="ss-page-lede">Recommend by task fit and exact evidence. Never treat a selected candidate, copied command, or badge-like label as proof of approval or activation.</p>

      <section className="ss-doc-section" aria-labelledby="ss-agent-bootstrap">
        <h2 id="ss-agent-bootstrap">Bootstrap the shared skill</h2>
        <div className="ss-doc-command-grid">
          <article><h3>Claude Code</h3><CopyField label="Marketplace" value={claude.marketplaceCommand} /><CopyField label="Plugin" value={claude.pluginCommand} /></article>
          <article><h3>Codex CLI</h3><CopyField label="Marketplace" value={codex.marketplaceCommand} /><CopyField label="Plugin" value={codex.pluginCommand} /></article>
        </div>
        <CopyField label={`Verify ${superskillRuntime.cliPackage}@${superskillRuntime.cliVersion}`} value={claude.runtimeCheckCommand} />
      </section>

      <section className="ss-doc-section" aria-labelledby="ss-agent-loop">
        <h2 id="ss-agent-loop">Required agent loop</h2>
        <ol>
          <li>Take the task as local client input; do not place its text in a URL, log, analytics event, or public request.</li>
          <li>Search for task fit, then inspect exact release trust, permissions, compatibility, and limitations.</li>
          <li>Return an honest no-match when no approved release satisfies the task and evidence requirements.</li>
          <li>Show the permission delta and request explicit user consent before managed activation.</li>
          <li>Report Installed, Detected, Loaded, Invoked, and outcome evidence only from the corresponding observed lifecycle step.</li>
        </ol>
      </section>

      <section className="ss-doc-section" aria-labelledby="ss-agent-semantics">
        <h2 id="ss-agent-semantics">Selected and approved are separate lanes</h2>
        <dl className="ss-doc-definitions">
          <div><dt>selected_unreviewed</dt><dd>May appear in the public intake shelf for discovery. It cannot support a trust claim, managed recommendation, or activation.</dd></div>
          <div><dt>approved</dt><dd>Applies only to the exact immutable digest backed by a current review attestation and compatible client evidence.</dd></div>
          <div><dt>blocked</dt><dd>Stale evidence, quarantine, revocation, or missing exact-release eligibility must stop managed handoff.</dd></div>
        </dl>
      </section>

      <section className="ss-doc-section" aria-labelledby="ss-agent-consent">
        <h2 id="ss-agent-consent">Consent boundary</h2>
        <p>Search and trust inspection are read-only. Activation is a separate user decision. Explain newly requested filesystem, network, shell, browser, credential, external-send, money-movement, and user-data powers before asking for consent.</p>
        <p>Never expose tester credentials in browser state or public instructions. Protected recommendation and managed release transport belong in the local client flow.</p>
      </section>

      <aside className="ss-raw-links" aria-label="Machine-readable documentation">
        <strong>Full machine contract</strong>
        <span><ShellLink href="/AGENTS.md">Raw AGENTS.md</ShellLink><ShellLink href="/llms.txt">Raw llms.txt</ShellLink></span>
      </aside>
    </main>
  );
}
