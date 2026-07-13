import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { selectedShowroomFixture, showroomFixture } from "../../../test/superskill-fixtures";
import { ConsentPanel } from "./ConsentPanel";
import { CopyField } from "./CopyField";
import { LifecycleChain } from "./LifecycleChain";
import { PermissionDelta } from "./PermissionDelta";
import { SelectedSkillCard } from "./SelectedSkillCard";
import { SkillCard } from "./SkillCard";
import { StatePanel } from "./StatePanel";
import { SuperSkillHeader } from "./SuperSkillHeader";
import { TaskPrompt } from "./TaskPrompt";

afterEach(() => vi.unstubAllGlobals());

test("unknown permission baseline is explicit", () => {
  render(<PermissionDelta delta={{ status: "partial", added: ["shell"], unchanged: [], unknownBecause: "Unmanaged skills are installed." }} />);
  expect(screen.getByText("Unknown baseline")).toBeTruthy();
  expect(screen.getByText("Unmanaged skills are installed.")).toBeTruthy();
  expect(screen.getByText("Can run shell commands on your machine")).toBeTruthy();
});

test("mobile navigation exposes every destination and restores focus on Escape", () => {
  render(<SuperSkillHeader route={{ name: "landing" }} />);
  const menu = screen.getByRole("button", { name: "Menu" });
  expect(menu).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(menu);
  expect(menu).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("link", { name: "Showroom" })).toHaveAttribute("href", "#/superskill");
  expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute("href", "#/superskill/search");
  expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "#/superskill/docs");
  expect(screen.getByRole("link", { name: "Agent guide" })).toHaveAttribute("href", "#/superskill/agent-guide");
  expect(screen.getByRole("link", { name: "Workspaces" })).toHaveAttribute("href", "#/superskill/workspaces");
  expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "#/superskill/account");
  expect(screen.getByRole("link", { name: "Get SuperSkill" })).toHaveAttribute("href", "#/superskill/install");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(menu).toHaveAttribute("aria-expanded", "false");
  expect(document.activeElement).toBe(menu);
});

test("page-level state uses h1 and keeps retry separate from navigation", () => {
  const retry = vi.fn();
  render(<StatePanel headingLevel={1} kind="error" title="Trust unavailable" next="Retry or return." onRetry={retry}><a href="#/superskill">Open showroom</a></StatePanel>);
  expect(screen.getByRole("heading", { level: 1, name: "Trust unavailable" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.getByRole("link", { name: "Open showroom" })).toHaveAttribute("href", "#/superskill");
});

test("temporary lifecycle never fabricates Installed and labels outcome evidence honestly", () => {
  render(<LifecycleChain mode="temporary" executionState="outcome_success" outcomeEvidence="agent_reported" />);
  expect(screen.queryByText("Installed")).toBeNull();
  expect(screen.getByText(/Outcome agent-reported/)).toBeTruthy();
});

test.each(["quarantined", "revoked"] as const)("%s resource disables client handoff", (status) => {
  render(<SkillCard item={showroomFixture({ trust: { ...showroomFixture().capability.trust, status } })} />);
  expect(screen.getByText("Install blocked")).toBeTruthy();
  expect(screen.queryByText("Client handoff")).toBeNull();
});

test("selected card is visibly pending and offers no managed trust or activation action", () => {
  render(<SelectedSkillCard item={selectedShowroomFixture()} />);
  expect(screen.getByText("Selected · review pending")).toBeTruthy();
  expect(screen.getByText(/not an approval, trust badge, or managed activation claim/i)).toBeTruthy();
  expect(screen.getByText("Managed install pending review")).toHaveAttribute("aria-disabled", "true");
  expect(screen.queryByText("Client handoff")).toBeNull();
  expect(screen.queryByText("Trust report")).toBeNull();
  expect(screen.getByRole("link", { name: "View selected skill" })).toHaveAttribute("href", "#/superskill/selected/harnesses/deep-market-researcher");
});

test("copy reports only Copied and never a lifecycle success", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(<CopyField label="Command" value="npx onlyharness@0.2.13 doctor" />);
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(await screen.findByText("Copied")).toBeTruthy();
  expect(screen.queryByText(/Installed|Loaded/)).toBeNull();
});

test("task prompt keeps task in React state and does not mutate URL or localStorage", () => {
  const onContinue = vi.fn();
  window.history.replaceState(null, "", "/?skin=superskill#/superskill");
  render(<TaskPrompt onContinue={onContinue} />);
  fireEvent.change(screen.getByLabelText("Task"), { target: { value: "map the private market" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue in client" }));
  expect(onContinue).toHaveBeenCalledWith("map the private market", "claude-code");
  expect(window.location.href).not.toContain("map");
  expect([...Array(window.localStorage.length)].map((_, index) => window.localStorage.key(index))).not.toContain("task");
});

test("T3 confirmation is not initially focused and stays disabled until checked", () => {
  render(<ConsentPanel tier="T3" delta={{ status: "partial", added: ["shell"], unchanged: [], unknownBecause: "Unknown client policy." }} />);
  const confirm = screen.getByRole("button", { name: "Continue in client" });
  expect(document.activeElement).not.toBe(confirm);
  expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(confirm).not.toBeDisabled();
});
