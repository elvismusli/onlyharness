import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { apiUrl } from "../../../core/constants";
import { buildSuperSkillRoute } from "../../../core/superskill-route";
import { useHarness } from "../../../core/store";
import { CopyField } from "../components/CopyField";
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

type PublishResourceType = "skill" | "workflow" | "harness";
type PublishFile = { path: string; content: string };

const MAX_FILES = 120;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

export function PublishPage() {
  const h = useHarness();
  const [name, setName] = useState("my-agent-skill");
  const [version, setVersion] = useState("0.1.0");
  const [title, setTitle] = useState("My agent skill");
  const [summary, setSummary] = useState("A focused workflow for a repeatable agent task.");
  const [resourceType, setResourceType] = useState<PublishResourceType>("skill");
  const [instructions, setInstructions] = useState("# My agent skill\n\nDescribe when to use this skill, the steps to follow, safety boundaries, and the expected output.");
  const [uploadedFiles, setUploadedFiles] = useState<PublishFile[]>([]);
  const [uploadStatus, setUploadStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [published, setPublished] = useState<PublishResult | null>(null);
  const retry = useRef<{ signature: string; key: string } | undefined>(undefined);
  const confirmed = Boolean(h.user?.email_confirmed_at);
  const canPublish = Boolean(h.accessToken && confirmed && !busy);
  const destinationWorkspace = h.workspaceCatalog?.workspace.slug ?? storedWorkspaceSlug();
  const payload = useMemo(() => ({
    name: name.trim(),
    version: version.trim(),
    title: title.trim(),
    summary: summary.trim(),
    resourceType,
    worksWith: ["claude-code", "codex"],
    tags: [resourceType, "community"],
    files: packageFiles(uploadedFiles, resourceType, name, title, summary, instructions)
  }), [name, version, title, summary, resourceType, instructions, uploadedFiles]);

  async function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!selected.length) return;
    setUploadStatus("Reading repository folder…");
    try {
      const files = await readPublishFiles(selected);
      setUploadedFiles(files);
      setUploadStatus(`${files.length} text file${files.length === 1 ? "" : "s"} ready. Review the type, name and version before publishing.`);
    } catch (error) {
      setUploadedFiles([]);
      setUploadStatus(error instanceof Error ? error.message : "Repository files could not be read.");
    }
  }

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
      <PageHeading eyebrow="Publish">Publish an agent resource</PageHeading>
      <p className="ss-page-lede">Upload a repository folder or author a skill here. Each public release is immutable. Publishing never grants a reviewed or verified badge; catalog review is separate.</p>
      {!confirmed ? <p className="ss-auth-notice">Confirm your email before publishing. Then sign in again to refresh the session.</p> : null}
      <form className="ss-publish-card ss-publish-form" onSubmit={submit}>
        <div className="ss-publish-grid">
          <label>Resource name<input required pattern="[a-z0-9][a-z0-9-]{1,62}" value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Version<input required pattern="(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)(-([0-9A-Za-z.]|-)+)?" value={version} onChange={(event) => setVersion(event.target.value)} /></label>
        </div>
        <label>Resource type<select value={resourceType} onChange={(event) => setResourceType(event.target.value as PublishResourceType)}><option value="skill">Skill — native Codex/Claude install</option><option value="workflow">Workflow — archive and catalog</option><option value="harness">Harness — archive and catalog</option></select></label>
        <label>Title<input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>Summary<textarea required rows={3} maxLength={500} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        <fieldset className="ss-publish-upload">
          <legend>Repository files</legend>
          <p>Select the repository folder containing markdown, manifests, prompts or scripts. Secret, binary, build and dependency paths are rejected.</p>
          <input aria-label="Repository files" type="file" multiple accept=".md,.mdx,.txt,.yaml,.yml,.json,.jsonc,.toml,.xml,.js,.mjs,.cjs,.ts,.tsx,.jsx,.py,.sh,.bash,.zsh,.fish,.rb,.go,.rs,.java,.cs,.php,.lua,.sql,.css,.html" onChange={(event) => void chooseFiles(event)} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
          {uploadStatus ? <p className="ss-publish-status" role="status">{uploadStatus}</p> : null}
          {uploadedFiles.length ? <><ul className="ss-publish-file-list">{uploadedFiles.slice(0, 12).map((file) => <li key={file.path}><code>{file.path}</code></li>)}</ul>{uploadedFiles.length > 12 ? <p>+ {uploadedFiles.length - 12} more files</p> : null}<SSButton variant="secondary" type="button" onClick={() => { setUploadedFiles([]); setUploadStatus(""); }}>Use editor instead</SSButton></> : null}
        </fieldset>
        {!uploadedFiles.length ? <label>{resourceType === "skill" ? "SKILL.md instructions" : "Entry instructions"}<textarea required rows={14} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label> : null}
        {resourceType !== "skill" ? <p className="ss-auth-notice">Workflow and harness resources can be shared and downloaded. Native plugin installation requires a skill resource with a root <code>SKILL.md</code>.</p> : null}
        <div className="ss-publish-actions"><span>Trust after publish: <strong>unreviewed</strong></span><SSButton type="submit" disabled={!canPublish}>{busy ? "Publishing…" : "Publish release"}</SSButton></div>
        {status ? <p className="ss-publish-status" role="status">{status}</p> : null}
      </form>
      {published ? (
        <section className="ss-publish-result" aria-labelledby="ss-published-release">
          <span className="ss-account-state ss-account-state--pending">Unreviewed</span>
          <h2 id="ss-published-release">{published.resourceId}@{published.version}</h2>
          <CopyField label="Artifact digest" value={published.artifactDigest} />
          <div className="ss-publish-result-actions"><ShellLink href={buildSuperSkillRoute({ name: "resource", resourceId: published.resourceId, version: published.version })}>View exact published release</ShellLink><a className="ss-link" href={published.archiveUrl}>Download this exact release</a>{destinationWorkspace ? <ShellLink href={workspaceApprovalHref(destinationWorkspace, published.resourceId, published.version, published.artifactDigest)}>Add to @{destinationWorkspace}</ShellLink> : null}</div>
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

function packageFiles(uploaded: PublishFile[], resourceType: PublishResourceType, name: string, title: string, summary: string, instructions: string): PublishFile[] {
  if (!uploaded.length) {
    const entryPath = resourceType === "harness" ? "README.md" : resourceType === "workflow" ? "workflow.md" : "SKILL.md";
    return [
      { path: entryPath, content: resourceType === "skill" ? skillDocument(name, summary, instructions) : `${instructions.trim()}\n` },
      ...(entryPath === "README.md" ? [] : [{ path: "README.md", content: `# ${title.trim()}\n\n${summary.trim()}\n` }])
    ];
  }
  if (resourceType !== "skill") return uploaded;
  const rootSkill = uploaded.find((file) => file.path.toLowerCase() === "skill.md");
  if (rootSkill) {
    const body = skillBody(rootSkill.content) || repositorySkillInstructions(uploaded.filter((file) => file !== rootSkill), title, summary);
    return uploaded.map((file) => file === rootSkill
      ? { ...file, path: "SKILL.md", content: skillDocument(name, summary, body) }
      : file);
  }
  return [{ path: "SKILL.md", content: skillDocument(name, summary, repositorySkillInstructions(uploaded, title, summary)) }, ...uploaded];
}

function skillBody(content: string): string {
  const normalized = content.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) return normalized.trim();
  const end = normalized.indexOf("\n---\n", 4);
  return (end === -1 ? normalized : normalized.slice(end + 5)).trim();
}

function repositorySkillInstructions(files: PublishFile[], title: string, summary: string): string {
  const markdown = files.map((file) => file.path).filter((file) => /\.mdx?$/i.test(file));
  const entry = markdown.find((file) => /(^|\/)workflow\.md$/i.test(file))
    ?? markdown.find((file) => /(^|\/)agents\.md$/i.test(file))
    ?? markdown.find((file) => /(^|\/)readme\.md$/i.test(file))
    ?? markdown[0]
    ?? files[0]?.path
    ?? "README.md";
  const inventory = markdown.length ? markdown.slice(0, 40) : files.slice(0, 40).map((file) => file.path);
  return [
    `# ${title.trim()}`,
    "",
    summary.trim(),
    "",
    `Start with \`${entry}\` and follow its workflow in order. Resolve referenced supporting files relative to this skill directory.`,
    "",
    "Included workflow and context files:",
    ...inventory.map((file) => `- \`${file}\``),
    "",
    "Do not invent missing steps or credentials. Stop and explain any unresolved prerequisite before acting."
  ].join("\n");
}

async function readPublishFiles(files: File[]): Promise<PublishFile[]> {
  if (files.length > MAX_FILES) throw new Error(`A release can contain at most ${MAX_FILES} files.`);
  const rawPaths = files.map((file) => ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replaceAll("\\", "/"));
  const commonRoot = rawPaths.every((file) => file.includes("/")) && new Set(rawPaths.map((file) => file.split("/", 1)[0])).size === 1
    ? rawPaths[0]!.split("/", 1)[0]!
    : "";
  let total = 0;
  const result: PublishFile[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    const rawPath = rawPaths[index]!;
    const filePath = commonRoot ? rawPath.slice(commonRoot.length + 1) : rawPath;
    if (!safeBrowserPublishPath(filePath)) throw new Error(`Unsupported or unsafe repository path: ${filePath || rawPath}`);
    if (file.size > MAX_FILE_BYTES) throw new Error(`File is larger than 256 KiB: ${filePath}`);
    total += file.size;
    if (total > MAX_TOTAL_BYTES) throw new Error("Repository text files exceed the 8 MiB browser upload limit.");
    result.push({ path: filePath, content: await file.text() });
  }
  result.sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(result.map((file) => file.path.toLowerCase())).size !== result.length) throw new Error("Repository contains duplicate paths after normalization.");
  return result;
}

function safeBrowserPublishPath(filePath: string): boolean {
  if (!filePath || filePath.startsWith("/") || filePath.includes("\0") || filePath.split("/").some((part) => !part || part === "." || part === "..")) return false;
  if (/(^|\/)(node_modules|\.git|dist|build|coverage|\.next)(\/|$)/i.test(filePath)) return false;
  if (/(^|\/)(?:\.env(?:\.|$)|\.npmrc$|\.pypirc$|\.netrc$|secrets?(?:\.|$)|private(?:\.|$)|credentials?(?:\.|$)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$))/i.test(filePath)) return false;
  if (/\.(?:pem|key|p12|pfx|crt|cer|sqlite3?|db|zip|tar|tgz|gz|png|jpe?g|gif|webp|pdf|mp4|mov|avi|dmg|pkg)$/i.test(filePath)) return false;
  if (!filePath.includes("/")) {
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(?:md|mdx|txt|ya?ml)$/i.test(filePath)
      || new Set(["LICENSE", "Dockerfile", "Makefile", "package.json", "requirements.txt", "pyproject.toml", "tsconfig.json", "server.json", "plugin.json", ".gitignore", ".mcp.json"]).has(filePath);
  }
  if (filePath === ".harnesshub/results.json") return true;
  return /^(agents|skills|prompts|tools|scripts|commands|gates|evals|examples|runbooks|workflows|mcp|plugins|docs|src|lib|bin|\.claude|\.codex|\.claude-plugin|\.codex-plugin|\.gitea\/workflows)\//.test(filePath);
}

function storedWorkspaceSlug(): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  const value = localStorage.getItem("hh:workspaceSlug")?.trim().toLowerCase();
  return value && /^[a-z][a-z0-9_-]{1,48}$/.test(value) ? value : undefined;
}

function workspaceApprovalHref(workspace: string, resourceId: string, version: string, artifactDigest: string): string {
  const params = new URLSearchParams({
    workspace,
    resource: resourceId,
    version,
    digest: artifactDigest,
    approve: "1"
  });
  return `#/superskill/workspaces?${params.toString()}`;
}
