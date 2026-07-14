import { describe, expect, it } from "vitest";

import { capabilityFixture } from "../test/superskill-fixtures";
import { capabilityShareUrl, encodeBase64Url, resourceShareUrl } from "./share-url";

describe("SuperSkill crawler-safe share URLs", () => {
  it("encodes machine resource coordinates without leaking a slash into the path", () => {
    expect(encodeBase64Url("onlyharness:packages/my-agent-skill")).toBe("b25seWhhcm5lc3M6cGFja2FnZXMvbXktYWdlbnQtc2tpbGw");
    expect(resourceShareUrl("onlyharness:packages/my-agent-skill", "1.2.3")).toBe("https://superskill.sh/r/b25seWhhcm5lc3M6cGFja2FnZXMvbXktYWdlbnQtc2tpbGw/1.2.3");
  });

  it("uses a dedicated path for managed capability cards", () => {
    expect(capabilityShareUrl("market-research")).toBe("https://superskill.sh/c/market-research");
  });

  it("pins a managed capability share link to its exact release", () => {
    const capability = capabilityFixture();
    const url = capabilityShareUrl(capability);
    expect(url).toContain(capability.release.version);
    expect(url).toBe(`https://superskill.sh/c/${capability.id}/${capability.release.version}`);
  });
});
