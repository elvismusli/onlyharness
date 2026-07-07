import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { usePublish } from "./usePublish";

function makeOpts(overrides: Partial<Parameters<typeof usePublish>[0]> = {}) {
  return {
    requireUser: vi.fn(() => true),
    accessToken: "token",
    setQuery: vi.fn(),
    setJobFilter: vi.fn(),
    bumpRefresh: vi.fn(),
    closePublish: vi.fn(),
    showDialog: vi.fn(),
    ...overrides
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("submitImport gates on requireUser: no user means no fetch and no busy toggle", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const opts = makeOpts({ requireUser: vi.fn(() => false) });
  const { result } = renderHook(() => usePublish(opts));

  await act(async () => {
    await result.current.submitImport();
  });

  expect(opts.requireUser).toHaveBeenCalledWith("Log on to publish a harness.");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(result.current.importBusy).toBe(false);
  expect(result.current.importStatus).toBe("");
});
