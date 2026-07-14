import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ value: {} as Record<string, any> }));

vi.mock("../../../core/store", () => ({
  useHarness: () => harness.value
}));

import { ConnectPage } from "./ConnectPage";

const requestId = `ohrq_${"A".repeat(43)}`;
const browserProof = `ohbp_${"B".repeat(43)}`;

beforeEach(() => {
  window.history.replaceState(null, "", `/?skin=superskill#/superskill/connect?request=${requestId}`);
  harness.value = {
    user: null,
    accessToken: undefined,
    configured: true,
    authBusy: false,
    authStatus: "",
    oauthProviders: { google: true, github: true },
    signInWithOAuth: vi.fn().mockResolvedValue(undefined),
    signIn: vi.fn().mockResolvedValue(undefined),
    signUp: vi.fn().mockResolvedValue(undefined),
    resendConfirmation: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined)
  };
});

afterEach(() => vi.unstubAllGlobals());

test("binds a fragment proof once, scrubs it immediately, and renders the sanitized request context", async () => {
  window.history.replaceState(null, "", `/?skin=superskill#/superskill/connect?request=${requestId}&proof=${browserProof}`);
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({ bound: true, request_id: requestId }))
    .mockResolvedValueOnce(contextResponse());
  vi.stubGlobal("fetch", fetchMock);

  render(<ConnectPage requestId={requestId} browserProof={browserProof} />);

  expect(window.location.hash).toBe(`#/superskill/connect?request=${requestId}`);
  expect(window.location.href).not.toContain(browserProof);
  await waitFor(() => expect(screen.getByRole("heading", { name: "Connect Codex to SuperSkill" })).toBeTruthy());
  expect(fetchMock.mock.calls[0]).toEqual([
    "http://127.0.0.1:8787/auth/agent/browser-bind",
    expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ request_id: requestId, browser_proof: browserProof })
    })
  ]);
  expect(fetchMock.mock.calls[1][0]).toBe(`http://127.0.0.1:8787/auth/agent/context?request_id=${requestId}`);
  expect(screen.getByText("Publish and update resources")).toBeTruthy();
  expect(document.body.textContent).not.toContain(browserProof);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

test("offers Google before GitHub and keeps email as the fallback", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(contextResponse()));
  render(<ConnectPage requestId={requestId} />);

  await screen.findByRole("heading", { name: "Sign in to continue" });
  const socialButtons = screen.getAllByRole("button").filter((button) => button.textContent?.startsWith("Continue with"));
  expect(socialButtons.map((button) => button.textContent)).toEqual(["Continue with Google", "Continue with GitHub"]);
  fireEvent.click(socialButtons[0]!);
  fireEvent.click(socialButtons[1]!);
  expect(harness.value.signInWithOAuth).toHaveBeenNthCalledWith(1, "google");
  expect(harness.value.signInWithOAuth).toHaveBeenNthCalledWith(2, "github");
  expect(screen.getByLabelText("Email")).toBeTruthy();
  expect(screen.getByLabelText("Password")).toBeTruthy();
});

test("requires explicit Continue and sends the browser session only in the authorization header", async () => {
  harness.value = {
    ...harness.value,
    user: { email: "ada@example.com", email_confirmed_at: "2026-07-14T00:00:00Z", user_metadata: { display_name: "Ada" } },
    accessToken: "browser-session-secret"
  };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(contextResponse())
    .mockResolvedValueOnce(jsonResponse({ approved: true }));
  vi.stubGlobal("fetch", fetchMock);
  render(<ConnectPage requestId={requestId} />);

  const continueButton = await screen.findByRole("button", { name: "Continue" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fireEvent.click(continueButton);

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(fetchMock.mock.calls[1]).toEqual([
    "http://127.0.0.1:8787/auth/agent/decision",
    expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer browser-session-secret"
      },
      body: JSON.stringify({ request_id: requestId, decision: "approve" })
    })
  ]);
  await screen.findByRole("heading", { name: "Agent connected" });
  expect(screen.getByText(/original task will continue automatically/i)).toBeTruthy();
  expect(document.body.textContent).not.toContain("browser-session-secret");
});

test("supports denial before login without creating an account session", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(contextResponse())
    .mockResolvedValueOnce(jsonResponse({ denied: true }));
  vi.stubGlobal("fetch", fetchMock);
  render(<ConnectPage requestId={requestId} />);

  fireEvent.click(await screen.findByRole("button", { name: "Deny request" }));
  await screen.findByRole("heading", { name: "Connection denied" });
  expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
    body: JSON.stringify({ request_id: requestId, decision: "deny" }),
    headers: { "Content-Type": "application/json" }
  }));
});

test("blocks approval until an email account is confirmed", async () => {
  harness.value = {
    ...harness.value,
    user: { email: "ada@example.com", email_confirmed_at: null, user_metadata: {} },
    accessToken: "browser-session-secret"
  };
  const fetchMock = vi.fn().mockResolvedValue(contextResponse());
  vi.stubGlobal("fetch", fetchMock);
  render(<ConnectPage requestId={requestId} />);

  expect(await screen.findByRole("button", { name: "Continue" })).toBeDisabled();
  expect(screen.getByText(/confirm your email/i)).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledOnce();
});

test("fails closed instead of presenting an unknown permission for consent", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ request: {
    id: requestId,
    client: "codex",
    client_name: "Codex",
    scopes: ["admin:all"],
    expires_at: "2099-07-14T12:00:00.000Z",
    status: "pending"
  } })));
  render(<ConnectPage requestId={requestId} />);

  expect(await screen.findByRole("heading", { name: "Connection unavailable" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
});

function contextResponse() {
  return jsonResponse({
    request: {
      id: requestId,
      client: "codex",
      client_name: "Codex",
      scopes: ["superskill:managed", "resources:publish"],
      expires_at: "2099-07-14T12:00:00.000Z",
      status: "pending"
    }
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
