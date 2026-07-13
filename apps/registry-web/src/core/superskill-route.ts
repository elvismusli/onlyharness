import { useEffect, useState } from "react";

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export type SuperSkillRoute =
  | { name: "landing" }
  | { name: "docs" }
  | { name: "agent-guide" }
  | { name: "account" }
  | { name: "publish" }
  | { name: "workspaces" }
  | { name: "resource"; resourceId: string }
  | { name: "capability"; capabilityId: string }
  | { name: "selected"; owner: string; skill: string }
  | { name: "install"; capabilityId?: string }
  | { name: "category"; job: string }
  | { name: "not-found" };

export function parseSuperSkillRoute(hash: string): SuperSkillRoute {
  const raw = hash.replace(/^#/, "").split("?")[0].replace(/\/+$/, "") || "/";
  if (raw === "/" || raw === "/superskill") return { name: "landing" };
  const parts = raw.split("/").filter(Boolean).map(decodeSegment);
  if (parts.some((part) => part === null) || parts[0] !== "superskill") return { name: "not-found" };
  if (parts.length === 2 && parts[1] === "docs") return { name: "docs" };
  if (parts.length === 2 && parts[1] === "agent-guide") return { name: "agent-guide" };
  if (parts.length === 2 && parts[1] === "account") return { name: "account" };
  if (parts.length === 2 && parts[1] === "publish") return { name: "publish" };
  if (parts.length === 2 && parts[1] === "workspaces") return { name: "workspaces" };
  if (parts.length === 3 && parts[1] === "resources" && validResourceId(parts[2])) {
    return { name: "resource", resourceId: parts[2]! };
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
    case "resource":
      if (!validResourceId(route.resourceId)) throw new Error(`Invalid SuperSkill resource ID: ${route.resourceId}`);
      return `#/superskill/resources/${encodeURIComponent(route.resourceId)}`;
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

function assertSlug(value: string): string {
  if (!validSlug(value)) throw new Error(`Invalid SuperSkill route slug: ${value}`);
  return value;
}
