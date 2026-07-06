import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { estimateContextCost } from "../src/registry.ts";

test("estimateContextCost counts markdown instruction files", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "hh-context-cost-"));
  try {
    const files = {
      "README.md": "root instructions\n",
      "agents/reviewer.md": "agent prompt\n",
      "runbooks/local.md": "runbook steps\n",
      "skills/nested/SKILL.md": "skill guidance\n",
      "examples/input.md": "example input should not count\n"
    };
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), content);
    }

    const countedBytes = Buffer.byteLength(files["README.md"])
      + Buffer.byteLength(files["agents/reviewer.md"])
      + Buffer.byteLength(files["runbooks/local.md"])
      + Buffer.byteLength(files["skills/nested/SKILL.md"]);
    const cost = estimateContextCost(root);

    assert.deepEqual(cost, {
      approxTokens: Math.round(countedBytes / 4),
      files: 4,
      bytes: countedBytes,
      status: "estimated"
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
