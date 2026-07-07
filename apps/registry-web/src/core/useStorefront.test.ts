import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { useStorefront } from "./useStorefront";
import type { RegistryItem, StorefrontPage } from "./types";

function makeOpts(overrides: Partial<Parameters<typeof useStorefront>[0]> = {}) {
  return {
    session: null,
    accessToken: undefined,
    cacheItems: vi.fn(),
    onFlash: vi.fn(),
    onNeedAuth: vi.fn(),
    ...overrides
  };
}

function makePage(): StorefrontPage {
  return {
    profile: { handle: "founder", display_name: "Founder Tools", bio: "" },
    referralCode: "REF123",
    items: [{ owner: "acme", name: "widget" } as RegistryItem]
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("loadStorefront fetches an uncached handle, caches the page and merges its items", async () => {
  const page = makePage();
  const fetchMock = vi.fn().mockResolvedValue({ json: async () => page });
  vi.stubGlobal("fetch", fetchMock);

  const opts = makeOpts();
  const { result } = renderHook(() => useStorefront(opts));

  act(() => {
    result.current.loadStorefront("founder");
  });

  await waitFor(() => expect(result.current.storefronts.founder).toEqual(page));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(opts.cacheItems).toHaveBeenCalledWith(page.items);
});

test("loadStorefront does not refetch a handle already in the cache", async () => {
  const page = makePage();
  const fetchMock = vi.fn().mockResolvedValue({ json: async () => page });
  vi.stubGlobal("fetch", fetchMock);

  const opts = makeOpts();
  const { result } = renderHook(() => useStorefront(opts));

  act(() => {
    result.current.loadStorefront("founder");
  });
  await waitFor(() => expect(result.current.storefronts.founder).toEqual(page));

  act(() => {
    result.current.loadStorefront("founder");
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
});
