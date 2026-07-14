import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { ResourceItem } from "../../../core/types";
import { selectedShowroomFixture, showroomFixture } from "../../../test/superskill-fixtures";
import { SuperSkillHeader } from "../components/SuperSkillHeader";
import { CategoryPage } from "./CategoryPage";
import { SearchPage } from "./SearchPage";
import { SelectedSkillPage } from "./SelectedSkillPage";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function scannedResource(overrides: Partial<ResourceItem> = {}): ResourceItem {
  return {
    id: "onlyharness:packages/md-workflow",
    title: "Markdown research workflow",
    summary: "A repository-ready workflow assembled from markdown files.",
    resourceType: "workflow",
    sourcePlatform: "onlyharness",
    canonicalUrl: "https://superskill.sh/#/superskill/resources/x",
    upstreamId: "packages/md-workflow",
    upstreamOwner: "creator",
    licenseStatus: "unknown",
    sourceCheckedAt: "2026-07-14T00:00:00.000Z",
    sourceCheckStatus: "active",
    lastSeenAt: "2026-07-14T00:00:00.000Z",
    installability: "installable",
    tags: ["workflow"],
    worksWith: ["claude-code"],
    upstreamPopularity: { sourceLabel: "SuperSkill" },
    onlyHarnessSignals: { stars: 0, opens: 0, imports: 0, installs: 0, threads: 0, passedGates: 0 },
    popularityScore: 0,
    trust: { sourceChecked: true, securityScan: "warn", riskTier: "MEDIUM" },
    actions: [{ id: "download_archive", label: "Download", url: "https://superskill.sh/api/x/archive" }],
    ...overrides
  };
}

// FIX 1 — SuperSkillHeader: primary nav landmark is task-first; account/publishing demoted out of it.
test("primary navigation landmark is task-first and demotes account/publishing links out of it", () => {
  render(<SuperSkillHeader route={{ name: "landing" }} />);
  const primary = screen.getByRole("navigation", { name: "SuperSkill" });

  expect(within(primary).getByRole("link", { name: "Showroom" })).toHaveAttribute("href", "#/superskill");
  expect(within(primary).getByRole("link", { name: "Search" })).toHaveAttribute("href", "#/superskill/search");
  expect(within(primary).getByRole("link", { name: "Get SuperSkill" })).toHaveAttribute("href", "#/superskill/install");

  expect(within(primary).queryByRole("link", { name: "Publish" })).toBeNull();
  expect(within(primary).queryByRole("link", { name: "Workspaces" })).toBeNull();
  expect(within(primary).queryByRole("link", { name: "Account" })).toBeNull();

  // Routes are demoted, not deleted: still reachable somewhere in the header.
  expect(screen.getByRole("link", { name: "Publish" })).toHaveAttribute("href", "#/superskill/publish");
  expect(screen.getByRole("link", { name: "Workspaces" })).toHaveAttribute("href", "#/superskill/workspaces");
  expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "#/superskill/account");
});

// FIX 2 — SelectedSkillPage: real resource type (not the forbidden hardcode) + copyable candidate digest.
test("selected skill shows the real resource type and a copyable candidate artifact digest", async () => {
  const item = selectedShowroomFixture();
  const digest = item.capability.release.artifactDigest;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [item], total: 1, generatedAt: "2026-07-12T00:00:00.000Z" }), { status: 200 })));

  render(<SelectedSkillPage owner="harnesses" skill="deep-market-researcher" />);
  await screen.findByRole("heading", { name: "Market research" });

  expect(screen.queryByText(/instruction harness/i)).toBeNull();
  expect(screen.getByText("harness")).toBeTruthy();

  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });

  const digestField = screen.getByLabelText(/candidate artifact digest/i);
  expect(digestField).toHaveValue(digest);
  const field = digestField.closest(".ss-copy-field") as HTMLElement;
  fireEvent.click(within(field).getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(digest));
});

// FIX 3 — SearchPage: verdict renders via VerdictChip (glyph + word), never color/word alone.
test("scanned search result renders a verdict glyph alongside the word", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ resources: [scannedResource()], counts: { total: 1 } }), { status: 200 })));

  render(<SearchPage query="markdown" resourceType="workflow" />);
  await screen.findByRole("heading", { level: 2, name: "Markdown research workflow" });

  expect(screen.getByText("⚠")).toBeTruthy();
  expect(screen.getByText("warn")).toBeTruthy();
});

// FIX 4 — CategoryPage: exactly one recommended card, the rest framed as alternatives.
test("curated category recommends exactly one release and frames the rest as alternatives", async () => {
  const items = [
    showroomFixture({ id: "cap-alpha", title: "Alpha researcher" }),
    showroomFixture({ id: "cap-beta", title: "Beta researcher" }),
    showroomFixture({ id: "cap-gamma", title: "Gamma researcher" })
  ];
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items, total: items.length, generatedAt: "2026-07-12T00:00:00.000Z" }), { status: 200 })));

  render(<CategoryPage job="market-research" />);
  await screen.findByText("Alpha researcher");

  expect(screen.getAllByText("Recommended")).toHaveLength(1);
  expect(screen.getAllByText("Alternative")).toHaveLength(2);
});
