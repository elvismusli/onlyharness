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

function responseJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body
  } as Response;
}
