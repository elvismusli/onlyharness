import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { SuperSkillInstallHandoff } from "../../../core/superskill-install";

const harness = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const handoffOverride = vi.hoisted(() => ({ value: undefined as SuperSkillInstallHandoff | undefined }));

vi.mock("../../../core/store", () => ({ useHarness: () => harness.value }));

vi.mock("../../../core/superskill-install", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../core/superskill-install")>();
  return {
    ...actual,
    superskillInstallHandoff: (
      capability?: Parameters<typeof actual.superskillInstallHandoff>[0],
      runtime?: Parameters<typeof actual.superskillInstallHandoff>[1]
    ) => handoffOverride.value ?? actual.superskillInstallHandoff(capability, runtime)
  };
});

import { DocsPage } from "./DocsPage";
import { InstallHandoff } from "./InstallHandoff";
import { PublishPage } from "./PublishPage";
import { WorkspacesPage } from "./WorkspacesPage";

// Built by concatenation so this test file itself never contains the literal
// forbidden claim substrings that scripts/check-public-copy.ts scans for.
const BANNED = new RegExp(["\\bsafe\\b", "\\bsafety\\b", "guaran" + "teed", "100" + "%"].join("|"), "i");
const confirmedUser = { email: "ada@example.com", email_confirmed_at: "2026-07-14T00:00:00Z", user_metadata: {} };
// Deterministic "available" installer so the install-steps UI renders regardless of the
// real pinned-runtime publish state (which is fail-closed to "unavailable" until published).
const AVAILABLE_HANDOFF: SuperSkillInstallHandoff = {
  status: "available",
  installUrl: "https://superskill.sh/api/superskill/install",
  installCommand: "npx --yes onlyharness@0.2.19 superskill install https://superskill.sh/api/superskill/install --auto",
  runtime: "onlyharness@0.2.19"
};

function defaultHarness(): Record<string, unknown> {
  return {
    user: null,
    accessToken: undefined,
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
    loadWorkspaceSetupBundle: vi.fn().mockResolvedValue(undefined),
    workspaceSetupStatus: "",
    workspaceSetupBundle: undefined,
    joinWorkspace: vi.fn().mockResolvedValue(undefined)
  };
}

function workspaceCatalog(resource: Record<string, unknown>) {
  return {
    workspace: { slug: "acme", name: "Acme", type: "team", visibility: "private", plan: "team" },
    resources: [resource],
    items: [],
    collections: [],
    joinPolicies: [],
    permissions: { totalResources: 1, hostedArchives: 0, unscanned: 0, riskTiers: {} },
    audit: []
  };
}

beforeEach(() => {
  window.location.hash = "";
  harness.value = defaultHarness();
  handoffOverride.value = undefined;
});

afterEach(() => vi.unstubAllGlobals());

// ---- Fix 1: banned safety words in Docs + InstallHandoff -------------------

test("docs use-section drops safety wording for an evaluate-before-activate heading", () => {
  const { container } = render(<DocsPage />);
  expect(screen.getByRole("heading", { name: "Evaluate a resource before you activate it" })).toBeTruthy();
  expect(container.textContent ?? "").not.toMatch(BANNED);
  expect(container.textContent ?? "").not.toMatch(/integrity-verified/i);
});

test("install handoff replaces the safety-boundary aside with a does/doesn't summary", () => {
  handoffOverride.value = AVAILABLE_HANDOFF;
  const { container } = render(<InstallHandoff />);
  expect(screen.getByText(/What this does and doesn't do/)).toBeTruthy();
  expect(container.textContent ?? "").not.toMatch(BANNED);
});

// ---- Fix 2: glossary — no "package" in labels/prose -----------------------

test("publish names the primary field Resource name, never Package name", () => {
  harness.value = { ...defaultHarness(), user: confirmedUser, accessToken: "session" };
  const { container } = render(<PublishPage />);
  expect(screen.getByLabelText("Resource name")).toBeTruthy();
  expect(screen.queryByLabelText("Package name")).toBeNull();
  expect(container.textContent ?? "").not.toMatch(/\bpackage\b/i);
});

test("publish immutability prose speaks in releases, not versions/packages", () => {
  harness.value = { ...defaultHarness(), user: confirmedUser, accessToken: "session" };
  render(<PublishPage />);
  expect(screen.getByText(/Each public release is immutable/)).toBeTruthy();
});

test("workspace private-resource note avoids the word package", () => {
  harness.value = {
    ...defaultHarness(),
    user: confirmedUser,
    workspaceCatalog: workspaceCatalog({
      id: "@acme/solo",
      title: "Solo skill",
      summary: "Team only",
      resourceType: "skill",
      installability: "workspace_hosted"
    })
  };
  const { container } = render(<WorkspacesPage />);
  expect(screen.getByText(/Private resource access/)).toBeTruthy();
  expect(container.textContent ?? "").not.toMatch(/\bpackage\b/i);
});

// ---- Fix 3: one-action copy for digest + terminal login command -----------

test("published artifact digest is copyable in one action", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });
  const digest = "a".repeat(64);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    resourceId: "onlyharness:packages/my-agent-skill",
    version: "0.1.0",
    artifactDigest: digest,
    trust: "unreviewed",
    replay: false,
    archiveUrl: "https://superskill.sh/api/resources/release/archive",
    verified: false
  }), { status: 201 })));
  harness.value = { ...defaultHarness(), user: confirmedUser, accessToken: "session" };
  render(<PublishPage />);
  fireEvent.submit(screen.getByRole("button", { name: "Publish release" }).closest("form")!);
  await screen.findByRole("heading", { name: "onlyharness:packages/my-agent-skill@0.1.0" });

  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(digest));
});

// NOTE: Fix 3's "AccountPage terminal login command" half is obsolete. A
// concurrent change removed the device-auth card from AccountPage and moved the
// terminal-connect flow to a separate ConnectPage; the updated
// account-workspaces.test.tsx now asserts `hh auth login --shell` is absent from
// AccountPage. There is no inline command left to wrap there. The PublishPage
// digest CopyField (above) is the surviving, implemented half of fix 3.

// ---- Fix 4: automatic client detection + manual fallback + blocked exits ---

test("install handoff states detection is automatic and offers a not-listed manual path", () => {
  handoffOverride.value = AVAILABLE_HANDOFF;
  render(<InstallHandoff />);
  expect(screen.getByText(/detects .*automatically/i)).toBeTruthy();
  expect(screen.getByText("My client isn't Codex or Claude Code")).toBeTruthy();
});

test("blocked universal installer still offers an exit back to the showroom", () => {
  handoffOverride.value = {
    status: "unavailable",
    installUrl: null,
    installCommand: null,
    runtime: "cli",
    reasonCode: "CLI_INTEGRITY_UNPINNED",
    reason: "The official npm integrity is not pinned."
  };
  render(<InstallHandoff />);
  expect(screen.getByRole("heading", { level: 1, name: "Universal installer not available yet" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open showroom" })).toHaveAttribute("href", "#/superskill");
});

// ---- Fix 5: workspace consistency + reversibility -------------------------

test("workspace membership reads confirmed, matching account states", () => {
  harness.value = {
    ...defaultHarness(),
    user: confirmedUser,
    workspaceCatalog: workspaceCatalog({
      id: "@acme/solo",
      title: "Solo skill",
      summary: "Team only",
      resourceType: "skill",
      installability: "workspace_hosted"
    })
  };
  render(<WorkspacesPage />);
  expect(screen.getByText("Membership confirmed")).toBeTruthy();
  expect(screen.queryByText("Membership verified")).toBeNull();
});

test("workspace members view surfaces a reversibility affordance for invites and membership", () => {
  harness.value = {
    ...defaultHarness(),
    user: confirmedUser,
    workspaceMembers: [{ id: "m1", user_id: "user:opaque", source: "direct", role: "owner", status: "active" }],
    workspaceCatalog: workspaceCatalog({
      id: "@acme/solo",
      title: "Solo skill",
      summary: "Team only",
      resourceType: "skill",
      installability: "workspace_hosted"
    })
  };
  render(<WorkspacesPage />);
  fireEvent.click(screen.getByRole("tab", { name: "members" }));
  expect(screen.getByText(/reversible/i)).toBeTruthy();
  expect(screen.getByText(/remove a member/i)).toBeTruthy();
});
