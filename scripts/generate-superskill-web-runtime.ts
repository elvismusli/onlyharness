import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type RuntimeContract = {
  schemaVersion: "superskill.runtime.v1";
  cliPackage: string;
  cliVersion: string;
  pluginVersion: string;
  cliIntegrity: string | null;
  cliReleaseStatus: "published" | "unpublished";
  activationContractVersion: string;
};

const root = process.cwd();
const sourcePath = path.join(root, "plugins/superskill/runtime.json");
const outputPath = path.join(root, "apps/registry-web/src/generated/superskill-runtime.ts");
const source = JSON.parse(await readFile(sourcePath, "utf8")) as RuntimeContract;

if (
  source.schemaVersion !== "superskill.runtime.v1" ||
  source.cliPackage !== "onlyharness" ||
  !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(source.cliVersion) ||
  !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(source.pluginVersion) ||
  !(source.cliIntegrity === null || /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(source.cliIntegrity)) ||
  (source.cliReleaseStatus !== "published" && source.cliReleaseStatus !== "unpublished") ||
  (source.cliReleaseStatus === "published" && source.cliIntegrity === null) ||
  (source.cliReleaseStatus === "unpublished" && source.cliIntegrity !== null) ||
  source.activationContractVersion !== "superskill.activation.v1"
) {
  throw new Error("plugins/superskill/runtime.json is not a supported concrete runtime contract");
}

const generated = `// generated from plugins/superskill/runtime.json; do not edit
export const superskillRuntime = {
  cliPackage: ${JSON.stringify(source.cliPackage)},
  cliVersion: ${JSON.stringify(source.cliVersion)},
  pluginVersion: ${JSON.stringify(source.pluginVersion)},
  cliIntegrity: ${JSON.stringify(source.cliIntegrity)},
  cliReleaseStatus: ${JSON.stringify(source.cliReleaseStatus)},
  activationContractVersion: ${JSON.stringify(source.activationContractVersion)}
} as const;
`;

if (process.argv.includes("--write")) {
  await writeFile(outputPath, generated, "utf8");
  process.stdout.write(`updated ${path.relative(root, outputPath)}\n`);
} else {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== generated) {
    throw new Error(`${path.relative(root, outputPath)} is stale; run this script with --write`);
  }
  process.stdout.write(`ok ${path.relative(root, outputPath)}\n`);
}
