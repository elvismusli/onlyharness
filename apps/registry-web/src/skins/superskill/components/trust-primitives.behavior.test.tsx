import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { capabilityFixture } from "../../../test/superskill-fixtures";
import { ConsentPanel } from "./ConsentPanel";
import { LifecycleChain } from "./LifecycleChain";
import { PermissionDelta } from "./PermissionDelta";

afterEach(() => vi.unstubAllGlobals());

describe("LifecycleChain", () => {
  test("renders the five honest lifecycle states in order for a verified outcome", () => {
    render(<LifecycleChain mode="temporary" executionState="outcome_success" outcomeEvidence="agent_reported" />);
    expect(screen.getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual([
      "Installed",
      "Detected",
      "Loaded",
      "Invoked",
      "Outcome verified"
    ]);
  });

  test("never shows the non-glossary label Ready and maps the internal ready state onto Detected", () => {
    render(<LifecycleChain mode="pinned" executionState="ready" />);
    expect(screen.queryByText("Ready")).toBeNull();
    expect(screen.getByRole("listitem", { name: "Detected" })).toHaveAttribute("data-complete", "true");
    expect(screen.getByRole("listitem", { name: "Loaded" })).not.toHaveAttribute("data-complete", "true");
  });

  test.each(["outcome_failed", "outcome_unknown"] as const)(
    "shows a %s outcome as failed/unknown, never as a completed pass step",
    (state) => {
      render(<LifecycleChain mode="temporary" executionState={state} />);
      const failureLabel = state === "outcome_failed" ? "Outcome failed" : "Outcome unknown";
      expect(screen.getByText(failureLabel)).toBeTruthy();
      expect(screen.queryByText("Outcome verified")).toBeNull();
      expect(screen.getByRole("listitem", { name: failureLabel })).not.toHaveAttribute("data-complete", "true");
    }
  );
});

describe("PermissionDelta", () => {
  test("lists critical added powers before lower-risk ones regardless of input order", () => {
    render(<PermissionDelta delta={{ status: "known", added: ["telemetry", "shell"], unchanged: [] }} />);
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    const criticalIndex = rows.findIndex((text) => /run shell commands/i.test(text));
    const lowIndex = rows.findIndex((text) => /telemetry/i.test(text));
    expect(criticalIndex).toBeGreaterThanOrEqual(0);
    expect(lowIndex).toBeGreaterThan(criticalIndex);
  });
});

describe("ConsentPanel", () => {
  test("T3 embeds the trust report: named checks, mandatory limitations, and critical-first permission rows", () => {
    render(
      <ConsentPanel
        tier="T3"
        capability={capabilityFixture()}
        delta={{ status: "known", added: ["telemetry", "shell"], unchanged: [] }}
      />
    );
    expect(screen.getByRole("heading", { name: /named checks/i })).toBeTruthy();
    expect(screen.getByText("Exact digest matched.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /limitations/i })).toBeTruthy();
    expect(screen.getByText("Does not prove behavior against every untrusted input.")).toBeTruthy();
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    const criticalIndex = rows.findIndex((text) => /run shell commands/i.test(text));
    const lowIndex = rows.findIndex((text) => /telemetry/i.test(text));
    expect(criticalIndex).toBeGreaterThanOrEqual(0);
    expect(lowIndex).toBeGreaterThan(criticalIndex);
  });

  test("T3 keeps the confirm gated behind the checkbox and never auto-focuses it", () => {
    render(<ConsentPanel tier="T3" capability={capabilityFixture()} delta={{ status: "known", added: ["shell"], unchanged: [] }} />);
    const confirm = screen.getByRole("button", { name: "Continue in client" });
    expect(document.activeElement).not.toBe(confirm);
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirm).not.toBeDisabled();
  });

  test("T3 without trust data degrades gracefully but still gates the confirm", () => {
    render(<ConsentPanel tier="T3" delta={{ status: "partial", added: ["shell"], unchanged: [], unknownBecause: "Unknown client policy." }} />);
    const confirm = screen.getByRole("button", { name: "Continue in client" });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirm).not.toBeDisabled();
  });

  test("T2 exposes Alternatives alongside Cancel and the primary, with a why-this and trust line", () => {
    const onAlternatives = vi.fn();
    render(
      <ConsentPanel
        tier="T2"
        capability={capabilityFixture()}
        delta={{ status: "known", added: ["shell"], unchanged: [] }}
        onAlternatives={onAlternatives}
      />
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue in client" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /alternatives/i }));
    expect(onAlternatives).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Builds a source-backed market map.")).toBeTruthy();
    expect(screen.getByText(/named check/i)).toBeTruthy();
  });
});
