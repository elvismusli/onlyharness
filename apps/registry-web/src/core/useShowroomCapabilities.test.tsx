import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { showroomFixture } from "../test/superskill-fixtures";
import { useShowroomCapabilities } from "./useShowroomCapabilities";

afterEach(() => vi.unstubAllGlobals());

test("maps a valid public showroom response to success", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [showroomFixture()], total: 1, generatedAt: "2026-07-12T00:00:00Z" }), { status: 200, headers: { "content-type": "application/json" } })));
  const { result } = renderHook(() => useShowroomCapabilities({ limit: 6 }));
  await waitFor(() => expect(result.current.state.status).toBe("success"));
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/showroom/capabilities?limit=6"), expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

test("preserves honest empty and API error states", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0, generatedAt: "2026-07-12T00:00:00Z" }), { status: 200 })));
  const empty = renderHook(() => useShowroomCapabilities());
  await waitFor(() => expect(empty.result.current.state.status).toBe("empty"));
  empty.unmount();

  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Managed index invalid", code: "CATALOG_NOT_READY", next: "Retry later" }), { status: 503 })));
  const failed = renderHook(() => useShowroomCapabilities());
  await waitFor(() => expect(failed.result.current.state.status).toBe("error"));
  expect(failed.result.current.state).toMatchObject({ code: "CATALOG_NOT_READY", next: "Retry later" });
});
