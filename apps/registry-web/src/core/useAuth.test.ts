import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";

import { useAuth } from "./useAuth";

// These assert pure hook state transitions that hold regardless of whether
// Supabase is configured: `session` is null on the first synchronous render
// (the async getSession() bootstrap has not resolved yet), which is exactly the
// "no user" case requireUser guards — so no auth network stub is needed.

test("requireUser with no session returns false and opens the logon dialog with the note", () => {
  const { result } = renderHook(() => useAuth());

  expect(result.current.logon).toEqual({ open: false, note: "" });
  expect(result.current.user).toBeNull();

  let allowed = true;
  act(() => {
    allowed = result.current.requireUser("Log on to star harnesses.");
  });

  expect(allowed).toBe(false);
  expect(result.current.logon).toEqual({ open: true, note: "Log on to star harnesses." });
});

test("openLogon opens with the note and clears status; closeLogon resets both open and note", () => {
  const { result } = renderHook(() => useAuth());

  act(() => {
    result.current.openLogon("Log on to publish a harness.");
  });
  expect(result.current.logon).toEqual({ open: true, note: "Log on to publish a harness." });
  expect(result.current.authStatus).toBe("");

  act(() => {
    result.current.closeLogon();
  });
  expect(result.current.logon).toEqual({ open: false, note: "" });
});
