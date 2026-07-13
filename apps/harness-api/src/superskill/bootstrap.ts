import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ManagedCapability } from "@harnesshub/capability-schema/browser";
import { workspaceRoot } from "../registry.js";

export const SUPERSKILL_INSTALL_ORIGIN = "https://superskill.sh";
export const SUPERSKILL_INSTALL_PATH = "/api/superskill/install";

export type SuperSkillBootstrapContract = {
  schemaVersion: "superskill.bootstrap-contract.v1";
  installer: { package: "onlyharness"; version: string; integrity: string | null; releaseStatus: "published" | "unpublished" };
  universalSkill: { name: "superskill"; version: string; artifactDigest: string };
  clientAdapters: Record<"codex" | "claude-code", { path: string; contractDigest: string }>;
};

export type SuperSkillBootstrapManifest = {
  schemaVersion: "superskill.bootstrap.v1";
  canonicalUrl: string;
  installer: SuperSkillBootstrapContract["installer"];
  universalSkill: SuperSkillBootstrapContract["universalSkill"];
  clientAdapters: SuperSkillBootstrapContract["clientAdapters"];
  capability: { id: string; version: string; artifactDigest: string } | null;
  activation: { performed: false; explicitConsentRequired: true };
  manifestDigest: string;
};

export function loadSuperSkillBootstrapContract(file = path.join(workspaceRoot, "data/superskill/bootstrap.json")): SuperSkillBootstrapContract {
  const value = JSON.parse(readFileSync(file, "utf8")) as Partial<SuperSkillBootstrapContract>;
  if (
    value.schemaVersion !== "superskill.bootstrap-contract.v1" ||
    value.installer?.package !== "onlyharness" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.installer.version ?? "") ||
    !(value.installer.integrity === null || /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value.installer.integrity ?? "")) ||
    (value.installer.releaseStatus !== "published" && value.installer.releaseStatus !== "unpublished") ||
    (value.installer.releaseStatus === "published" && value.installer.integrity === null) ||
    (value.installer.releaseStatus === "unpublished" && value.installer.integrity !== null) ||
    value.universalSkill?.name !== "superskill" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.universalSkill.version ?? "") ||
    !/^sha256:[a-f0-9]{64}$/.test(value.universalSkill.artifactDigest ?? "")
    || value.clientAdapters?.codex?.path !== ".codex/config.toml"
    || !/^sha256:[a-f0-9]{64}$/.test(value.clientAdapters.codex.contractDigest ?? "")
    || value.clientAdapters?.["claude-code"]?.path !== ".mcp.json"
    || !/^sha256:[a-f0-9]{64}$/.test(value.clientAdapters["claude-code"].contractDigest ?? "")
  ) throw new Error("SuperSkill bootstrap contract is invalid");
  return value as SuperSkillBootstrapContract;
}

export function buildSuperSkillBootstrapManifest(contract: SuperSkillBootstrapContract, capability?: ManagedCapability): SuperSkillBootstrapManifest {
  const tuple = capability ? {
    id: capability.id,
    version: capability.release.version,
    artifactDigest: capability.release.artifactDigest
  } : null;
  const canonicalUrl = tuple
    ? `${SUPERSKILL_INSTALL_ORIGIN}${SUPERSKILL_INSTALL_PATH}/${tuple.id}/${tuple.version}/${tuple.artifactDigest.slice("sha256:".length)}`
    : `${SUPERSKILL_INSTALL_ORIGIN}${SUPERSKILL_INSTALL_PATH}`;
  const body = {
    schemaVersion: "superskill.bootstrap.v1" as const,
    canonicalUrl,
    installer: contract.installer,
    universalSkill: contract.universalSkill,
    clientAdapters: contract.clientAdapters,
    capability: tuple,
    activation: { performed: false as const, explicitConsentRequired: true as const }
  };
  return {
    ...body,
    manifestDigest: `sha256:${createHash("sha256").update(canonicalJson(body), "utf8").digest("hex")}`
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}
