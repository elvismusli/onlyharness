import { showroomCapabilitySchema } from "@harnesshub/capability-schema/browser";
import type {
  Client,
  EvidenceLevel,
  ManagedCapability,
  ManagedPermissions,
  ManagedStatus,
  RecommendationCandidate,
  RecommendationRequest,
  RecommendationResponse,
  SelectedShowroomCapability,
  SelectedShowroomListResponse,
  ShowroomCapability,
  ShowroomListResponse,
  ShowroomPreview,
  TrustCheck
} from "@harnesshub/capability-schema/browser";

export type {
  EvidenceLevel,
  ManagedCapability,
  ManagedPermissions,
  ManagedStatus,
  RecommendationCandidate,
  RecommendationRequest,
  RecommendationResponse,
  SelectedShowroomCapability,
  SelectedShowroomListResponse,
  ShowroomCapability,
  ShowroomListResponse,
  ShowroomPreview,
  TrustCheck
};

export type SuperSkillClient = Client;
export type PermissionDelta = RecommendationCandidate["permissionDelta"];

export type SuperSkillApiError = { error: string; code: string; next?: string };

export type DataState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "empty"; data: T }
  | { status: "not_found"; code: string; reason: string; next?: string }
  | { status: "error"; code: string; reason: string; next?: string };

export type TrustVerdict = "pass" | "warn" | "fail" | "quarantined" | "revoked" | "not_scanned";

export function capabilityVerdict(capability: ManagedCapability): TrustVerdict {
  if (capability.trust.status === "revoked") return "revoked";
  if (capability.trust.status === "quarantined") return "quarantined";
  if (capability.trust.checks.some((check) => check.status === "fail")) return "fail";
  if (capability.trust.checks.length === 0) return "not_scanned";
  if (capability.trust.checks.some((check) => check.status === "warn" || check.status === "not_run")) return "warn";
  return capability.trust.checks.every((check) => check.status === "pass") ? "pass" : "not_scanned";
}

export function installAllowed(capability: ManagedCapability, handoff?: ShowroomCapability["clientHandoff"]): boolean {
  const verdict = capabilityVerdict(capability);
  return handoff?.status !== "blocked" && capability.trust.status === "approved" && verdict !== "fail" && verdict !== "quarantined" && verdict !== "revoked";
}

export function isShowroomCapability(value: unknown): value is ShowroomCapability {
  return showroomCapabilitySchema.safeParse(value).success;
}
