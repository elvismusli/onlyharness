import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { useSocial, type UseSocialOptions } from "./useSocial";
import { keyFor } from "./format";
import type { RegistryItem } from "./types";

// Minimal RegistryItem fixture: toggleStar only reads owner/name (via keyFor)
// and title, so the rest is filled with inert defaults to satisfy the type
// without affecting behaviour.
function item(partial: Pick<RegistryItem, "owner" | "name"> & Partial<RegistryItem>): RegistryItem {
  return {
    ownerLabel: partial.owner,
    title: partial.name,
    summary: "",
    tags: [],
    job: "",
    outcome: "",
    runtime: "",
    valid: true,
    riskScore: 0,
    riskTier: "LOW",
    evalStatus: "none",
    evalScore: 0,
    security: { verdict: "pass", findings: 0, scanner: "none" },
    contextCost: { approxTokens: 0, files: 0, bytes: 0, status: "estimated" },
    standard: "conformant",
    forks: 0,
    stars: 0,
    threads: 0,
    runs: 0,
    installConfirms: 0,
    signalCount: 0,
    heatQualified: false,
    heat: 0,
    heatDelta: 0,
    freshness: "",
    badge: "",
    cliCommand: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial
  };
}

// Baseline opts: no session (the star-map bootstrap effect no-ops without a
// Supabase session), an access token so toggleStar reaches the network call,
// and a requireUser stub that always allows so the gate never short-circuits.
function makeOpts(overrides?: Partial<UseSocialOptions>): UseSocialOptions {
  return {
    session: null,
    accessToken: "token-123",
    requireUser: () => true,
    openLogon: vi.fn(),
    cacheItem: vi.fn(),
    prependItem: vi.fn(),
    bumpRefresh: vi.fn(),
    copyText: vi.fn(),
    openHarness: vi.fn(),
    showDialog: vi.fn(),
    onFlash: vi.fn(),
    ...overrides
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("toggleStar sets the star optimistically before the network call resolves", async () => {
  // A fetch that never resolves keeps toggleStar parked on `await fetch`, so the
  // only state change observable is the optimistic setStarred that runs first.
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

  const target = item({ owner: "acme", name: "market-research" });
  const key = keyFor(target);
  const { result } = renderHook(() => useSocial(makeOpts()));

  expect(result.current.starred[key]).toBeUndefined();

  act(() => {
    void result.current.toggleStar(target);
  });

  expect(result.current.starred[key]).toBe(true);
});

test("toggleStar rolls the star back to false when the star request rejects", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

  const onFlash = vi.fn();
  const target = item({ owner: "acme", name: "market-research" });
  const key = keyFor(target);
  const { result } = renderHook(() => useSocial(makeOpts({ onFlash })));

  await act(async () => {
    await result.current.toggleStar(target);
  });

  // Optimistic true is reverted to false (not deleted) on the caught rejection,
  // and the error is surfaced via onFlash rather than the success flash.
  await waitFor(() => expect(result.current.starred[key]).toBe(false));
  expect(onFlash).toHaveBeenCalledWith("network down");
});
