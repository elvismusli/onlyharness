import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";

import { authFailureMessage, oauthProvidersFromSettings, oauthRedirectUrl, RESEND_CONFIRMATION_REQUESTED_MESSAGE, safeSuperskillAuthContinuation, safeSuperskillExternalAuthContinuation, SIGNUP_CONFIRMATION_CONTINUATION_MESSAGE, useAuth, workspaceInviteFromContinuation } from "./useAuth";

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

test("opaque Supabase mailer failures become actionable instead of rendering an empty object", () => {
  expect(authFailureMessage({ message: "{}" }, "sign-up")).toBe("Account creation failed because the confirmation email service is unavailable. No account was created. Try again shortly.");
  expect(authFailureMessage(new Error("email rate limit exceeded"), "sign-up")).toBe("email rate limit exceeded");
  expect(authFailureMessage({}, "resend")).toBe("The confirmation email request failed. Try again shortly.");
});

test("resend success copy never claims account existence or delivery", () => {
  expect(RESEND_CONFIRMATION_REQUESTED_MESSAGE).toContain("does not prove that an account exists or that delivery succeeded");
  expect(RESEND_CONFIRMATION_REQUESTED_MESSAGE).not.toContain("email sent");
});

test("OAuth continuation is limited to safe SuperSkill account and workspace hashes", () => {
  expect(safeSuperskillAuthContinuation("#/superskill/account?workspace=acme&invite=once%20only"))
    .toBe("#/superskill/account?workspace=acme&invite=once+only");
  expect(safeSuperskillAuthContinuation("#/superskill/workspaces?workspace=acme"))
    .toBe("#/superskill/workspaces?workspace=acme");
  expect(safeSuperskillAuthContinuation("#/superskill/account?workspace=acme&resource=onlyharness%3Apackages%2Fresearch&approve=1"))
    .toBe("#/superskill/account?workspace=acme&resource=onlyharness%3Apackages%2Fresearch");
  expect(safeSuperskillAuthContinuation(`#/superskill/account?workspace=acme&resource=onlyharness%3Apackages%2Fresearch&version=1.2.3&digest=${"a".repeat(64)}&approve=1`))
    .toBe(`#/superskill/account?workspace=acme&resource=onlyharness%3Apackages%2Fresearch&approve=1&version=1.2.3&digest=${"a".repeat(64)}`);
  expect(safeSuperskillAuthContinuation("#/superskill/account?workspace=../admin&invite=secret"))
    .toBe("#/superskill/account?invite=secret");
  expect(safeSuperskillAuthContinuation("#/legacy/account?invite=secret"))
    .toBe("#/superskill/account");
});

test("agent connect continuations keep the request but strip the one-time browser proof", () => {
  const requestId = `ohrq_${"A".repeat(43)}`;
  const browserProof = `ohbp_${"B".repeat(43)}`;
  const hash = `#/superskill/connect?request=${requestId}&proof=${browserProof}`;
  expect(safeSuperskillAuthContinuation(hash)).toBe(`#/superskill/connect?request=${requestId}`);
  expect(safeSuperskillExternalAuthContinuation(hash)).toBe(`#/superskill/connect?request=${requestId}`);
  expect(oauthRedirectUrl({ origin: "https://superskill.sh", hash } as Location)).toBe(`https://superskill.sh/#/superskill/connect?request=${requestId}`);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

test("email signup copy promises automatic SuperSkill continuation instead of a second login", () => {
  expect(SIGNUP_CONFIRMATION_CONTINUATION_MESSAGE).toContain("confirmation link returns you to SuperSkill");
  expect(SIGNUP_CONFIRMATION_CONTINUATION_MESSAGE).not.toMatch(/log on|sign in/i);
});

test("approval continuation fails closed when its exact release tuple is missing or invalid", () => {
  const resource = "onlyharness%3Apackages%2Fresearch";
  expect(safeSuperskillAuthContinuation(`#/superskill/account?workspace=acme&resource=${resource}&approve=1`))
    .toBe("#/superskill/account?workspace=acme&resource=onlyharness%3Apackages%2Fresearch");
  expect(safeSuperskillAuthContinuation(`#/superskill/account?workspace=acme&resource=${resource}&version=1.2.3&digest=bad&approve=1`))
    .toBe("#/superskill/account?workspace=acme&resource=onlyharness%3Apackages%2Fresearch");
  expect(safeSuperskillAuthContinuation(`#/superskill/account?workspace=acme&resource=${resource}&version=latest&digest=${"a".repeat(64)}&approve=1`))
    .toBe("#/superskill/account?workspace=acme&resource=onlyharness%3Apackages%2Fresearch");
});

test("external auth redirect strips the raw invite", () => {
  expect(oauthRedirectUrl({
    origin: "https://superskill.sh",
    pathname: "/",
    hash: "#/superskill/account?workspace=acme&invite=invite-once"
  } as Location)).toBe("https://superskill.sh/#/superskill/account?workspace=acme");
  expect(safeSuperskillExternalAuthContinuation("#/superskill/account?workspace=acme&invite=invite-once"))
    .toBe("#/superskill/account?workspace=acme");
});

test("external auth never persists or transmits a raw invite", () => {
  const invite = `ohwi_${"A".repeat(24)}`;
  sessionStorage.clear();
  const redirect = oauthRedirectUrl({
    origin: "https://superskill.sh",
    hash: `#/superskill/account?workspace=acme&invite=${invite}`
  });

  expect(redirect).toBe("https://superskill.sh/#/superskill/account?workspace=acme");
  expect(redirect).not.toContain(invite);
  expect(sessionStorage.length).toBe(0);
  expect(workspaceInviteFromContinuation(`#/superskill/account?workspace=acme&invite=${invite}`)).toBe(invite);
});

test("invalid invite shapes never activate the private invite guard", () => {
  expect(workspaceInviteFromContinuation("#/superskill/account?workspace=acme&invite=invite-once")).toBeUndefined();
  expect(workspaceInviteFromContinuation("#/superskill/account?workspace=acme&invite=ohwi_short")).toBeUndefined();
});

test("OAuth provider discovery fails closed and enables only explicit live booleans", () => {
  expect(oauthProvidersFromSettings({ external: { google: true, github: false } }))
    .toEqual({ google: true, github: false });
  expect(oauthProvidersFromSettings({ external: { google: "true", github: 1 } }))
    .toEqual({ google: false, github: false });
  expect(oauthProvidersFromSettings(null)).toEqual({ google: false, github: false });
});
