import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { superskillRuntime } from "../../../generated/superskill-runtime";
import { showroomFixture } from "../../../test/superskill-fixtures";
import { InstallHandoff } from "./InstallHandoff";
import { Landing } from "./Landing";
import { TrustPage } from "./TrustPage";

afterEach(() => vi.unstubAllGlobals());

test("landing renders a real public DTO and does not send task content", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [showroomFixture()], total: 1, generatedAt: "2026-07-12T00:00:00Z" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<Landing />);
  expect(screen.getByText("Loading approved releases")).toBeTruthy();
  expect(await screen.findByText("Market research")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Task"), { target: { value: "prepare a market map" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue in client" }));
  expect(await screen.findAllByDisplayValue("prepare a market map")).toHaveLength(2);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("body");
});

test("landing preserves an actionable API unavailable state", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Index invalid", code: "CATALOG_NOT_READY" }), { status: 503 })));
  render(<Landing />);
  expect(await screen.findByText("Showroom API unavailable")).toBeTruthy();
  expect(screen.getByText(/continue with the client setup below/i)).toBeTruthy();
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
