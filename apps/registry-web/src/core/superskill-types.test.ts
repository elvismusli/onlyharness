import { expect, test } from "vitest";

import type { ManagedCapability } from "./superskill-types";
import { capabilityVerdict } from "./superskill-types";

const capability = {
  trust: { status: "approved", checks: [], limitations: [] }
} as unknown as ManagedCapability;

test("missing evidence never becomes pass", () => {
  expect(capabilityVerdict(capability)).toBe("not_scanned");
});

test("not_run evidence remains warn instead of becoming pass", () => {
  const withNotRun = {
    ...capability,
    trust: { ...capability.trust, checks: [{ status: "not_run" }] }
  } as ManagedCapability;
  expect(capabilityVerdict(withNotRun)).toBe("warn");
});
