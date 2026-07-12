import { expect, test } from "vitest";

import { SKINS } from "./registry";

test("keeps all legacy skins and registers the isolated SuperSkill skin", () => {
  expect(SKINS.map((skin) => skin.id)).toEqual(["modern", "win98", "fans", "superskill"]);
});
