import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { showroomFixture } from "../../../test/superskill-fixtures";
import { ResourcePage } from "./ResourcePage";
import { TrustPage } from "./TrustPage";

// ResourcePage reads the harness store; the store value is irrelevant to these behaviors.
vi.mock("../../../core/store", () => ({ useHarness: () => ({}) }));

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function revokedShowroom() {
  const base = showroomFixture();
  return showroomFixture({ trust: { ...base.capability.trust, status: "revoked" } });
}

function resourceDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: "onlyharness:packages/my-agent-skill",
    title: "My agent skill",
    summary: "A focused, source-backed workflow.",
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
    release: { version: "0.1.0", artifactDigest: "e".repeat(64), archiveSize: 123, trust: "unreviewed" },
    actions: [{ id: "download_archive", label: "Download archive", url: "https://superskill.sh/api/archive?version=0.1.0" }],
    ...overrides
  };
}

// Principle 9 — fail-closed exits: a blocked trust page must offer a way out.
test("a blocked trust page renders at least one exit link inside the alert", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(revokedShowroom()), { status: 200 })));
  render(<TrustPage capabilityId="market-research" />);
  const alert = await screen.findByRole("alert");
  expect(within(alert).queryAllByRole("link").length).toBeGreaterThan(0);
});

// Heading order: the first heading on a blocked page must not be a level below the report h1.
test("a blocked trust page keeps the first rendered heading at level 1", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(revokedShowroom()), { status: 200 })));
  render(<TrustPage capabilityId="market-research" />);
  await screen.findByRole("alert");
  const headings = screen.getAllByRole("heading");
  const levelOne = screen.getAllByRole("heading", { level: 1 });
  expect(levelOne).toContain(headings[0]);
});

// Principle 4 / glossary: the release fact is labelled "Release", never "version".
test("resource detail labels the release, not a version", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(resourceDetail()), { status: 200 })));
  render(<ResourcePage resourceId="onlyharness:packages/my-agent-skill" version="0.1.0" />);
  expect(await screen.findByText("Release")).toBeTruthy();
  expect(screen.queryByText("Exact version")).toBeNull();
});

// Principle 4: the artifact digest is a real copy affordance, not inert text.
test("copying the artifact digest writes the exact digest to the clipboard", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const detail = resourceDetail();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(detail), { status: 200 })));
  render(<ResourcePage resourceId="onlyharness:packages/my-agent-skill" version="0.1.0" />);
  const digestField = await screen.findByDisplayValue(detail.release.artifactDigest);
  const copyButton = digestField.closest("label")!.nextElementSibling as HTMLButtonElement;
  expect(copyButton).toHaveTextContent(/copy/i);
  fireEvent.click(copyButton);
  expect(writeText).toHaveBeenCalledWith(detail.release.artifactDigest);
});
