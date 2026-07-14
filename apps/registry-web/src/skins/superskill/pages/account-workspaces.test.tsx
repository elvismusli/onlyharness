import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("../../../core/store", () => ({
  useHarness: () => harness.value
}));

import { AccountPage } from "./AccountPage";
import { WorkspacesPage } from "./WorkspacesPage";

beforeEach(() => {
  window.location.hash = "";
  harness.value = {
    user: null,
    configured: true,
    authBusy: false,
    authStatus: "",
    oauthProviders: { google: false, github: false },
    oauthProvidersReady: true,
    signInWithOAuth: vi.fn().mockResolvedValue(undefined),
    signIn: vi.fn().mockResolvedValue(undefined),
    signUp: vi.fn().mockResolvedValue(undefined),
    resendConfirmation: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    workspaceCreateName: "",
    setWorkspaceCreateName: vi.fn(),
    workspaceCreateStatus: "",
    createWorkspace: vi.fn().mockResolvedValue(undefined),
    workspaceSlug: "acme",
    setWorkspaceSlug: vi.fn(),
    workspaceBusy: false,
    workspaceStatus: "",
    workspaceCatalog: undefined,
    workspaceMembers: [],
    workspaceJoinCode: "",
    setWorkspaceJoinCode: vi.fn(),
    workspaceJoinStatus: "",
    workspaceInviteRole: "member",
    setWorkspaceInviteRole: vi.fn(),
    workspaceInviteMaxUses: "1",
    setWorkspaceInviteMaxUses: vi.fn(),
    workspaceInviteCode: "",
    workspaceInviteShareUrl: "",
    workspaceInviteStatus: "",
    workspaceCollectionSlug: "approved",
    setWorkspaceCollectionSlug: vi.fn(),
    workspaceApprovalResourceId: "",
    setWorkspaceApprovalResourceId: vi.fn(),
    workspaceApprovalVersion: "",
    setWorkspaceApprovalVersion: vi.fn(),
    workspaceApprovalArtifactDigest: "",
    setWorkspaceApprovalArtifactDigest: vi.fn(),
    workspaceApprovalNote: "",
    setWorkspaceApprovalNote: vi.fn(),
    workspaceCollectionStatus: "",
    approveWorkspaceResource: vi.fn().mockResolvedValue(undefined),
    createWorkspaceInvite: vi.fn().mockResolvedValue(undefined),
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

test("account renders only OAuth providers enabled by live auth settings", () => {
  const signInWithOAuth = vi.fn().mockResolvedValue(undefined);
  harness.value = {
    ...harness.value,
    oauthProviders: { google: true, github: false },
    signInWithOAuth
  };
  render(<AccountPage />);

  fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
  expect(signInWithOAuth).toHaveBeenCalledWith("google");
  expect(screen.queryByRole("button", { name: "Continue with GitHub" })).toBeNull();
});

test("account invite flow blocks social redirect and keeps email in the original tab", () => {
  const invite = `ohwi_${"A".repeat(24)}`;
  window.location.hash = `#/superskill/account?workspace=acme&invite=${invite}`;
  harness.value = {
    ...harness.value,
    oauthProviders: { google: true, github: true }
  };
  render(<AccountPage />);

  expect(screen.getByText(/social sign-in is disabled on this link/i)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Continue with GitHub" })).toBeNull();
  expect(window.location.hash).toContain(invite);
  expect(sessionStorage.length).toBe(0);
});

test("signed-in account preserves a fragment-only workspace invite continuation", () => {
  window.location.hash = "#/superskill/account?workspace=acme&invite=invite-once";
  harness.value = {
    ...harness.value,
    user: { email: "ada@example.com", email_confirmed_at: "2026-07-14T00:00:00Z", user_metadata: {} }
  };
  render(<AccountPage />);

  expect(screen.getByRole("link", { name: "Continue to workspace" })).toHaveAttribute(
    "href",
    "#/superskill/workspaces?workspace=acme&invite=invite-once"
  );
});

test("confirmed account does not expose the legacy terminal-code authorization flow", () => {
  harness.value = {
    ...harness.value,
    user: { email: "ada@example.com", email_confirmed_at: "2026-07-14T00:00:00Z", user_metadata: {} },
    accessToken: "browser-session-secret"
  };
  render(<AccountPage />);

  expect(screen.queryByLabelText("One-time code")).toBeNull();
  expect(screen.queryByText(/hh auth login --shell/i)).toBeNull();
  expect(screen.queryByText(/terminal authorization/i)).toBeNull();
  expect(screen.queryByText("browser-session-secret")).toBeNull();
  expect(screen.getByRole("link", { name: "Publish a skill" })).toHaveAttribute("href", "#/superskill/publish");
});

test("workspaces fail closed for a signed-out visitor", () => {
  render(<WorkspacesPage />);
  expect(screen.getByRole("heading", { name: "Sign in required" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open account" })).toHaveAttribute("href", "#/superskill/account");
  expect(screen.queryByLabelText("Workspace slug")).toBeNull();
});

test("signed-out exact approval link carries its immutable tuple into account registration", () => {
  const digest = "c".repeat(64);
  window.location.hash = `#/superskill/workspaces?workspace=acme&resource=onlyharness%3Apackages%2Fresearch&version=3.1.4&digest=${digest}&approve=1`;
  render(<WorkspacesPage />);

  expect(screen.getByRole("link", { name: "Open account" })).toHaveAttribute(
    "href",
    `#/superskill/account?workspace=acme&resource=onlyharness%3Apackages%2Fresearch&version=3.1.4&digest=${digest}&approve=1`
  );
});

test("workspace curation continuation keeps the exact release tuple in the fragment-only flow", async () => {
  const digest = "a".repeat(64);
  window.location.hash = `#/superskill/workspaces?workspace=acme&resource=onlyharness%3Apackages%2Fresearch&version=1.2.3&digest=${digest}&approve=1`;
  const setWorkspaceSlug = vi.fn();
  const setWorkspaceApprovalResourceId = vi.fn();
  const setWorkspaceApprovalVersion = vi.fn();
  const setWorkspaceApprovalArtifactDigest = vi.fn();
  const loadWorkspace = vi.fn().mockResolvedValue(undefined);
  harness.value = {
    ...harness.value,
    user: { email: "ada@example.com", email_confirmed_at: "2026-07-14T00:00:00Z" },
    setWorkspaceSlug,
    setWorkspaceApprovalResourceId,
    setWorkspaceApprovalVersion,
    setWorkspaceApprovalArtifactDigest,
    loadWorkspace
  };
  render(<WorkspacesPage />);

  await waitFor(() => expect(setWorkspaceSlug).toHaveBeenCalledWith("acme"));
  expect(setWorkspaceApprovalResourceId).toHaveBeenCalledWith("onlyharness:packages/research");
  expect(setWorkspaceApprovalVersion).toHaveBeenCalledWith("1.2.3");
  expect(setWorkspaceApprovalArtifactDigest).toHaveBeenCalledWith(digest);
  expect(loadWorkspace).toHaveBeenCalledWith("acme");
});

test("cold exact workspace link waits for auth hydration and then loads once", async () => {
  const digest = "e".repeat(64);
  window.location.hash = `#/superskill/workspaces?workspace=acme&resource=onlyharness%3Apackages%2Fcold-skill&version=4.2.0&digest=${digest}&approve=1`;
  const setWorkspaceSlug = vi.fn();
  const setWorkspaceApprovalResourceId = vi.fn();
  const setWorkspaceApprovalVersion = vi.fn();
  const setWorkspaceApprovalArtifactDigest = vi.fn();
  const loadWorkspace = vi.fn().mockResolvedValue(undefined);
  harness.value = {
    ...harness.value,
    user: undefined,
    setWorkspaceSlug,
    setWorkspaceApprovalResourceId,
    setWorkspaceApprovalVersion,
    setWorkspaceApprovalArtifactDigest,
    loadWorkspace
  };
  const rendered = render(<WorkspacesPage />);
  expect(loadWorkspace).not.toHaveBeenCalled();

  harness.value = {
    ...harness.value,
    user: { id: "user-cold", email: "cold@example.com", email_confirmed_at: "2026-07-14T00:00:00Z" }
  };
  rendered.rerender(<WorkspacesPage />);

  await waitFor(() => expect(loadWorkspace).toHaveBeenCalledWith("acme"));
  expect(setWorkspaceSlug).toHaveBeenCalledOnce();
  expect(setWorkspaceApprovalResourceId).toHaveBeenCalledWith("onlyharness:packages/cold-skill");
  expect(setWorkspaceApprovalVersion).toHaveBeenCalledWith("4.2.0");
  expect(setWorkspaceApprovalArtifactDigest).toHaveBeenCalledWith(digest);
  rendered.rerender(<WorkspacesPage />);
  expect(loadWorkspace).toHaveBeenCalledOnce();
});

test("incomplete exact approval link is visibly rejected without prefill", () => {
  window.location.hash = "#/superskill/workspaces?workspace=acme&resource=onlyharness%3Apackages%2Fresearch&version=1.2.3&digest=bad&approve=1";
  const setWorkspaceApprovalResourceId = vi.fn();
  harness.value = {
    ...harness.value,
    user: { email: "ada@example.com", email_confirmed_at: "2026-07-14T00:00:00Z" },
    setWorkspaceApprovalResourceId
  };
  render(<WorkspacesPage />);

  expect(screen.getByRole("status")).toHaveTextContent(/approval link is incomplete or was changed/i);
  expect(setWorkspaceApprovalResourceId).not.toHaveBeenCalled();
});

test("signed-in workspace captures a valid invite and scrubs the raw code from the address bar", async () => {
  const invite = `ohwi_${"A".repeat(24)}`;
  window.location.hash = `#/superskill/workspaces?workspace=acme&invite=${invite}`;
  const setWorkspaceJoinCode = vi.fn();
  harness.value = {
    ...harness.value,
    user: { email: "ada@example.com", email_confirmed_at: "2026-07-14T00:00:00Z" },
    setWorkspaceJoinCode
  };
  render(<WorkspacesPage />);

  await waitFor(() => expect(setWorkspaceJoinCode).toHaveBeenCalledWith(invite));
  expect(window.location.hash).toBe("#/superskill/workspaces?workspace=acme");
  expect(window.location.href).not.toContain(invite);
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

  fireEvent.submit(screen.getAllByLabelText("Workspace slug")[1].closest("form")!);
  fireEvent.submit(screen.getByLabelText("Invite code").closest("form")!);
  expect(loadWorkspace).toHaveBeenCalledOnce();
  expect(joinWorkspace).toHaveBeenCalledOnce();
  expect(screen.getByText("No workspace loaded")).toBeTruthy();
});

test("confirmed account can create an invite-only workspace", () => {
  const createWorkspace = vi.fn().mockResolvedValue(undefined);
  const setWorkspaceCreateName = vi.fn();
  harness.value = {
    ...harness.value,
    user: { email: "ada@example.com", email_confirmed_at: "2026-07-14T00:00:00Z" },
    workspaceCreateName: "Research team",
    setWorkspaceCreateName,
    createWorkspace
  };
  render(<WorkspacesPage />);
  fireEvent.submit(screen.getByLabelText("Workspace name").closest("form")!);
  expect(createWorkspace).toHaveBeenCalledOnce();
});

test("unconfirmed account cannot create, load or join a workspace", () => {
  harness.value = {
    ...harness.value,
    user: { email: "ada@example.com", email_confirmed_at: null },
    workspaceCreateName: "Research team",
    workspaceJoinCode: "invite-once"
  };
  render(<WorkspacesPage />);

  expect(screen.getByText(/confirm your email before creating/i)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Create invite-only workspace" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Load workspace" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Join workspace" })).toBeDisabled();
});

test("verified workspace renders resources, members, collections and setup entrypoints", () => {
  const loadWorkspaceMembers = vi.fn().mockResolvedValue(undefined);
  const loadWorkspaceSetupBundle = vi.fn().mockResolvedValue(undefined);
  const createWorkspaceInvite = vi.fn().mockResolvedValue(undefined);
  const approveWorkspaceResource = vi.fn().mockResolvedValue(undefined);
  harness.value = {
    ...harness.value,
    user: { email: "ada@example.com", email_confirmed_at: "2026-07-14T00:00:00Z" },
    loadWorkspaceMembers,
    loadWorkspaceSetupBundle,
    createWorkspaceInvite,
    approveWorkspaceResource,
    workspaceApprovalResourceId: "onlyharness:packages/research",
    workspaceApprovalVersion: "1.2.3",
    workspaceApprovalArtifactDigest: "a".repeat(64),
    workspaceSetupStatus: "",
    workspaceMembers: [{ id: "member-1", user_id: "user:opaque", source: "direct", role: "owner", status: "active" }],
    workspaceCatalog: {
      workspace: { slug: "acme", name: "Acme", type: "team", visibility: "private", plan: "team" },
      resources: [{
        id: "@acme/research",
        title: "Research",
        summary: "Team research",
        resourceType: "skill",
        installability: "workspace_approved",
        workspaceApproval: { sourceResourceId: "onlyharness:packages/research", collectionSlug: "approved", approvalState: "approved" }
      }],
      items: [],
      collections: [{
        slug: "approved",
        title: "Approved",
        summary: "Reviewed",
        visibility: "workspace",
        items: [{
          id: "item-1",
          itemRef: "@acme/research",
          itemSource: "public_resource",
          sourceResourceId: "onlyharness:packages/research",
          pinnedVersion: "1.2.3",
          pinnedArchiveHash: "a".repeat(64),
          approvalState: "approved",
          createdAt: "2026-07-14T00:00:00.000Z",
          updatedAt: "2026-07-14T00:00:00.000Z"
        }]
      }],
      joinPolicies: [],
      permissions: { totalResources: 1, hostedArchives: 1, unscanned: 0, riskTiers: {} },
      audit: []
    }
  };
  render(<WorkspacesPage />);

  expect(screen.getByText("Research")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open exact 1.2.3" })).toHaveAttribute(
    "href",
    "#/superskill/resources/onlyharness%3Apackages%2Fresearch/releases/1.2.3"
  );
  expect(screen.getByText(/sha256:aaaaaaaaaaaa…/)).toBeTruthy();
  expect(screen.getByText("1.2.3")).toBeTruthy();
  expect(screen.getByText("a".repeat(64))).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Add to workspace" }));
  expect(approveWorkspaceResource).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("tab", { name: "members" }));
  expect(screen.getByText("Member ···opaque")).toBeTruthy();
  expect(screen.queryByText("user:opaque")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(loadWorkspaceMembers).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Create invite link" }));
  expect(createWorkspaceInvite).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("tab", { name: "collections" }));
  expect(screen.getByText("Approved")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "setup" }));
  expect(screen.getByText(/requires an existing/)).toHaveTextContent("HH_WORKSPACE_TOKEN");
  fireEvent.click(screen.getByRole("button", { name: "Load setup bundle" }));
  expect(loadWorkspaceSetupBundle).toHaveBeenCalledWith("codex");
  expect(screen.getByRole("link", { name: "Open universal installer" })).toHaveAttribute("href", "#/superskill/install");
});

test("workspace approved resources without a complete pin never resolve latest", () => {
  harness.value = {
    ...harness.value,
    user: { email: "ada@example.com", email_confirmed_at: "2026-07-14T00:00:00Z" },
    workspaceMembers: [],
    workspaceCatalog: {
      workspace: { slug: "acme", name: "Acme", type: "team", visibility: "private", plan: "team" },
      resources: [{
        id: "@acme/research",
        title: "Research",
        summary: "Team research",
        resourceType: "skill",
        installability: "workspace_approved",
        workspaceApproval: { sourceResourceId: "onlyharness:packages/research", collectionSlug: "approved", approvalState: "approved" }
      }],
      items: [],
      collections: [{ slug: "approved", title: "Approved", visibility: "workspace", items: [] }],
      joinPolicies: [],
      permissions: { totalResources: 1, hostedArchives: 0, unscanned: 0, riskTiers: {} },
      audit: []
    }
  };
  render(<WorkspacesPage />);

  expect(screen.getByText("Exact release pin missing — latest is not used.")).toBeTruthy();
  expect(screen.queryByRole("link", { name: /Open exact/ })).toBeNull();
});
