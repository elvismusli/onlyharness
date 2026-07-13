import { expect, test } from "vitest";

import { superskillRuntime } from "../generated/superskill-runtime";
import { superskillInstallHandoff } from "./superskill-install";

test("staged unpublished runtime exposes no URL or copyable command", () => {
  const handoff = superskillInstallHandoff();
  expect(handoff.status).toBe("unavailable");
  if (handoff.status !== "unavailable") throw new Error("unpublished runtime must be unavailable");
  expect(handoff.installUrl).toBeNull();
  expect(handoff.installCommand).toBeNull();
  expect(handoff.reasonCode).toBe("CLI_RELEASE_UNPUBLISHED");
});

test("published runtime without official integrity remains unavailable", () => {
  const handoff = superskillInstallHandoff(undefined, { ...superskillRuntime, cliReleaseStatus: "published", cliIntegrity: null });
  expect(handoff.status).toBe("unavailable");
  if (handoff.status !== "unavailable") throw new Error("integrity-free runtime must be unavailable");
  expect(handoff.reasonCode).toBe("CLI_INTEGRITY_UNPINNED");
  expect(handoff.installCommand).toBeNull();
});

test("published integrity-pinned runtime exposes one exact command without latest or script piping", () => {
  const handoff = superskillInstallHandoff(undefined, { ...superskillRuntime, cliReleaseStatus: "published", cliIntegrity: "sha512-YWJj" });
  expect(handoff.status).toBe("available");
  if (handoff.status !== "available") throw new Error("published fixture must be available");
  expect(handoff.installUrl).toBe("https://superskill.sh/api/superskill/install");
  expect(handoff.installCommand).toContain(`onlyharness@${superskillRuntime.cliVersion} superskill install ${handoff.installUrl} --auto`);
  expect(handoff.installCommand).not.toContain("@latest");
  expect(handoff.installCommand).not.toMatch(/curl|wget|\|\s*(?:sh|bash)/);
});

test("capability handoff binds one canonical URL to id, version and digest", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const handoff = superskillInstallHandoff({
    id: "market-research",
    release: { version: "0.2.0", artifactDigest: digest }
  } as Parameters<typeof superskillInstallHandoff>[0], { ...superskillRuntime, cliReleaseStatus: "published", cliIntegrity: "sha512-YWJj" });
  expect(handoff.status).toBe("available");
  if (handoff.status !== "available") throw new Error("published fixture must be available");
  expect(handoff.installUrl).toBe(`https://superskill.sh/api/superskill/install/market-research/0.2.0/${"a".repeat(64)}`);
  expect(handoff.installCommand.match(/https:\/\//g)).toHaveLength(1);
});
