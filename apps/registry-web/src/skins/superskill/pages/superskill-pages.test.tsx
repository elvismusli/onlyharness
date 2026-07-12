import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { superskillRuntime } from "../../../generated/superskill-runtime";
import { selectedShowroomFixture, showroomFixture } from "../../../test/superskill-fixtures";
import { CategoryPage } from "./CategoryPage";
import { InstallHandoff } from "./InstallHandoff";
import { Landing } from "./Landing";
import { SelectedSkillPage } from "./SelectedSkillPage";
import { TrustPage } from "./TrustPage";

afterEach(() => vi.unstubAllGlobals());

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
  fireEvent.click(screen.getByRole("button", { name: "Continue in client" }));
  expect(await screen.findAllByDisplayValue("prepare a market map")).toHaveLength(2);
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
  expect(await screen.findByText("Selected skill not found")).toBeTruthy();
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

test("install handoff exposes exact runtime for both clients", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(showroomFixture()), { status: 200 })));
  render(<InstallHandoff capabilityId="market-research" />);
  await screen.findByText("Continue in your existing agent");
  expect(screen.getByDisplayValue(new RegExp(`onlyharness@${superskillRuntime.cliVersion.replaceAll(".", "\\.")}`))).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Codex CLI" }));
  await waitFor(() => expect(screen.getByDisplayValue(new RegExp(`onlyharness@${superskillRuntime.cliVersion.replaceAll(".", "\\.")}`))).toBeTruthy());
  expect(screen.getByDisplayValue("codex plugin add superskill@onlyharness")).toBeTruthy();
});
