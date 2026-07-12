import { describe, expect, test } from "vitest";

import { buildSuperSkillRoute, parseSuperSkillRoute, type SuperSkillRoute } from "./superskill-route";

describe("SuperSkill hash routes", () => {
  const routes: Array<Exclude<SuperSkillRoute, { name: "not-found" }>> = [
    { name: "landing" },
    { name: "capability", capabilityId: "market-research" },
    { name: "install", capabilityId: "market-research" },
    { name: "category", job: "market-research" }
  ];

  test.each(routes)("round-trips $name", (route) => {
    expect(parseSuperSkillRoute(buildSuperSkillRoute(route))).toEqual(route);
  });

  test("fails closed for malformed and unknown routes", () => {
    expect(parseSuperSkillRoute("#/superskill/c/../install")).toEqual({ name: "not-found" });
    expect(parseSuperSkillRoute("#/superskill/c/%E0%A4%A")).toEqual({ name: "not-found" });
  });
});
