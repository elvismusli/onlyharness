import { describe, expect, test } from "vitest";

import { buildSuperSkillRoute, parseSuperSkillRoute, type SuperSkillRoute } from "./superskill-route";

describe("SuperSkill hash routes", () => {
  const routes: Array<Exclude<SuperSkillRoute, { name: "not-found" }>> = [
    { name: "landing" },
    { name: "docs" },
    { name: "agent-guide" },
    { name: "account" },
    { name: "publish" },
    { name: "workspaces" },
    { name: "resource", resourceId: "onlyharness:packages/my-skill" },
    { name: "capability", capabilityId: "market-research" },
    { name: "selected", owner: "harnesses", skill: "deep-market-researcher" },
    { name: "install", capabilityId: "market-research" },
    { name: "install" },
    { name: "category", job: "market-research" }
  ];

  test.each(routes)("round-trips $name", (route) => {
    expect(parseSuperSkillRoute(buildSuperSkillRoute(route))).toEqual(route);
  });

  test("generic install handoff has a direct entry point", () => {
    expect(parseSuperSkillRoute("#/superskill/install")).toEqual({ name: "install" });
    expect(buildSuperSkillRoute({ name: "install" })).toBe("#/superskill/install");
  });

  test("human docs and agent guide have browser-safe entry points", () => {
    expect(parseSuperSkillRoute("#/superskill/docs")).toEqual({ name: "docs" });
    expect(buildSuperSkillRoute({ name: "docs" })).toBe("#/superskill/docs");
    expect(parseSuperSkillRoute("#/superskill/agent-guide")).toEqual({ name: "agent-guide" });
    expect(buildSuperSkillRoute({ name: "agent-guide" })).toBe("#/superskill/agent-guide");
    expect(parseSuperSkillRoute("#/superskill/account")).toEqual({ name: "account" });
    expect(buildSuperSkillRoute({ name: "account" })).toBe("#/superskill/account");
    expect(parseSuperSkillRoute("#/superskill/publish")).toEqual({ name: "publish" });
    expect(buildSuperSkillRoute({ name: "publish" })).toBe("#/superskill/publish");
    expect(parseSuperSkillRoute("#/superskill/workspaces")).toEqual({ name: "workspaces" });
    expect(buildSuperSkillRoute({ name: "workspaces" })).toBe("#/superskill/workspaces");
    expect(parseSuperSkillRoute("#/superskill/resources/onlyharness%3Apackages%2Fmy-skill")).toEqual({ name: "resource", resourceId: "onlyharness:packages/my-skill" });
  });

  test("selected skill detail stays inside the SuperSkill route namespace", () => {
    expect(parseSuperSkillRoute("#/superskill/selected/harnesses/deep-market-researcher")).toEqual({
      name: "selected",
      owner: "harnesses",
      skill: "deep-market-researcher"
    });
  });

  test("fails closed for malformed and unknown routes", () => {
    expect(parseSuperSkillRoute("#/superskill/c/../install")).toEqual({ name: "not-found" });
    expect(parseSuperSkillRoute("#/superskill/c/%E0%A4%A")).toEqual({ name: "not-found" });
    expect(parseSuperSkillRoute("#/superskill/selected/harnesses/../deep-market-researcher")).toEqual({ name: "not-found" });
    expect(parseSuperSkillRoute("#/superskill/resources/..%2Fsecret")).toEqual({ name: "not-found" });
  });
});
