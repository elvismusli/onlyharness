import { useEffect, useState } from "react";

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SEARCH_QUERY_MAX_LENGTH = 200;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SEARCH_RESOURCE_TYPES = new Set([
  "harness",
  "skill",
  "plugin",
  "workflow",
  "mcp_server",
  "service_endpoint",
  "agent_team",
  "subagent_pack",
  "command_pack",
  "config",
  "guide",
  "framework",
  "agent_runtime",
  "directory"
] as const);

export type SuperSkillSearchResourceType =
  | "harness"
  | "skill"
  | "plugin"
  | "workflow"
  | "mcp_server"
  | "service_endpoint"
  | "agent_team"
  | "subagent_pack"
  | "command_pack"
  | "config"
  | "guide"
  | "framework"
  | "agent_runtime"
  | "directory";

export type SuperSkillRoute =
  | { name: "landing" }
  | { name: "docs" }
  | { name: "agent-guide" }
  | { name: "account" }
  | { name: "publish" }
  | { name: "workspaces" }
  | { name: "search"; query?: string; resourceType?: SuperSkillSearchResourceType }
  | { name: "resource"; resourceId: string; version?: string }
  | { name: "capability"; capabilityId: string }
  | { name: "selected"; owner: string; skill: string }
  | { name: "install"; capabilityId?: string }
  | { name: "category"; job: string }
  | { name: "not-found" };

export function parseSuperSkillRoute(hash: string): SuperSkillRoute {
  const withoutHash = hash.replace(/^#/, "");
  const queryStart = withoutHash.indexOf("?");
  const raw = (queryStart === -1 ? withoutHash : withoutHash.slice(0, queryStart)).replace(/\/+$/, "") || "/";
  const search = new URLSearchParams(queryStart === -1 ? "" : withoutHash.slice(queryStart + 1));
  if (raw === "/" || raw === "/superskill") return { name: "landing" };
  const parts = raw.split("/").filter(Boolean).map(decodeSegment);
  if (parts.some((part) => part === null) || parts[0] !== "superskill") return { name: "not-found" };
  if (parts.length === 2 && parts[1] === "docs") return { name: "docs" };
  if (parts.length === 2 && parts[1] === "agent-guide") return { name: "agent-guide" };
  if (parts.length === 2 && parts[1] === "account") return { name: "account" };
  if (parts.length === 2 && parts[1] === "publish") return { name: "publish" };
  if (parts.length === 2 && parts[1] === "workspaces") return { name: "workspaces" };
  if (parts.length === 2 && parts[1] === "search") {
    const query = search.get("q")?.trim() || undefined;
    const resourceType = search.get("type") || undefined;
    if (query && query.length > SEARCH_QUERY_MAX_LENGTH) return { name: "not-found" };
    if (resourceType && !validSearchResourceType(resourceType)) return { name: "not-found" };
    const normalizedType: SuperSkillSearchResourceType | undefined = resourceType as SuperSkillSearchResourceType | undefined;
    return { name: "search", ...(query ? { query } : {}), ...(normalizedType ? { resourceType: normalizedType } : {}) };
  }
  if (parts.length === 3 && parts[1] === "resources" && validResourceId(parts[2])) {
    return { name: "resource", resourceId: parts[2]! };
  }
  if (parts.length === 5 && parts[1] === "resources" && validResourceId(parts[2]) && parts[3] === "releases" && validSemver(parts[4])) {
    return { name: "resource", resourceId: parts[2]!, version: parts[4]! };
  }
  if (parts.length === 2 && parts[1] === "install") return { name: "install" };
  if (parts.length === 4 && parts[1] === "selected" && validSlug(parts[2]) && validSlug(parts[3])) {
    return { name: "selected", owner: parts[2]!, skill: parts[3]! };
  }
  if (parts.length === 3 && parts[1] === "c" && validSlug(parts[2])) return { name: "capability", capabilityId: parts[2]! };
  if (parts.length === 4 && parts[1] === "c" && validSlug(parts[2]) && parts[3] === "install") return { name: "install", capabilityId: parts[2]! };
  if (parts.length === 3 && parts[1] === "tasks" && validSlug(parts[2])) return { name: "category", job: parts[2]! };
  return { name: "not-found" };
}

export function buildSuperSkillRoute(route: Exclude<SuperSkillRoute, { name: "not-found" }>): string {
  switch (route.name) {
    case "landing":
      return "#/superskill";
    case "docs":
      return "#/superskill/docs";
    case "agent-guide":
      return "#/superskill/agent-guide";
    case "account":
      return "#/superskill/account";
    case "publish":
      return "#/superskill/publish";
    case "workspaces":
      return "#/superskill/workspaces";
    case "search": {
      const params = new URLSearchParams();
      const query = route.query?.trim();
      if (query) {
        if (query.length > SEARCH_QUERY_MAX_LENGTH) throw new Error("SuperSkill search query is too long");
        params.set("q", query);
      }
      if (route.resourceType) {
        if (!validSearchResourceType(route.resourceType)) throw new Error(`Invalid SuperSkill resource type: ${route.resourceType}`);
        params.set("type", route.resourceType);
      }
      const suffix = params.toString();
      return `#/superskill/search${suffix ? `?${suffix}` : ""}`;
    }
    case "resource":
      if (!validResourceId(route.resourceId)) throw new Error(`Invalid SuperSkill resource ID: ${route.resourceId}`);
      if (route.version && !validSemver(route.version)) throw new Error(`Invalid SuperSkill resource version: ${route.version}`);
      return `#/superskill/resources/${encodeURIComponent(route.resourceId)}${route.version ? `/releases/${encodeURIComponent(route.version)}` : ""}`;
    case "capability":
      return `#/superskill/c/${assertSlug(route.capabilityId)}`;
    case "selected":
      return `#/superskill/selected/${assertSlug(route.owner)}/${assertSlug(route.skill)}`;
    case "install":
      return route.capabilityId ? `#/superskill/c/${assertSlug(route.capabilityId)}/install` : "#/superskill/install";
    case "category":
      return `#/superskill/tasks/${assertSlug(route.job)}`;
  }
}

export function navigateSuperSkill(route: Exclude<SuperSkillRoute, { name: "not-found" }>) {
  window.location.hash = buildSuperSkillRoute(route).slice(1);
}

export function useSuperSkillRoute(): SuperSkillRoute {
  const [route, setRoute] = useState(() => parseSuperSkillRoute(window.location.hash));
  useEffect(() => {
    const update = () => setRoute(parseSuperSkillRoute(window.location.hash));
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return route;
}

function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function validSlug(value: string | null | undefined): value is string {
  return typeof value === "string" && SLUG.test(value);
}

function validResourceId(value: string | null | undefined): value is string {
  return typeof value === "string"
    && value.length >= 3
    && value.length <= 180
    && /^[A-Za-z0-9@._:+/-]+$/.test(value)
    && !value.includes("..")
    && !value.startsWith("/")
    && !value.endsWith("/");
}

function validSearchResourceType(value: string): value is SuperSkillSearchResourceType {
  return SEARCH_RESOURCE_TYPES.has(value as SuperSkillSearchResourceType);
}

function validSemver(value: string | null | undefined): value is string {
  return typeof value === "string" && SEMVER.test(value);
}

function assertSlug(value: string): string {
  if (!validSlug(value)) throw new Error(`Invalid SuperSkill route slug: ${value}`);
  return value;
}
