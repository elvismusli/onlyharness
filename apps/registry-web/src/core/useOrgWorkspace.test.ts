import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useOrgWorkspace } from "./useOrgWorkspace";

function makeOpts(overrides: Partial<Parameters<typeof useOrgWorkspace>[0]> = {}) {
  return {
    cacheItems: vi.fn(),
    onFlash: vi.fn(),
    ...overrides
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

test("orgHeadersForOwner returns a Bearer header when the owner matches the slug and a token is set", () => {
  const { result } = renderHook(() => useOrgWorkspace(makeOpts()));

  // Default slug is "acme"; set the org token so the header can be produced.
  act(() => {
    result.current.setNetworkToken("secret-token");
  });

  expect(result.current.orgHeadersForOwner("@acme")).toEqual({ Authorization: "Bearer secret-token" });
});

test("orgHeadersForOwner returns {} when the owner does not match, or when no token is set", () => {
  const { result } = renderHook(() => useOrgWorkspace(makeOpts()));

  // No token yet, even for the matching owner.
  expect(result.current.orgHeadersForOwner("@acme")).toEqual({});

  act(() => {
    result.current.setNetworkToken("secret-token");
  });

  // Token set, but a non-org owner (or a plain owner without the "@" prefix) gets nothing.
  expect(result.current.orgHeadersForOwner("@other")).toEqual({});
  expect(result.current.orgHeadersForOwner("acme")).toEqual({});
});
