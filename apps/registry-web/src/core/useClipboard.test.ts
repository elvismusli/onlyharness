import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useClipboard } from "./useClipboard";

// jsdom does not implement document.execCommand, so `copyWithSelection` would
// otherwise throw a real TypeError and always fall through. Install a stub we
// control (returning false = "selection copy missed") so both copyText branches
// are reachable deterministically, then remove it after each test.
function stubExecCommand(returns: boolean) {
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    writable: true,
    value: vi.fn(() => returns)
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (document as { execCommand?: unknown }).execCommand;
});

test("copyText success sets copiedTag, flashes the label, then clears the tag after 1.6s", async () => {
  stubExecCommand(false); // selection copy misses → clipboard.writeText path
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });

  const onFlash = vi.fn();
  const { result } = renderHook(() => useClipboard({ onFlash }));

  await act(async () => {
    result.current.copyText("x", "label", "t");
  });

  expect(writeText).toHaveBeenCalledWith("x");
  expect(result.current.copiedTag).toBe("t");
  expect(onFlash).toHaveBeenCalledWith("label");

  act(() => {
    vi.advanceTimersByTime(1600);
  });

  expect(result.current.copiedTag).toBe("");
});

test("copyText failure sets copyFallback; dismissFallback clears it", async () => {
  // Both copy paths must fail: selection copy returns false AND writeText rejects.
  stubExecCommand(false);
  const writeText = vi.fn().mockRejectedValue(new Error("denied"));
  vi.stubGlobal("navigator", { clipboard: { writeText } });

  const onFlash = vi.fn();
  const { result } = renderHook(() => useClipboard({ onFlash }));

  await act(async () => {
    result.current.copyText("secret-cmd", "Copy this", "tag");
  });

  expect(result.current.copyFallback).toEqual({ label: "Copy this", text: "secret-cmd" });
  // On failure the success flash must NOT fire; the fallback notice does.
  expect(onFlash).toHaveBeenCalledWith("Clipboard unavailable — command shown");
  expect(onFlash).not.toHaveBeenCalledWith("Copy this");
  expect(result.current.copiedTag).toBe("");

  act(() => {
    result.current.dismissFallback();
  });

  expect(result.current.copyFallback).toBeNull();
});

test("copyText without a tag flashes but leaves copiedTag empty", async () => {
  stubExecCommand(false);
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });

  const onFlash = vi.fn();
  const { result } = renderHook(() => useClipboard({ onFlash }));

  await act(async () => {
    result.current.copyText("x", "label");
  });

  expect(onFlash).toHaveBeenCalledWith("label");
  expect(result.current.copiedTag).toBe("");
});

test("useClipboard works without an onFlash callback", async () => {
  stubExecCommand(false);
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });

  const { result } = renderHook(() => useClipboard());

  await act(async () => {
    result.current.copyText("x", "label", "t");
  });

  expect(result.current.copiedTag).toBe("t");
});
