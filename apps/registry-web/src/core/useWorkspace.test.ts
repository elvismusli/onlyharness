import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useWorkspace } from "./useWorkspace";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

test("workspaceHeadersForOwner uses workspace token first, then user session auth", () => {
  const { result, rerender } = renderHook(({ accessToken }: { accessToken?: string }) => useWorkspace({ accessToken }), {
    initialProps: { accessToken: "member-jwt" }
  });

  expect(result.current.workspaceHeadersForOwner("@acme")).toEqual({ Authorization: "Bearer member-jwt" });
  expect(result.current.workspaceHeadersForOwner("@other")).toEqual({});

  act(() => {
    result.current.setWorkspaceToken("workspace-token");
  });

  expect(result.current.workspaceHeadersForOwner("@acme")).toEqual({ Authorization: "Bearer workspace-token" });

  rerender({ accessToken: "different-member-jwt" });
  expect(result.current.workspaceHeadersForOwner("@acme")).toEqual({ Authorization: "Bearer workspace-token" });
});

test("loadWorkspace reads the resource-first workspace catalog and members", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/workspace")) {
      expect(init?.headers).toEqual({ Authorization: "Bearer member-jwt" });
      return responseJson({
        workspace: { slug: "acme", name: "Acme Agents", type: "company", visibility: "private", plan: "team" },
        resources: [],
        items: [],
        collections: [],
        permissions: { totalResources: 0, hostedArchives: 0, unscanned: 0, riskTiers: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0, UNKNOWN: 0 } },
        audit: []
      });
    }
    if (url.includes("/members")) {
      expect(init?.headers).toEqual({ Authorization: "Bearer member-jwt" });
      return responseJson({
        members: [{ user_id: "user-1", role: "member", status: "active", source: "invite", joined_at: "2026-07-08T00:00:00.000Z" }]
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useWorkspace({ accessToken: "member-jwt" }));

  await act(async () => {
    await result.current.loadWorkspace();
  });

  expect(result.current.workspaceCatalog?.workspace.name).toBe("Acme Agents");
  expect(result.current.workspaceMembers[0]?.user_id).toBe("user-1");
  expect(result.current.workspaceStatus).toContain("Loaded 0 workspace resources");
  expect(localStorage.getItem("hh:workspaceSlug")).toBe("acme");
});

test("createWorkspaceInvite returns the raw code once and stores it in memory", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(init?.headers).toEqual({ Authorization: "Bearer workspace-token", "content-type": "application/json" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ role: "viewer", maxUses: 3 });
    return responseJson({
      invite: { role: "viewer", usesCount: 0, createdAt: "2026-07-08T00:00:00.000Z" },
      code: "ohwi_secret"
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useWorkspace());
  act(() => {
    result.current.setWorkspaceToken("workspace-token");
    result.current.setWorkspaceInviteRole("viewer");
    result.current.setWorkspaceInviteMaxUses("3");
  });

  await act(async () => {
    await result.current.createWorkspaceInvite();
  });

  expect(result.current.workspaceInviteCode).toBe("ohwi_secret");
  expect(result.current.workspaceInviteStatus).toContain("Show this code once");
});

test("joinWorkspace uses the signed-in user session, not the automation token", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/join")) {
      expect(init?.headers).toEqual({ Authorization: "Bearer member-jwt", "content-type": "application/json" });
      expect(JSON.parse(String(init?.body))).toEqual({ code: "ohwi_join" });
      return responseJson({
        member: { user_id: "member-1", role: "member", status: "active", source: "invite", joined_at: "2026-07-08T00:00:00.000Z" }
      });
    }
    if (url.endsWith("/workspace")) {
      return responseJson({
        workspace: { slug: "acme", name: "Acme Agents", type: "company", visibility: "private", plan: "team" },
        resources: [],
        items: [],
        collections: [],
        permissions: { totalResources: 0, hostedArchives: 0, unscanned: 0, riskTiers: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0, UNKNOWN: 0 } },
        audit: []
      });
    }
    if (url.includes("/members")) return responseJson({ members: [] });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useWorkspace({ accessToken: "member-jwt", requireUser: vi.fn(() => true) }));
  act(() => {
    result.current.setWorkspaceToken("workspace-token");
    result.current.setWorkspaceJoinCode("ohwi_join");
  });

  await act(async () => {
    await result.current.joinWorkspace();
  });

  expect(result.current.workspaceJoinStatus).toBe("Joined as member.");
  expect(result.current.workspaceJoinCode).toBe("");
});

test("createWorkspaceSubscriptionCheckout creates a receipt without claiming access", async () => {
  const onFlash = vi.fn();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/workspace")) {
      return responseJson({
        workspace: { slug: "acme", name: "Acme Agents", type: "company", visibility: "private", plan: "team" },
        resources: [],
        items: [],
        collections: [],
        joinPolicies: [{ id: "paid-main", kind: "paid_subscription", status: "active", role: "member", title: "Paid members", config: { subscriptionProduct: "acme-pro" }, createdAt: "2026-07-08T00:00:00.000Z", updatedAt: "2026-07-08T00:00:00.000Z" }],
        permissions: { totalResources: 0, hostedArchives: 0, unscanned: 0, riskTiers: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0, UNKNOWN: 0 } },
        audit: []
      });
    }
    if (url.includes("/members")) return responseJson({ members: [] });
    if (url.includes("/subscriptions/me")) {
      expect(init?.headers).toEqual({ Authorization: "Bearer member-jwt" });
      return responseJson({ subscriptions: [] });
    }
    if (url.includes("/subscriptions/checkout")) {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ Authorization: "Bearer member-jwt", "content-type": "application/json" });
      expect(JSON.parse(String(init?.body))).toEqual({ policyId: "paid-main" });
      return responseJson({
        policy: { id: "paid-main" },
        checkout_url: "https://onlyharness.com/workspaces/acme/checkout/manual_sub_test",
        subscription: {
          id: "sub-1",
          workspaceSlug: "acme",
          userId: "user-1",
          policyId: "paid-main",
          provider: "manual",
          providerSubscriptionRef: "manual_sub_test",
          status: "incomplete",
          accessUntil: null,
          cancelAtPeriodEnd: false,
          checkoutUrl: "https://onlyharness.com/workspaces/acme/checkout/manual_sub_test",
          portalUrl: "https://onlyharness.com/workspaces/acme/subscriptions/manual_sub_test",
          createdAt: "2026-07-08T00:00:00.000Z",
          updatedAt: "2026-07-08T00:00:00.000Z"
        }
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useWorkspace({ accessToken: "member-jwt", onFlash }));

  await act(async () => {
    await result.current.loadWorkspace();
  });

  await act(async () => {
    await result.current.createWorkspaceSubscriptionCheckout();
  });

  expect(result.current.workspaceSubscriptions[0]?.status).toBe("incomplete");
  expect(result.current.workspaceSubscriptions[0]?.accessUntil).toBeNull();
  expect(result.current.workspaceSubscriptionStatus).toContain("Access starts only after provider webhook confirms payment");
  expect(onFlash).toHaveBeenCalledWith("Workspace subscription checkout created");
});

test("approveWorkspaceResource adds a public resource to a workspace approval list", async () => {
  const onFlash = vi.fn();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/collections/sandbox/items")) {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ Authorization: "Bearer workspace-token", "content-type": "application/json" });
      expect(JSON.parse(String(init?.body))).toEqual({
        resourceId: "onlyharness:harnesses/deep-market-researcher",
        name: "researcher",
        note: "approved for team"
      });
      return responseJson({
        resource: { id: "@acme/researcher" },
        approvalState: "approved"
      });
    }
    if (url.endsWith("/workspace")) {
      expect(init?.headers).toEqual({ Authorization: "Bearer workspace-token" });
      return responseJson({
        workspace: { slug: "acme", name: "Acme Agents", type: "company", visibility: "private", plan: "team" },
        resources: [{ id: "@acme/researcher" }],
        items: [{ id: "@acme/researcher" }],
        collections: [{ slug: "sandbox", title: "Sandbox", visibility: "workspace", createdAt: "2026-07-08T00:00:00.000Z", updatedAt: "2026-07-08T00:00:00.000Z", items: [] }],
        permissions: { totalResources: 1, hostedArchives: 0, unscanned: 0, riskTiers: { LOW: 1, MEDIUM: 0, HIGH: 0, CRITICAL: 0, UNKNOWN: 0 } },
        audit: []
      });
    }
    if (url.includes("/members")) return responseJson({ members: [] });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useWorkspace({ onFlash }));
  act(() => {
    result.current.setWorkspaceToken("workspace-token");
    result.current.setWorkspaceCollectionSlug("sandbox");
    result.current.setWorkspaceApprovalResourceId("onlyharness:harnesses/deep-market-researcher");
    result.current.setWorkspaceApprovalName("researcher");
    result.current.setWorkspaceApprovalNote("approved for team");
  });

  await act(async () => {
    await result.current.approveWorkspaceResource();
  });

  expect(result.current.workspaceApprovalResourceId).toBe("");
  expect(result.current.workspaceApprovalName).toBe("");
  expect(result.current.workspaceApprovalNote).toBe("");
  expect(result.current.workspaceCollectionStatus).toContain("Approved @acme/researcher");
  expect(result.current.workspaceCatalog?.resources[0]?.id).toBe("@acme/researcher");
  expect(onFlash).toHaveBeenCalledWith("Workspace resource approved");
});

test("removeWorkspaceCollectionItem deletes an approval item and reloads the workspace", async () => {
  const onFlash = vi.fn();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/collections/approved/items/approved%3Aitem-1")) {
      expect(init?.method).toBe("DELETE");
      expect(init?.headers).toEqual({ Authorization: "Bearer member-jwt" });
      return responseJson({
        item: { id: "approved:item-1", itemRef: "@acme/deep-market-researcher" },
        removedResourceId: "@acme/deep-market-researcher"
      });
    }
    if (url.endsWith("/workspace")) {
      return responseJson({
        workspace: { slug: "acme", name: "Acme Agents", type: "company", visibility: "private", plan: "team" },
        resources: [],
        items: [],
        collections: [{ slug: "approved", title: "Approved resources", visibility: "workspace", createdAt: "2026-07-08T00:00:00.000Z", updatedAt: "2026-07-08T00:00:00.000Z", items: [] }],
        permissions: { totalResources: 0, hostedArchives: 0, unscanned: 0, riskTiers: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0, UNKNOWN: 0 } },
        audit: []
      });
    }
    if (url.includes("/members")) return responseJson({ members: [] });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useWorkspace({ accessToken: "member-jwt", onFlash }));

  await act(async () => {
    await result.current.removeWorkspaceCollectionItem("approved", "approved:item-1");
  });

  expect(result.current.workspaceCollectionStatus).toContain("Removed @acme/deep-market-researcher");
  expect(result.current.workspaceCatalog?.resources).toEqual([]);
  expect(onFlash).toHaveBeenCalledWith("Workspace collection item removed");
});

function responseJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body
  } as Response;
}
