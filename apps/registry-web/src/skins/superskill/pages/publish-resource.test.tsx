import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("../../../core/store", () => ({ useHarness: () => harness.value }));

import { PublishPage } from "./PublishPage";
import { ResourcePage } from "./ResourcePage";

beforeEach(() => {
  localStorage.clear();
  harness.value = { user: null, accessToken: undefined };
  vi.unstubAllGlobals();
});

test("publish requires a signed-in confirmed account without rendering credentials", () => {
  render(<PublishPage />);
  expect(screen.getByRole("link", { name: "Sign in or create account" })).toHaveAttribute("href", "#/superskill/account");
  expect(screen.queryByRole("button", { name: "Publish release" })).toBeNull();
  expect(document.body.textContent).not.toContain("accessToken");
});

test("confirmed publisher creates an immutable unreviewed skill release", async () => {
  harness.value = {
    user: { email: "publisher@example.com", email_confirmed_at: "2026-07-14T00:00:00.000Z" },
    accessToken: "browser-secret-must-not-render"
  };
  vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    resourceId: "onlyharness:packages/my-agent-skill",
    version: "0.1.0",
    artifactDigest: "a".repeat(64),
    trust: "unreviewed",
    replay: false,
    archiveUrl: "https://superskill.sh/api/resources/release/archive",
    verified: false
  }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<PublishPage />);
  const versionInput = screen.getByLabelText("Version") as HTMLInputElement;
  expect(versionInput.checkValidity()).toBe(true);
  fireEvent.change(versionInput, { target: { value: "0x1x0" } });
  expect(versionInput.checkValidity()).toBe(false);
  fireEvent.change(versionInput, { target: { value: "0.1.0" } });
  fireEvent.submit(screen.getByRole("button", { name: "Publish release" }).closest("form")!);

  expect(await screen.findByRole("heading", { name: "onlyharness:packages/my-agent-skill@0.1.0" })).toBeTruthy();
  expect(screen.getByText("Unreviewed")).toBeTruthy();
  expect(screen.getByRole("link", { name: "View exact published release" })).toHaveAttribute("href", "#/superskill/resources/onlyharness%3Apackages%2Fmy-agent-skill/releases/0.1.0");
  expect(document.body.textContent).not.toContain("browser-secret-must-not-render");
  const [, init] = fetchMock.mock.calls[0];
  expect(init.headers.Authorization).toBe("Bearer browser-secret-must-not-render");
  const body = JSON.parse(init.body);
  expect(body).toMatchObject({ name: "my-agent-skill", version: "0.1.0", resourceType: "skill", idempotencyKey: "web-11111111-1111-4111-8111-111111111111" });
  expect(body.files.map((file: { path: string }) => file.path)).toEqual(["SKILL.md", "README.md"]);
});

test("confirmed publisher can upload a markdown repository folder and keep it natively installable as a skill", async () => {
  harness.value = {
    user: { email: "publisher@example.com", email_confirmed_at: "2026-07-14T00:00:00.000Z" },
    accessToken: "session"
  };
  vi.stubGlobal("crypto", { randomUUID: () => "22222222-2222-4222-8222-222222222222" });
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    resourceId: "onlyharness:packages/my-agent-skill",
    version: "0.1.0",
    artifactDigest: "b".repeat(64),
    trust: "unreviewed",
    replay: false,
    archiveUrl: "https://superskill.sh/api/resources/release/archive",
    verified: false
  }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<PublishPage />);

  const workflow = { name: "workflow.md", size: 32, webkitRelativePath: "creator-repo/workflow.md", text: vi.fn().mockResolvedValue("# Workflow\n\nRun the reviewed steps.\n") } as unknown as File;
  const notes = { name: "notes.md", size: 24, webkitRelativePath: "creator-repo/docs/notes.md", text: vi.fn().mockResolvedValue("# Notes\n\nSupporting context.\n") } as unknown as File;
  fireEvent.change(screen.getByLabelText("Repository files"), { target: { files: [workflow, notes] } });
  expect(await screen.findByText(/2 text files ready/i)).toBeTruthy();
  expect(screen.getByText("workflow.md")).toBeTruthy();
  expect(screen.getByText("docs/notes.md")).toBeTruthy();

  fireEvent.submit(screen.getByRole("button", { name: "Publish release" }).closest("form")!);
  await screen.findByRole("heading", { name: "onlyharness:packages/my-agent-skill@0.1.0" });
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.resourceType).toBe("skill");
  expect(body.files.map((file: { path: string }) => file.path)).toEqual(["SKILL.md", "docs/notes.md", "workflow.md"]);
  const wrapper = body.files.find((file: { path: string }) => file.path === "SKILL.md").content as string;
  expect(wrapper).toContain("Start with `workflow.md`");
  expect(wrapper).toContain("- `docs/notes.md`");
  expect(wrapper).not.toContain("Describe when to use this skill");
});

test("uploaded root SKILL frontmatter is normalized to the published package while its instructions are preserved", async () => {
  harness.value = {
    user: { email: "publisher@example.com", email_confirmed_at: "2026-07-14T00:00:00.000Z" },
    accessToken: "session"
  };
  vi.stubGlobal("crypto", { randomUUID: () => "24222222-2222-4222-8222-222222222222" });
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    resourceId: "onlyharness:packages/my-agent-skill",
    version: "0.1.0",
    artifactDigest: "d".repeat(64),
    trust: "unreviewed",
    replay: false,
    archiveUrl: "https://superskill.sh/api/resources/release/archive",
    verified: false
  }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<PublishPage />);

  const skill = {
    name: "SKILL.md",
    size: 120,
    webkitRelativePath: "creator-repo/SKILL.md",
    text: vi.fn().mockResolvedValue("---\nname: wrong-package\ndescription: wrong description\n---\n\n# Keep these instructions\n\nRun workflow.md safely.\n")
  } as unknown as File;
  fireEvent.change(screen.getByLabelText("Repository files"), { target: { files: [skill] } });
  await screen.findByText(/1 text file ready/i);
  fireEvent.submit(screen.getByRole("button", { name: "Publish release" }).closest("form")!);
  await screen.findByRole("heading", { name: "onlyharness:packages/my-agent-skill@0.1.0" });

  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  const publishedSkill = body.files.find((file: { path: string }) => file.path === "SKILL.md").content as string;
  expect(publishedSkill).toContain("name: my-agent-skill");
  expect(publishedSkill).toContain("description: \"A focused workflow for a repeatable agent task.\"");
  expect(publishedSkill).not.toContain("wrong-package");
  expect(publishedSkill).toContain("# Keep these instructions");
  expect(publishedSkill).toContain("Run workflow.md safely.");
});

test("browser folder upload rejects nested paths outside the API allowlist before publishing", async () => {
  harness.value = {
    user: { email: "publisher@example.com", email_confirmed_at: "2026-07-14T00:00:00.000Z" },
    accessToken: "session"
  };
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(<PublishPage />);
  const unsupported = {
    name: "step.md",
    size: 20,
    webkitRelativePath: "creator-repo/templates/step.md",
    text: vi.fn().mockResolvedValue("# Hidden template\n")
  } as unknown as File;
  fireEvent.change(screen.getByLabelText("Repository files"), { target: { files: [unsupported] } });
  expect(await screen.findByRole("status")).toHaveTextContent("Unsupported or unsafe repository path: templates/step.md");
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each([
  "creator-repo/docs/secrets.md",
  "creator-repo/prompts/credentials.txt",
  "creator-repo/src/private.json"
])("browser folder upload rejects sensitive nested basename %s", async (webkitRelativePath) => {
  harness.value = {
    user: { email: "publisher@example.com", email_confirmed_at: "2026-07-14T00:00:00.000Z" },
    accessToken: "session"
  };
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(<PublishPage />);
  const sensitive = {
    name: webkitRelativePath.split("/").at(-1),
    size: 24,
    webkitRelativePath,
    text: vi.fn().mockResolvedValue("# Innocent-looking content\n")
  } as unknown as File;
  fireEvent.change(screen.getByLabelText("Repository files"), { target: { files: [sensitive] } });
  expect(await screen.findByRole("status")).toHaveTextContent(/Unsupported or unsafe repository path/);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("published release can continue directly into the loaded workspace curation flow", async () => {
  harness.value = {
    user: { email: "publisher@example.com", email_confirmed_at: "2026-07-14T00:00:00.000Z" },
    accessToken: "session",
    workspaceCatalog: { workspace: { slug: "research-team" } }
  };
  vi.stubGlobal("crypto", { randomUUID: () => "33333333-3333-4333-8333-333333333333" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    resourceId: "onlyharness:packages/my-agent-skill",
    version: "0.1.0",
    artifactDigest: "c".repeat(64),
    trust: "unreviewed",
    replay: false,
    archiveUrl: "https://superskill.sh/api/resources/release/archive",
    verified: false
  }), { status: 201 })));
  render(<PublishPage />);
  fireEvent.submit(screen.getByRole("button", { name: "Publish release" }).closest("form")!);

  expect(await screen.findByRole("link", { name: "Add to @research-team" })).toHaveAttribute(
    "href",
    `#/superskill/workspaces?workspace=research-team&resource=onlyharness%3Apackages%2Fmy-agent-skill&version=0.1.0&digest=${"c".repeat(64)}&approve=1`
  );
});

test("exact resource detail carries version and digest into install and workspace approval", async () => {
  localStorage.setItem("hh:workspaceSlug", "research-team");
  const digest = "e".repeat(64);
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    id: "onlyharness:packages/my-agent-skill",
    title: "My agent skill",
    summary: "A focused workflow.",
    resourceType: "skill",
    sourcePlatform: "manual",
    canonicalUrl: "https://superskill.sh/#/superskill/resources/onlyharness%3Apackages%2Fmy-agent-skill",
    upstreamId: "packages/my-agent-skill",
    upstreamOwner: "onlyharness",
    upstreamRepo: "my-agent-skill",
    licenseStatus: "unknown",
    sourceCheckedAt: "2026-07-14T00:00:00Z",
    sourceCheckStatus: "active",
    lastSeenAt: "2026-07-14T00:00:00Z",
    installability: "importable",
    tags: ["skill"],
    worksWith: ["claude-code", "codex"],
    upstreamPopularity: { sourceLabel: "SuperSkill hosted resource package" },
    onlyHarnessSignals: { stars: 0, opens: 0, imports: 1, installs: 0, threads: 0, passedGates: 0 },
    popularityScore: 0,
    trust: { sourceChecked: true, securityScan: "pass", riskTier: "LOW" },
    release: { version: "0.1.0", artifactDigest: digest, archiveSize: 123, trust: "unreviewed" },
    actions: [{ id: "download_archive", label: "Download archive", url: "https://superskill.sh/api/archive?version=0.1.0" }]
  }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<ResourcePage resourceId="onlyharness:packages/my-agent-skill" version="0.1.0" />);

  expect(await screen.findByText(digest)).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/resources/onlyharness%3Apackages%2Fmy-agent-skill/releases/0.1.0"), expect.any(Object));
  expect((screen.getByLabelText("Install exact 0.1.0 in Codex after inspection") as HTMLTextAreaElement).value).toContain('--version "0.1.0"');
  expect((screen.getByLabelText("Install exact 0.1.0 in Codex after inspection") as HTMLTextAreaElement).value).toContain(`--digest "sha256:${digest}"`);
  expect(screen.getByRole("link", { name: "Add exact release to @research-team" })).toHaveAttribute(
    "href",
    `#/superskill/workspaces?workspace=research-team&resource=onlyharness%3Apackages%2Fmy-agent-skill&version=0.1.0&digest=${digest}&approve=1`
  );
});

test("ambiguous network retry reuses the same idempotency key", async () => {
  harness.value = {
    user: { email: "publisher@example.com", email_confirmed_at: "2026-07-14T00:00:00.000Z" },
    accessToken: "session"
  };
  let randomCalls = 0;
  vi.stubGlobal("crypto", { randomUUID: () => `11111111-1111-4111-8111-${String(++randomCalls).padStart(12, "0")}` });
  const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetchMock);
  render(<PublishPage />);
  const form = screen.getByRole("button", { name: "Publish release" }).closest("form")!;
  fireEvent.submit(form);
  await screen.findByText(/result is unknown/i);
  fireEvent.submit(form);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const first = JSON.parse(fetchMock.mock.calls[0][1].body).idempotencyKey;
  const second = JSON.parse(fetchMock.mock.calls[1][1].body).idempotencyKey;
  expect(second).toBe(first);
  expect(randomCalls).toBe(1);
});

test("published resource page keeps unscanned packages visibly outside managed approval", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    id: "onlyharness:packages/my-agent-skill",
    title: "My agent skill",
    summary: "A focused workflow.",
    resourceType: "skill",
    sourcePlatform: "manual",
    canonicalUrl: "https://superskill.sh/#/superskill/resources/onlyharness%3Apackages%2Fmy-agent-skill",
    upstreamId: "packages/my-agent-skill",
    upstreamOwner: "onlyharness",
    upstreamRepo: "my-agent-skill",
    licenseStatus: "unknown",
    sourceCheckedAt: "2026-07-14T00:00:00Z",
    sourceCheckStatus: "active",
    lastSeenAt: "2026-07-14T00:00:00Z",
    installability: "importable",
    tags: ["skill"],
    worksWith: ["claude-code", "codex"],
    upstreamPopularity: { sourceLabel: "SuperSkill hosted resource package" },
    onlyHarnessSignals: { stars: 0, opens: 0, imports: 1, installs: 0, threads: 0, passedGates: 0 },
    popularityScore: 0,
    trust: { sourceChecked: true, securityScan: "not_scanned", riskTier: "UNKNOWN" },
    actions: [{ id: "download_archive", label: "Download archive", url: "https://superskill.sh/api/archive" }]
  }), { status: 200 })));
  render(<ResourcePage resourceId="onlyharness:packages/my-agent-skill" />);
  expect(await screen.findByRole("heading", { name: "My agent skill" })).toBeTruthy();
  expect(screen.getByText(/not a reviewed managed capability/i)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Download current archive" })).toHaveAttribute("href", "https://superskill.sh/api/archive");
});

test("open-only resource page never claims a hosted archive", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    id: "github:obra/superpowers",
    title: "superpowers",
    summary: "Upstream skill collection.",
    resourceType: "skill",
    sourcePlatform: "github",
    canonicalUrl: "https://superskill.sh/#/superskill/resources/github%3Aobra%2Fsuperpowers",
    upstreamId: "obra/superpowers",
    upstreamOwner: "obra",
    upstreamRepo: "superpowers",
    licenseStatus: "unknown",
    sourceCheckedAt: "2026-07-14T00:00:00Z",
    sourceCheckStatus: "active",
    lastSeenAt: "2026-07-14T00:00:00Z",
    installability: "open_only",
    tags: ["skill"],
    worksWith: ["claude-code", "codex"],
    upstreamPopularity: { sourceLabel: "GitHub" },
    onlyHarnessSignals: { stars: 0, opens: 0, imports: 0, installs: 0, threads: 0, passedGates: 0 },
    popularityScore: 0,
    trust: { sourceChecked: true, securityScan: "not_scanned", riskTier: "UNKNOWN" },
    actions: [{ id: "open_upstream", label: "Open upstream", url: "https://github.com/obra/superpowers" }]
  }), { status: 200 })));
  render(<ResourcePage resourceId="github:obra/superpowers" />);
  expect(await screen.findByRole("heading", { name: "superpowers" })).toBeTruthy();
  expect(screen.getByText(/has no SuperSkill-hosted archive/i)).toBeTruthy();
  expect(screen.queryByText(/public and downloadable/i)).toBeNull();
  expect(screen.queryByRole("link", { name: "Download current archive" })).toBeNull();
  expect(screen.getByRole("link", { name: "Open upstream source" })).toHaveAttribute("href", "https://github.com/obra/superpowers");
});
