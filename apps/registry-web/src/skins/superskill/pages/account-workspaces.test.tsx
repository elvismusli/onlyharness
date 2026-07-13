import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("../../../core/store", () => ({
  useHarness: () => harness.value
}));

import { AccountPage } from "./AccountPage";
import { WorkspacesPage } from "./WorkspacesPage";

beforeEach(() => {
  harness.value = {
    user: null,
    configured: true,
    authBusy: false,
    authStatus: "",
    signIn: vi.fn().mockResolvedValue(undefined),
    signUp: vi.fn().mockResolvedValue(undefined),
    resendConfirmation: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    workspaceSlug: "acme",
    setWorkspaceSlug: vi.fn(),
    workspaceBusy: false,
    workspaceStatus: "",
    workspaceCatalog: undefined,
    workspaceMembers: [],
    workspaceJoinCode: "",
    setWorkspaceJoinCode: vi.fn(),
    workspaceJoinStatus: "",
    loadWorkspace: vi.fn().mockResolvedValue(undefined),
    loadWorkspaceMembers: vi.fn().mockResolvedValue(undefined),
    joinWorkspace: vi.fn().mockResolvedValue(undefined)
  };
});

afterEach(() => vi.unstubAllGlobals());

test("account uses the shared confirmation-first sign-up flow", () => {
  const signUp = vi.fn().mockResolvedValue(undefined);
  harness.value = { ...harness.value, signUp };
  render(<AccountPage />);

  fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Ada" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse battery staple" } });
  fireEvent.submit(screen.getByLabelText("Email").closest("form")!);

  expect(signUp).toHaveBeenCalledWith("Ada", "ada@example.com", "correct horse battery staple");
  expect(screen.getByText(/send a confirmation link/i)).toBeTruthy();
});

test("signed-in account shows confirmation state but never exposes the session token", () => {
  const signOut = vi.fn().mockResolvedValue(undefined);
  harness.value = {
    ...harness.value,
    user: { email: "ada@example.com", email_confirmed_at: "2026-07-14T00:00:00Z", user_metadata: { display_name: "Ada" } },
    accessToken: "must-not-render",
    signOut
  };
  render(<AccountPage />);

  expect(screen.getByText("Email confirmed")).toBeTruthy();
  expect(screen.queryByText("must-not-render")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(signOut).toHaveBeenCalledOnce();
});

test("signed-out account can resend confirmation through the shared auth hook", () => {
  const resendConfirmation = vi.fn().mockResolvedValue(undefined);
  harness.value = { ...harness.value, resendConfirmation };
  render(<AccountPage />);

  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Resend confirmation email" }));
  expect(resendConfirmation).toHaveBeenCalledWith("ada@example.com");
});

test("confirmed account approves a terminal code without displaying or persisting credentials", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ approved: true, expires_in: 1800 }), {
    status: 200,
    headers: { "content-type": "application/json" }
  }));
  vi.stubGlobal("fetch", fetchMock);
  harness.value = {
    ...harness.value,
    user: { email: "ada@example.com", email_confirmed_at: "2026-07-14T00:00:00Z", user_metadata: {} },
    accessToken: "browser-session-secret"
  };
  render(<AccountPage />);

  fireEvent.change(screen.getByLabelText("One-time code"), { target: { value: "abcd2345" } });
  expect(screen.getByLabelText("One-time code")).toHaveValue("ABCD-2345");
  fireEvent.submit(screen.getByLabelText("One-time code").closest("form")!);

  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/auth/device/approve", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer browser-session-secret"
    },
    body: JSON.stringify({ user_code: "ABCD-2345" })
  });
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Terminal approved"));
  expect(screen.getByLabelText("One-time code")).toHaveValue("");
  expect(screen.queryByText("browser-session-secret")).toBeNull();
  expect(screen.getByRole("link", { name: "Publish a skill" })).toHaveAttribute("href", "#/superskill/publish");
});

test("unconfirmed account cannot approve a terminal", () => {
  harness.value = {
    ...harness.value,
    user: { email: "ada@example.com", email_confirmed_at: null, user_metadata: {} },
    accessToken: "browser-session-secret"
  };
  render(<AccountPage />);
  expect(screen.getByText("Confirm your email before approving a terminal.")).toBeTruthy();
  expect(screen.queryByLabelText("One-time code")).toBeNull();
});

test("workspaces fail closed for a signed-out visitor", () => {
  render(<WorkspacesPage />);
  expect(screen.getByRole("heading", { name: "Sign in required" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open account" })).toHaveAttribute("href", "#/superskill/account");
  expect(screen.queryByLabelText("Workspace slug")).toBeNull();
});

test("workspace load and invite join reuse the existing authenticated actions", () => {
  const loadWorkspace = vi.fn().mockResolvedValue(undefined);
  const joinWorkspace = vi.fn().mockResolvedValue(undefined);
  const setWorkspaceJoinCode = vi.fn();
  harness.value = {
    ...harness.value,
    user: { email: "ada@example.com", email_confirmed_at: "2026-07-14T00:00:00Z" },
    workspaceJoinCode: "invite-once",
    setWorkspaceJoinCode,
    loadWorkspace,
    joinWorkspace
  };
  render(<WorkspacesPage />);

  fireEvent.submit(screen.getByLabelText("Workspace slug").closest("form")!);
  fireEvent.submit(screen.getByLabelText("Invite code").closest("form")!);
  expect(loadWorkspace).toHaveBeenCalledOnce();
  expect(joinWorkspace).toHaveBeenCalledOnce();
  expect(screen.getByText("No workspace loaded")).toBeTruthy();
});

test("verified workspace renders resources, members, collections and setup entrypoints", () => {
  const loadWorkspaceMembers = vi.fn().mockResolvedValue(undefined);
  const loadWorkspaceSetupBundle = vi.fn().mockResolvedValue(undefined);
  harness.value = {
    ...harness.value,
    user: { email: "ada@example.com", email_confirmed_at: "2026-07-14T00:00:00Z" },
    loadWorkspaceMembers,
    loadWorkspaceSetupBundle,
    workspaceSetupStatus: "",
    workspaceMembers: [{ id: "member-1", user_id: "user:opaque", source: "direct", role: "owner", status: "active" }],
    workspaceCatalog: {
      workspace: { slug: "acme", name: "Acme", type: "team", visibility: "private", plan: "team" },
      resources: [{ id: "@acme/research", title: "Research", summary: "Team research", resourceType: "skill", installability: "hosted" }],
      items: [],
      collections: [{ slug: "approved", title: "Approved", summary: "Reviewed", visibility: "workspace", items: [{ id: "item-1" }] }],
      joinPolicies: [],
      permissions: { totalResources: 1, hostedArchives: 1, unscanned: 0, riskTiers: {} },
      audit: []
    }
  };
  render(<WorkspacesPage />);

  expect(screen.getByText("Research")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "members" }));
  expect(screen.getByText("Member ···opaque")).toBeTruthy();
  expect(screen.queryByText("user:opaque")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(loadWorkspaceMembers).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("tab", { name: "collections" }));
  expect(screen.getByText("Approved")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "setup" }));
  expect(screen.getByText(/requires an existing/)).toHaveTextContent("HH_WORKSPACE_TOKEN");
  fireEvent.click(screen.getByRole("button", { name: "Load setup bundle" }));
  expect(loadWorkspaceSetupBundle).toHaveBeenCalledWith("codex");
  expect(screen.getByRole("link", { name: "Open universal installer" })).toHaveAttribute("href", "#/superskill/install");
});
