import { superskillRuntime } from "../generated/superskill-runtime";
import type { ManagedCapability } from "./superskill-types";

const INSTALL_BASE = "https://superskill.sh/api/superskill/install";

type SuperSkillReleaseRuntime = {
  cliPackage: string;
  cliVersion: string;
  cliIntegrity: string | null;
  cliReleaseStatus: "published" | "unpublished";
};

export type SuperSkillInstallHandoff = {
  status: "available";
  installUrl: string;
  installCommand: string;
  runtime: string;
} | {
  status: "unavailable";
  installUrl: null;
  installCommand: null;
  runtime: string;
  reasonCode: "CLI_RELEASE_UNPUBLISHED" | "CLI_INTEGRITY_UNPINNED";
  reason: string;
};

export function superskillInstallHandoff(
  capability?: ManagedCapability,
  runtime: SuperSkillReleaseRuntime = superskillRuntime
): SuperSkillInstallHandoff {
  const runtimeLabel = `${runtime.cliPackage}@${runtime.cliVersion}`;
  if (runtime.cliReleaseStatus !== "published") {
    return {
      status: "unavailable",
      installUrl: null,
      installCommand: null,
      runtime: runtimeLabel,
      reasonCode: "CLI_RELEASE_UNPUBLISHED",
      reason: `The exact ${runtimeLabel} release has not been published and verified yet.`
    };
  }
  if (!runtime.cliIntegrity || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(runtime.cliIntegrity)) {
    return {
      status: "unavailable",
      installUrl: null,
      installCommand: null,
      runtime: runtimeLabel,
      reasonCode: "CLI_INTEGRITY_UNPINNED",
      reason: `The official npm integrity for ${runtimeLabel} is not pinned.`
    };
  }
  const installUrl = capability
    ? `${INSTALL_BASE}/${capability.id}/${capability.release.version}/${capability.release.artifactDigest.slice("sha256:".length)}`
    : INSTALL_BASE;
  return {
    status: "available",
    installUrl,
    installCommand: `npx --yes ${runtime.cliPackage}@${runtime.cliVersion} superskill install ${installUrl} --auto`,
    runtime: runtimeLabel
  };
}
