import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { ManagedCapability } from "../../../core/superskill-types";
import { selectedShowroomFixture, showroomFixture } from "../../../test/superskill-fixtures";
import { ExampleSkillCard } from "./ExampleSkillCard";
import { SelectedSkillCard } from "./SelectedSkillCard";
import { SkillCard } from "./SkillCard";

afterEach(() => vi.unstubAllGlobals());

function itemWithType(type: string) {
  const base = showroomFixture();
  return { ...base, capability: { ...base.capability, type: type as ManagedCapability["type"] } };
}

function permsWith(overrides: Partial<ManagedCapability["permissions"]>): ManagedCapability["permissions"] {
  return { ...showroomFixture().capability.permissions, ...overrides };
}

// Fix 1 — type chip is data-driven and never the forbidden "instruction harness" label.
test("resource type chip is driven by data and never renders 'instruction harness'", () => {
  const { rerender } = render(<SkillCard item={itemWithType("skill")} variant="featured" />);
  expect(screen.getByText(/^skill$/i)).toBeTruthy();
  expect(screen.queryByText(/instruction harness/i)).toBeNull();

  // Even the real schema value (type === "instruction_harness") must not surface the forbidden phrase.
  rerender(<SkillCard item={showroomFixture()} variant="featured" />);
  expect(screen.queryByText(/instruction harness/i)).toBeNull();
});

// Fix 2 — permission summary marks real critical powers and states the positive when there are none.
test("permission summary marks a critical power and states 'no new permissions' when there are none", () => {
  const critical = showroomFixture();
  critical.capability.permissions = permsWith({ shell: true });
  const { rerender } = render(<SkillCard item={critical} />);
  const shellChip = screen.getByText(/shell/i).closest("[data-risk]");
  expect(shellChip).not.toBeNull();
  expect(shellChip).toHaveAttribute("data-risk", "critical");

  const none = showroomFixture();
  none.capability.permissions = permsWith({
    network: "false",
    networkAllowlist: [],
    filesystem: "none",
    shell: false,
    browser: false,
    credentials: "false",
    externalSend: false,
    moneyMovement: false,
    userData: false
  });
  rerender(<SkillCard item={none} />);
  expect(screen.getByText(/no new permissions/i)).toBeTruthy();
});

// Fix 3 — trust line shows the last review/scan date from the real trust field.
test("trust line shows the last review date from data", () => {
  render(<SkillCard item={showroomFixture()} />);
  expect(screen.getByText(/reviewed 2026-07-10/i)).toBeTruthy();
});

// Fix 4 — featured card carries a compact "Why this" region with a Fit line; compact cards omit it.
test("featured card explains 'why this' with a fit line; compact card omits it", () => {
  const { rerender } = render(<SkillCard item={showroomFixture()} variant="featured" />);
  const why = screen.getByRole("region", { name: /why this/i });
  expect(within(why).getByText("Fit")).toBeTruthy();

  rerender(<SkillCard item={showroomFixture()} variant="compact" />);
  expect(screen.queryByRole("region", { name: /why this/i })).toBeNull();
});

// Fix 5 — the artifact digest is copyable and copies the exact digest (SkillCard).
test("skill card digest is copyable and copies the exact artifact digest", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const item = showroomFixture();
  render(<SkillCard item={item} />);
  fireEvent.click(screen.getByRole("button", { name: /copy/i }));
  expect(writeText).toHaveBeenCalledWith(item.capability.release.artifactDigest);
});

// Fix 5 — the selected card (which showed no digest) now exposes the digest via a copy affordance.
test("selected card exposes the artifact digest via a copy affordance", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const item = selectedShowroomFixture();
  render(<SelectedSkillCard item={item} />);
  fireEvent.click(screen.getByRole("button", { name: /copy/i }));
  expect(writeText).toHaveBeenCalledWith(item.capability.release.artifactDigest);
});

// Managed activation always starts temporary. Pinning is offered only after an observed outcome.
test("approved card starts a temporary install without premature pinning; blocked card offers an exit", () => {
  const { rerender } = render(<SkillCard item={showroomFixture()} />);
  expect(screen.getByRole("link", { name: /install\b.*temporary/i })).toBeTruthy();
  expect(screen.queryByRole("link", { name: /^pin$/i })).toBeNull();
  expect(screen.queryByText("Client handoff")).toBeNull();

  const blocked = showroomFixture({ trust: { ...showroomFixture().capability.trust, status: "revoked" } });
  rerender(<SkillCard item={blocked} />);
  expect(screen.queryByText("Install blocked")).toBeNull();
  expect(screen.getByRole("link", { name: /see alternatives/i })).toBeTruthy();
});

// Fix 7 — the per-card "Share preview" action is gone from the action row.
test("cards no longer surface a per-card Share preview action", () => {
  const { rerender } = render(<SkillCard item={showroomFixture()} />);
  expect(screen.queryByRole("link", { name: /share preview/i })).toBeNull();

  rerender(<SelectedSkillCard item={selectedShowroomFixture()} />);
  expect(screen.queryByRole("link", { name: /share preview/i })).toBeNull();
});

// Fix 8 — the illustrative example card demonstrates the permission anatomy (and drops the forbidden label).
test("example card demonstrates the permission anatomy honestly", () => {
  render(<ExampleSkillCard />);
  expect(screen.getByText(/no shell/i)).toBeTruthy();
  expect(screen.getByText(/network/i)).toBeTruthy();
  expect(screen.queryByText(/instruction harness/i)).toBeNull();
});
