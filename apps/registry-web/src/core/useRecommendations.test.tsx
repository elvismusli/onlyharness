import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { RecommendationRequest, RecommendationResponse } from "./superskill-types";
import { useRecommendations } from "./useRecommendations";

const request: RecommendationRequest = { task: "map the market", context: { client: "codex", os: "unknown", arch: "unknown", installedManagedRefs: [] } };
const base: RecommendationResponse = { recommendationId: "rec_x", decisionDigest: `sha256:${"b".repeat(64)}`, decision: "no_safe_match", confidence: 0, alternatives: [], expiresAt: "2026-07-12T00:15:00Z" };

test("has no browser recommendation transport by default", async () => {
  const { result } = renderHook(() => useRecommendations());
  await act(() => result.current.recommend(request));
  expect(result.current.state).toMatchObject({ status: "error", code: "RECOMMENDATION_TRANSPORT_UNAVAILABLE" });
});

test.each([
  ["recommend", "recommend"],
  ["needs_clarification", "clarify"],
  ["no_safe_match", "no_match"]
] as const)("maps %s decisions to %s state", async (decision, expected) => {
  const transport = vi.fn().mockResolvedValue({ ...base, decision });
  const { result } = renderHook(() => useRecommendations({ transport }));
  await act(() => result.current.recommend({ ...request, task: "  map   the market  " }));
  expect(result.current.state.status).toBe(expected);
  expect(transport.mock.calls[0][0].task).toBe("map the market");
});

test("rejects secret-shaped task content before transport", async () => {
  const transport = vi.fn();
  const { result } = renderHook(() => useRecommendations({ transport }));
  await act(() => result.current.recommend({ ...request, task: "token=secret_value_123" }));
  expect(result.current.state).toMatchObject({ status: "error", code: "TASK_CONTAINS_SECRET" });
  expect(transport).not.toHaveBeenCalled();
});
