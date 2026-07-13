import path from "node:path";
import { probeBundledSuperSkillMcp, validateSuperSkillDistributionContract } from "./superskill-mcp-go-core.js";

const root = path.resolve(import.meta.dirname, "..");
const distribution = validateSuperSkillDistributionContract(root);
const localMcp = await probeBundledSuperSkillMcp(root);

process.stdout.write(`${JSON.stringify({
  schemaVersion: "superskill.mcp-primary-local-go.v1",
  status: "pass",
  proofMode: "mcp_primary",
  localGoGate: true,
  productionGoEvidence: false,
  cleanClientSessionEvidence: false,
  distribution,
  localMcp,
  nextGate: distribution.releaseStatus === "published"
    ? "Deploy the integrity-pinned one-link endpoint, then run clean Codex and Claude sessions through the same superskill_local tools."
    : "Publish and integrity-pin the exact CLI, deploy the one-link endpoint, then run clean Codex and Claude sessions through the same superskill_local tools."
}, null, 2)}\n`);
