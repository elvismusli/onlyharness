import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("../../../core/store", () => ({ useHarness: () => harness.value }));

import { PublishPage } from "./PublishPage";
import { ResourcePage } from "./ResourcePage";

beforeEach(() => {
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
  expect(screen.getByRole("link", { name: "View published skill" })).toHaveAttribute("href", "#/superskill/resources/onlyharness%3Apackages%2Fmy-agent-skill");
  expect(document.body.textContent).not.toContain("browser-secret-must-not-render");
  const [, init] = fetchMock.mock.calls[0];
  expect(init.headers.Authorization).toBe("Bearer browser-secret-must-not-render");
  const body = JSON.parse(init.body);
  expect(body).toMatchObject({ name: "my-agent-skill", version: "0.1.0", resourceType: "skill", idempotencyKey: "web-11111111-1111-4111-8111-111111111111" });
  expect(body.files.map((file: { path: string }) => file.path)).toEqual(["SKILL.md", "README.md"]);
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
