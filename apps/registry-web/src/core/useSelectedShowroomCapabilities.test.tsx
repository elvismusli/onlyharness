import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { selectedShowroomFixture } from "../test/superskill-fixtures";
import { useSelectedShowroomCapabilities } from "./useSelectedShowroomCapabilities";

afterEach(() => vi.unstubAllGlobals());

test("maps the public selected shelf and forwards category without credentials", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [selectedShowroomFixture()], total: 1, generatedAt: "2026-07-12T00:00:00Z" }), { status: 200 })));
  const { result } = renderHook(() => useSelectedShowroomCapabilities({ limit: 12, job: "market-research" }));
  await waitFor(() => expect(result.current.state.status).toBe("success"));
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/showroom/selected?limit=12&job=market-research"), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(result.current.state.status === "success" && result.current.state.data.items[0].managedHandoff).toEqual({ status: "blocked", reason: "review_required" });
});

test("does not request selected supply while disabled", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useSelectedShowroomCapabilities({ enabled: false }));
  expect(result.current.state.status).toBe("idle");
  expect(fetchMock).not.toHaveBeenCalled();
});
