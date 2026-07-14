import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";

import type { EvidenceLevel, ManagedCapability, TrustCheck } from "../../../core/superskill-types";
import { capabilityFixture } from "../../../test/superskill-fixtures";
import { TrustReport } from "./TrustReport";

function check(id: TrustCheck["id"], status: TrustCheck["status"] = "pass"): TrustCheck {
  return {
    id,
    status,
    evidenceLevel: "static_checked" as EvidenceLevel,
    checkedAt: "2026-07-10T00:00:00.000Z",
    summary: `${id} evidence summary`
  };
}

function withChecks(checks: TrustCheck[]): ManagedCapability {
  return capabilityFixture({
    trust: {
      status: "approved",
      riskScore: 12,
      riskTier: "LOW",
      checks,
      limitations: ["Does not prove behavior against every untrusted input."],
      reviewedAt: "2026-07-10T00:00:00.000Z"
    }
  });
}

function namedCheckColumn(): string[] {
  return screen
    .getAllByRole("cell")
    .filter((cell) => cell.getAttribute("data-label") === "Named check")
    .map((cell) => (cell.textContent ?? "").trim());
}

test("named checks render in canonical order regardless of input array order", () => {
  const shuffled: TrustCheck["id"][] = [
    "human_review",
    "artifact_digest",
    "independent_eval",
    "schema",
    "codex_activation",
    "source_license",
    "capability_diff",
    "static_security",
    "claude_code_activation"
  ];
  render(<TrustReport capability={withChecks(shuffled.map((id) => check(id)))} />);
  expect(namedCheckColumn()).toEqual([
    "Schema",
    "Artifact digest",
    "Static security",
    "Source and license",
    "Declared vs static observations",
    "Claude Code activation",
    "Codex activation",
    "Independent evaluation",
    "Human review"
  ]);
});

test("a mandated check absent from the data still renders as not_run instead of being omitted", () => {
  render(<TrustReport capability={withChecks([check("artifact_digest")])} />);
  const nameCells = screen
    .getAllByRole("cell")
    .filter((cell) => cell.getAttribute("data-label") === "Named check");
  const humanReviewCell = nameCells.find((cell) => (cell.textContent ?? "").trim() === "Human review");
  expect(humanReviewCell).toBeTruthy();
  const row = humanReviewCell!.closest('[role="row"]')!;
  expect(within(row as HTMLElement).getByText(/not run/i)).toBeTruthy();
});

test("type chip is driven from the resource type and never says instruction harness", () => {
  render(<TrustReport capability={capabilityFixture()} />);
  expect(screen.queryByText(/instruction harness/i)).toBeNull();
  // Still renders a resource-type label (driven from capability.type, not deleted).
  expect(screen.getByText("Resource")).toBeTruthy();
});

test("a declared shell permission renders a critical risk row with human-consequence text", () => {
  const capability = capabilityFixture({
    permissions: { ...capabilityFixture().permissions, shell: true }
  });
  render(<TrustReport capability={capability} />);
  const consequence = screen.getByText("Can run shell commands on your machine");
  const row = consequence.closest("[data-risk]");
  expect(row).toBeTruthy();
  expect(row!.getAttribute("data-risk")).toBe("critical");
});

test("declared permissions tell the user they will see the permission delta at install", () => {
  render(<TrustReport capability={capabilityFixture()} />);
  const note = screen.getByText(/permission delta/i);
  expect(note.className).toContain("ss-delta-note");
  expect(note.textContent?.toLowerCase()).toContain("install");
});

test("a rescan history region is present with an honest empty fallback when no history exists", () => {
  render(<TrustReport capability={capabilityFixture()} />);
  expect(screen.getByRole("heading", { name: /rescan history/i })).toBeTruthy();
  expect(screen.getByText(/no rescan history yet/i)).toBeTruthy();
});

test("every table row contains only cell or header children (no stray non-cell child)", () => {
  render(<TrustReport capability={withChecks([check("artifact_digest"), check("human_review", "warn")])} />);
  const allowed = new Set(["cell", "columnheader", "rowheader"]);
  for (const row of screen.getAllByRole("row")) {
    for (const child of Array.from(row.children)) {
      expect(allowed.has(child.getAttribute("role") ?? "")).toBe(true);
    }
  }
});

test("limitations render when supplied and fall back honestly when empty", () => {
  const { unmount } = render(
    <TrustReport capability={withChecks([check("artifact_digest")])} />
  );
  expect(screen.getByText("Does not prove behavior against every untrusted input.")).toBeTruthy();
  unmount();

  const noLimits = capabilityFixture({
    trust: { ...capabilityFixture().trust, limitations: [] }
  });
  render(<TrustReport capability={noLimits} />);
  expect(screen.getByText(/no limitations were supplied/i)).toBeTruthy();
});
