import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { superskillRuntime } from "../../../generated/superskill-runtime";
import { selectedShowroomFixture, showroomFixture } from "../../../test/superskill-fixtures";
import { SuperskillSkin } from "../index";
import { AgentGuidePage } from "./AgentGuidePage";
import { CategoryPage } from "./CategoryPage";
import { DocsPage } from "./DocsPage";
import { InstallHandoff } from "./InstallHandoff";
import { Landing } from "./Landing";
import { SelectedSkillPage } from "./SelectedSkillPage";
import { TrustPage } from "./TrustPage";

const runtimePublished = String(superskillRuntime.cliReleaseStatus) === "published" && Boolean(superskillRuntime.cliIntegrity);

function humanFacingProse(container: HTMLElement): string {
  const copy = container.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("textarea").forEach((field) => field.remove());
  return copy.textContent ?? "";
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

test("the single global CTA opens generic install without requesting capability detail", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", "/?skin=superskill#/superskill/docs");
  render(<SuperskillSkin />);
  const ctas = screen.getAllByRole("link", { name: "Get SuperSkill" });
  expect(ctas).toHaveLength(1);
  expect(ctas[0]).toHaveAttribute("href", "#/superskill/install");
  fireEvent.click(ctas[0]!);
  await waitFor(() => expect(window.location.hash).toBe("#/superskill/install"));
  expect(await screen.findByRole("heading", { level: 1, name: runtimePublished ? "Continue in your existing agent" : "Universal installer not available yet" })).toBeTruthy();
  if (runtimePublished) expect(screen.getByDisplayValue(new RegExp(`onlyharness@${superskillRuntime.cliVersion.replaceAll(".", "\\.")} superskill install`))).toBeTruthy();
  else expect(screen.queryByDisplayValue(/superskill install/)).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.queryByText("Activated")).toBeNull();
  expect(screen.queryByText("Installed")).toBeNull();
});

test("generic install direct reload reflects the exact release gate", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", "/?skin=superskill#/superskill/install");
  const { container } = render(<SuperskillSkin />);
  expect(await screen.findByRole("heading", { level: 1, name: runtimePublished ? "Continue in your existing agent" : "Universal installer not available yet" })).toBeTruthy();
  if (runtimePublished) {
    expect(screen.getByDisplayValue(new RegExp(`npx --yes onlyharness@${superskillRuntime.cliVersion.replaceAll(".", "\\.")} superskill install https://superskill\\.sh/api/superskill/install --auto`))).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  } else {
    expect(screen.queryByDisplayValue(/superskill install/)).toBeNull();
  }
  expect(humanFacingProse(container)).not.toMatch(/onlyharness/i);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("browser docs stay HTML-first while preserving raw machine-readable links", () => {
  const { container } = render(<DocsPage />);
  expect(screen.getByRole("heading", { level: 1, name: "Install and use SuperSkill" })).toBeTruthy();
  if (runtimePublished) expect(screen.getByDisplayValue(new RegExp(`onlyharness@${superskillRuntime.cliVersion.replaceAll(".", "\\.")} superskill install`))).toBeTruthy();
  else expect(screen.getByRole("heading", { name: "Install command not published" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Raw llms.txt" })).toHaveAttribute("href", "/llms.txt");
  expect(screen.getByRole("link", { name: "Raw AGENTS.md" })).toHaveAttribute("href", "/AGENTS.md");
  expect(humanFacingProse(container)).not.toMatch(/onlyharness/i);
});

test("agent guide keeps selected candidates separate from approved exact releases", () => {
  const { container } = render(<AgentGuidePage />);
  expect(screen.getByRole("heading", { level: 1, name: "Use SuperSkill from an agent" })).toBeTruthy();
  expect(screen.getByText("selected_unreviewed")).toBeTruthy();
  if (runtimePublished) expect(screen.getByDisplayValue(new RegExp(`onlyharness@${superskillRuntime.cliVersion.replaceAll(".", "\\.")} superskill install`))).toBeTruthy();
  else expect(screen.getByRole("heading", { name: "Bootstrap unavailable" })).toBeTruthy();
  expect(screen.getByText(/cannot support a trust claim, managed recommendation, or activation/i)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Raw AGENTS.md" })).toHaveAttribute("href", "/AGENTS.md");
  expect(humanFacingProse(container)).not.toMatch(/onlyharness/i);
});

test("landing renders a real public DTO and does not send task content", async () => {
  const fetchMock = vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify({
    items: url.includes("/showroom/selected") ? [selectedShowroomFixture()] : [showroomFixture()],
    total: 1,
    generatedAt: "2026-07-12T00:00:00Z"
  }), { status: 200 })));
  vi.stubGlobal("fetch", fetchMock);
  render(<Landing />);
  expect(screen.getByText("Loading approved releases")).toBeTruthy();
  expect(await screen.findAllByText("Market research")).toHaveLength(2);
  expect(await screen.findByText("Selected · review pending")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Task"), { target: { value: "prepare a market map" } });
  fireEvent.click(screen.getByRole("button", { name: "Find skill" }));
  expect(await screen.findAllByDisplayValue("prepare a market map")).toHaveLength(runtimePublished ? 2 : 1);
  expect(screen.getByRole("heading", { name: runtimePublished ? "Continue in your existing agent" : "Universal installer not available yet" })).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.every((call) => !("body" in call[1]))).toBe(true);
});

test("landing preserves an actionable API unavailable state", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Index invalid", code: "CATALOG_NOT_READY" }), { status: 503 })));
  render(<Landing />);
  expect(await screen.findByText("Showroom API unavailable")).toBeTruthy();
  expect(screen.getByText(/continue with the client setup below/i)).toBeTruthy();
});

test("empty approved category falls back to matching selected skills without managed install", async () => {
  const fetchMock = vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify({
    items: url.includes("/showroom/selected") ? [selectedShowroomFixture()] : [],
    total: url.includes("/showroom/selected") ? 1 : 0,
    generatedAt: "2026-07-12T00:00:00Z"
  }), { status: 200 })));
  vi.stubGlobal("fetch", fetchMock);
  render(<CategoryPage job="market-research" />);
  expect(screen.getByRole("heading", { level: 1, name: "Resources for market research" })).toBeTruthy();
  expect(await screen.findByText("No approved releases in this category")).toBeTruthy();
  expect(await screen.findAllByText("Selected · review pending")).toHaveLength(2);
  expect(screen.getByText("Managed install pending review")).toBeTruthy();
  expect(screen.queryByText("Client handoff")).toBeNull();
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/showroom/selected?limit=12&job=market-research"), expect.anything());
});

test("selected skill detail stays in Daylight and keeps managed install blocked", async () => {
  const item = selectedShowroomFixture();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    items: [item],
    total: 1,
    generatedAt: "2026-07-12T00:00:00Z"
  }), { status: 200 })));
  render(<SelectedSkillPage owner="harnesses" skill="deep-market-researcher" />);
  expect(await screen.findByRole("heading", { name: "Market research" })).toBeTruthy();
  expect(screen.getByText("Exact review is still required")).toBeTruthy();
  expect(screen.getByText("Managed install pending review")).toHaveAttribute("aria-disabled", "true");
  expect(screen.queryByText("Open classic listing")).toBeNull();
});

test("unknown selected skill fails closed inside Daylight", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    items: [selectedShowroomFixture()],
    total: 1,
    generatedAt: "2026-07-12T00:00:00Z"
  }), { status: 200 })));
  render(<SelectedSkillPage owner="harnesses" skill="missing-skill" />);
  expect(await screen.findByRole("heading", { level: 1, name: "Selected skill not found" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open showroom" })).toHaveAttribute("href", "#/superskill");
});

test("revoked trust page stays visible and blocks handoff", async () => {
  const item = showroomFixture({ trust: { ...showroomFixture().capability.trust, status: "revoked" } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(item), { status: 200 })));
  render(<TrustPage capabilityId="market-research" />);
  expect(await screen.findByText("Release revoked")).toBeTruthy();
  expect(screen.getByText("Install handoff blocked")).toBeTruthy();
  expect(screen.getByText(item.capability.release.artifactDigest)).toBeTruthy();
});

test("stale public evidence blocks client handoff without calling it quarantine", async () => {
  const item = { ...showroomFixture(), clientHandoff: { status: "blocked" as const, reason: "stale_or_ineligible_evidence" as const } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(item), { status: 200 })));
  render(<TrustPage capabilityId="market-research" />);
  expect(await screen.findByText("Client handoff blocked — evidence is stale")).toBeTruthy();
  expect(screen.getByText("Install handoff blocked")).toBeTruthy();
  expect(screen.queryByText(/Release quarantined/i)).toBeNull();
});

test("install handoff reflects the exact runtime release gate for an approved capability", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(showroomFixture()), { status: 200 })));
  render(<InstallHandoff capabilityId="market-research" />);
  await screen.findByRole("heading", { level: 1, name: runtimePublished ? "Continue in your existing agent" : "Universal installer not available yet" });
  if (runtimePublished) expect(screen.getByDisplayValue(/superskill install https:\/\/superskill\.sh\/api\/superskill\/install\/market-research\/0\.2\.0\//)).toBeTruthy();
  else expect(screen.queryByDisplayValue(/superskill install/)).toBeNull();
});

test("capability-specific install keeps the exact release gate fail closed", async () => {
  const revoked = showroomFixture({ trust: { ...showroomFixture().capability.trust, status: "revoked" } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(revoked), { status: 200 })));
  render(<InstallHandoff capabilityId="market-research" />);
  expect(await screen.findByRole("heading", { level: 1, name: "Client handoff blocked — revoked" })).toBeTruthy();
  expect(screen.queryByDisplayValue(/plugin install/)).toBeNull();
  expect(screen.getByRole("link", { name: "Open trust report" })).toHaveAttribute("href", "#/superskill/c/market-research");
  expect(screen.getByRole("link", { name: "Open showroom" })).toHaveAttribute("href", "#/superskill");
});

test("capability install not-found state offers showroom and trust navigation", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Missing release", code: "CAPABILITY_NOT_FOUND" }), { status: 404 })));
  render(<InstallHandoff capabilityId="market-research" />);
  expect(await screen.findByRole("heading", { level: 1, name: "Resource not found" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open showroom" })).toHaveAttribute("href", "#/superskill");
  expect(screen.getByRole("link", { name: "Open trust report" })).toHaveAttribute("href", "#/superskill/c/market-research");
});
