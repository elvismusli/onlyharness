import { useMemo, useRef, useState, type FormEvent } from "react";

import { apiUrl } from "../../../core/constants";
import { buildSuperSkillRoute } from "../../../core/superskill-route";
import { useHarness } from "../../../core/store";
import { PageHeading, ShellLink, SSButton } from "../primitives";

type PublishResult = {
  resourceId: string;
  version: string;
  artifactDigest: string;
  trust: "unreviewed";
  replay: boolean;
  archiveUrl: string;
  verified: false;
};

export function PublishPage() {
  const h = useHarness();
  const [name, setName] = useState("my-agent-skill");
  const [version, setVersion] = useState("0.1.0");
  const [title, setTitle] = useState("My agent skill");
  const [summary, setSummary] = useState("A focused workflow for a repeatable agent task.");
  const [instructions, setInstructions] = useState("# My agent skill\n\nDescribe when to use this skill, the steps to follow, safety boundaries, and the expected output.");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [published, setPublished] = useState<PublishResult | null>(null);
  const retry = useRef<{ signature: string; key: string } | undefined>(undefined);
  const confirmed = Boolean(h.user?.email_confirmed_at);
  const canPublish = Boolean(h.accessToken && confirmed && !busy);
  const payload = useMemo(() => ({
    name: name.trim(),
    version: version.trim(),
    title: title.trim(),
    summary: summary.trim(),
    resourceType: "skill",
    worksWith: ["claude-code", "codex"],
    tags: ["skill", "community"],
    files: [
      { path: "SKILL.md", content: skillDocument(name, summary, instructions) },
      { path: "README.md", content: `# ${title.trim()}\n\n${summary.trim()}\n` }
    ]
  }), [name, version, title, summary, instructions]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!h.accessToken || !confirmed || busy) return;
    const signature = JSON.stringify(payload);
    if (!retry.current || retry.current.signature !== signature) {
      retry.current = { signature, key: `web-${crypto.randomUUID()}` };
    }
    setBusy(true);
    setStatus("Publishing immutable release…");
    setPublished(null);
    try {
      const response = await fetch(`${apiUrl}/imports/resource-package`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${h.accessToken}` },
        body: JSON.stringify({ ...payload, idempotencyKey: retry.current.key })
      });
      const body = await response.json().catch(() => ({})) as Partial<PublishResult> & { error?: string; code?: string; next?: string };
      if (!response.ok) {
        setStatus([body.error || `Publish failed (${response.status}).`, body.code, body.next].filter(Boolean).join(" · "));
        return;
      }
      if (!body.resourceId || !body.version || !body.artifactDigest || !body.archiveUrl) {
        setStatus("Publish completed, but the API returned an invalid release payload.");
        return;
      }
      setPublished(body as PublishResult);
      setStatus(body.replay ? "The same immutable release was already published; no duplicate was created." : "Release published.");
    } catch {
      setStatus("The result is unknown because the API became unreachable. Retry without changing the form; the same idempotency key will be reused.");
    } finally {
      setBusy(false);
    }
  }

  if (!h.user) {
    return <main className="ss-content ss-page ss-publish-page"><PageHeading eyebrow="Publish">Publish a skill</PageHeading><p className="ss-page-lede">Sign in with a confirmed account to publish an immutable, unreviewed skill release.</p><section className="ss-publish-card"><ShellLink href="#/superskill/account">Sign in or create account</ShellLink></section></main>;
  }

  return (
    <main className="ss-content ss-page ss-publish-page">
      <PageHeading eyebrow="Publish">Publish a skill</PageHeading>
      <p className="ss-page-lede">Each version is immutable. Publishing never grants a reviewed or verified badge; catalog review is a separate process.</p>
      {!confirmed ? <p className="ss-auth-notice">Confirm your email before publishing. Then sign in again to refresh the session.</p> : null}
      <form className="ss-publish-card ss-publish-form" onSubmit={submit}>
        <div className="ss-publish-grid">
          <label>Package name<input required pattern="[a-z0-9][a-z0-9-]{1,62}" value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Version<input required pattern="(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)(-([0-9A-Za-z.]|-)+)?" value={version} onChange={(event) => setVersion(event.target.value)} /></label>
        </div>
        <label>Title<input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>Summary<textarea required rows={3} maxLength={500} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        <label>SKILL.md instructions<textarea required rows={14} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
        <div className="ss-publish-actions"><span>Trust after publish: <strong>unreviewed</strong></span><SSButton type="submit" disabled={!canPublish}>{busy ? "Publishing…" : "Publish release"}</SSButton></div>
        {status ? <p className="ss-publish-status" role="status">{status}</p> : null}
      </form>
      {published ? (
        <section className="ss-publish-result" aria-labelledby="ss-published-release">
          <span className="ss-account-state ss-account-state--pending">Unreviewed</span>
          <h2 id="ss-published-release">{published.resourceId}@{published.version}</h2>
          <p><code>{published.artifactDigest}</code></p>
          <div className="ss-publish-result-actions"><ShellLink href={buildSuperSkillRoute({ name: "resource", resourceId: published.resourceId })}>View published skill</ShellLink><a className="ss-link" href={published.archiveUrl}>Download this release</a></div>
          <p>To publish an update, change the version and content, then publish again. Reusing a version with different bytes fails closed.</p>
        </section>
      ) : null}
    </main>
  );
}

function skillDocument(name: string, summary: string, instructions: string): string {
  const safeName = name.trim().toLowerCase();
  const safeDescription = summary.trim().replace(/[\r\n]+/g, " ").replaceAll('"', "'");
  return `---\nname: ${safeName}\ndescription: "${safeDescription}"\n---\n\n${instructions.trim()}\n`;
}
