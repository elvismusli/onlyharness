import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { ResourceItem } from "../../../core/types";
import { SearchPage } from "./SearchPage";

const resource: ResourceItem = {
  id: "onlyharness:packages/md-workflow",
  title: "Markdown research workflow",
  summary: "A repository-ready workflow assembled from markdown files.",
  resourceType: "workflow",
  sourcePlatform: "onlyharness",
  canonicalUrl: "https://superskill.sh/#/superskill/resources/onlyharness%3Apackages%2Fmd-workflow",
  upstreamId: "packages/md-workflow",
  upstreamOwner: "creator",
  licenseStatus: "unknown",
  sourceCheckedAt: "2026-07-14T00:00:00.000Z",
  sourceCheckStatus: "active",
  lastSeenAt: "2026-07-14T00:00:00.000Z",
  installability: "installable",
  tags: ["workflow", "markdown"],
  worksWith: ["claude-code", "codex"],
  upstreamPopularity: { sourceLabel: "SuperSkill" },
  onlyHarnessSignals: { stars: 0, opens: 0, imports: 0, installs: 0, threads: 0, passedGates: 0 },
  popularityScore: 0,
  trust: { sourceChecked: true, securityScan: "warn", riskTier: "MEDIUM" },
  actions: [{ id: "download_archive", label: "Download from SuperSkill", url: "https://superskill.sh/api/resources/onlyharness%3Apackages%2Fmd-workflow/archive" }]
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

test("mixed search sends query and type to the public resource endpoint and keeps trust states explicit", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ resources: [resource], counts: { total: 1 } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  render(<SearchPage query="markdown research" resourceType="workflow" />);

  expect(screen.getByText("Searching resources")).toBeTruthy();
  expect(await screen.findByRole("heading", { level: 2, name: "Markdown research workflow" })).toBeTruthy();
  expect(screen.getByText("warn")).toBeTruthy();
  expect(screen.getByText("Source checked · active")).toBeTruthy();
  expect(screen.getByText("Hosted archive available")).toBeTruthy();
  expect(screen.getByText(/scan has warnings/i)).toBeTruthy();
  expect(screen.getByRole("link", { name: "View source and actions" })).toHaveAttribute("href", "#/superskill/resources/onlyharness%3Apackages%2Fmd-workflow");
  expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/resources\?(?=.*q=markdown\+research)(?=.*type=workflow)(?=.*sort=source-checked)/), expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

test("search form writes a shareable SuperSkill route without putting the query outside the hash", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ resources: [], counts: { total: 0 } }), { status: 200 })));
  render(<SearchPage />);
  await screen.findByText("No matching resources");

  fireEvent.change(screen.getByRole("searchbox", { name: "Search catalog" }), { target: { value: "payment safety" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Resource type" }), { target: { value: "skill" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));

  await waitFor(() => expect(window.location.hash).toBe("#/superskill/search?q=payment+safety&type=skill"));
  expect(window.location.pathname).toBe("/");
});

test("search failure remains retryable and does not show stale results", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Catalog warming" }), { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ resources: [resource], counts: { total: 1 } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  render(<SearchPage query="workflow" />);
  expect(await screen.findByText("Search unavailable")).toBeTruthy();
  expect(screen.queryByText("Markdown research workflow")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Markdown research workflow")).toBeTruthy();
});
