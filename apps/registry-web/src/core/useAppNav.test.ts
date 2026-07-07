import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";

import { useAppNav } from "./useAppNav";

test("open dedups on (kind, key): opening the same harness twice reuses one surface and its id", () => {
  const { result } = renderHook(() => useAppNav());

  let firstId = "";
  act(() => {
    firstId = result.current.open("harness", { key: "owner/name" });
  });
  expect(result.current.surfaces).toHaveLength(1);
  expect(firstId).toBe("harness:owner/name");
  expect(result.current.activeId).toBe(firstId);

  let secondId = "";
  act(() => {
    secondId = result.current.open("harness", { key: "owner/name" });
  });
  // Same (kind, key) -> same id, no new surface.
  expect(secondId).toBe(firstId);
  expect(result.current.surfaces).toHaveLength(1);
  expect(result.current.activeId).toBe(firstId);
});

test("open appends a new surface for a different key, preserving insertion order", () => {
  const { result } = renderHook(() => useAppNav());

  act(() => {
    result.current.open("harness", { key: "a/one" });
  });
  let secondId = "";
  act(() => {
    secondId = result.current.open("harness", { key: "b/two" });
  });

  expect(result.current.surfaces.map((surface) => surface.id)).toEqual(["harness:a/one", "harness:b/two"]);
  expect(secondId).toBe("harness:b/two");
  expect(result.current.activeId).toBe("harness:b/two");
});

test("keyless kinds use the bare kind as id and dedup on it", () => {
  const { result } = renderHook(() => useAppNav());

  let id = "";
  act(() => {
    id = result.current.open("leaderboard");
  });
  expect(id).toBe("leaderboard");

  act(() => {
    result.current.open("leaderboard");
  });
  expect(result.current.surfaces).toHaveLength(1);
  expect(result.current.surfaces[0]?.id).toBe("leaderboard");
});

test("close removes the surface and clears active only when it was the active one", () => {
  const { result } = renderHook(() => useAppNav());

  act(() => {
    result.current.open("harness", { key: "a/one" });
  });
  act(() => {
    result.current.open("harness", { key: "b/two" });
  });
  // "b/two" is active; closing the inactive "a/one" must leave active untouched.
  act(() => {
    result.current.close("harness:a/one");
  });
  expect(result.current.surfaces.map((surface) => surface.id)).toEqual(["harness:b/two"]);
  expect(result.current.activeId).toBe("harness:b/two");

  // Closing the active surface clears the active id.
  act(() => {
    result.current.close("harness:b/two");
  });
  expect(result.current.surfaces).toHaveLength(0);
  expect(result.current.activeId).toBe("");
});

test("focus sets the active surface without adding or removing surfaces", () => {
  const { result } = renderHook(() => useAppNav());

  act(() => {
    result.current.open("harness", { key: "a/one" });
  });
  act(() => {
    result.current.open("harness", { key: "b/two" });
  });
  act(() => {
    result.current.focus("harness:a/one");
  });
  expect(result.current.activeId).toBe("harness:a/one");
  expect(result.current.surfaces).toHaveLength(2);
});

test("setTab updates only the targeted surface's tab", () => {
  const { result } = renderHook(() => useAppNav());

  act(() => {
    result.current.open("harness", { key: "a/one" });
  });
  act(() => {
    result.current.open("harness", { key: "b/two" });
  });
  act(() => {
    result.current.setTab("harness:a/one", "Trust");
  });

  expect(result.current.find("harness", "a/one")?.tab).toBe("Trust");
  expect(result.current.find("harness", "b/two")?.tab).toBeUndefined();
});

test("find locates a surface by (kind, key) and returns undefined when absent", () => {
  const { result } = renderHook(() => useAppNav());

  act(() => {
    result.current.open("harness", { key: "a/one" });
  });

  expect(result.current.find("harness", "a/one")?.id).toBe("harness:a/one");
  expect(result.current.find("harness", "missing/key")).toBeUndefined();
  expect(result.current.find("leaderboard")).toBeUndefined();
});
