import type {
  Client,
  ExactCapabilityRelease,
  ManagedCapability as SharedManagedCapability,
  RecommendationCandidate as SharedRecommendationCandidate,
  RecommendationResponse as SharedRecommendationResponse
} from "@harnesshub/capability-schema/browser";

export type SuperSkillClient = Client;
export type ActivationMode = "temporary" | "pinned";
export type ExecutionState =
  | "accepted"
  | "downloading"
  | "digest_verified"
  | "ready"
  | "loaded"
  | "invoked"
  | "outcome_success"
  | "outcome_failed"
  | "outcome_unknown"
  | "failed";
export type PinState = "none" | "pinned" | "removed";
export type OutcomeEvidence = "agent_reported" | "user_confirmed" | "unknown";

export type ManagedCapability = SharedManagedCapability;
export type RecommendationCandidate = SharedRecommendationCandidate;
export type RecommendationResponse = SharedRecommendationResponse;
export type ExactReleaseResponse = ExactCapabilityRelease;

export type ManagedArchive = {
  owner?: string;
  repo?: string;
  version: string;
  snapshot: boolean;
  artifactDigest: string;
  totalFileCount: number;
  archiveTruncated: boolean;
  files: Array<{ path: string; content: string; truncated?: boolean }>;
};

export type ActivationPlan = {
  root: string;
  files: Array<{ path: string; purpose: "agent_prompt" | "runbook" | "example" }>;
  stages: Array<{ id: string; agent: string; promptPath: string }>;
};

export type ActivationRecord = {
  schemaVersion: "superskill.activation.v1";
  activationId: string;
  activationRequestId: string;
  projectRoot: string;
  recommendationId?: string;
  mode: ActivationMode;
  sourceMarkerPath?: string;
  capability: { id: string; ref: string; version: string; artifactDigest: string };
  client: SuperSkillClient;
  executionState: ExecutionState;
  pinState: PinState;
  pinned?: { markerPath: string; markerDigest: string; packageDigest: string };
  outcome?: { value: "success" | "failed" | "unknown"; evidence: OutcomeEvidence };
  createdAt: string;
  updatedAt: string;
};

export type ManagedPinnedMarker = {
  schemaVersion: "superskill.pinned.v1";
  client: SuperSkillClient;
  capabilityId: string;
  ref: string;
  version: string;
  artifactDigest: string;
  cliPackage: string;
  cliVersion: string;
  activationContractVersion: "superskill.activation.v1";
  pinActivationId: string;
  pinRequestId: string;
  managedFiles: Record<string, string>;
  packageDigest: string;
};

export type ManagedEvent = {
  eventId: string;
  kind:
    | "recommended"
    | "recommendation_accepted"
    | "activation_started"
    | "activation_ready"
    | "activation_loaded"
    | "activation_invoked"
    | "outcome_reported"
    | "activation_pinned"
    | "activation_removed"
    | "activation_failed";
  owner?: string;
  repo?: string;
  version?: string;
  target?: SuperSkillClient;
  client: "hh" | "superskill-claude" | "superskill-codex";
  recommendationId?: string;
  activationId?: string;
  mode?: ActivationMode;
  evidence?: OutcomeEvidence;
  outcome?: "success" | "failed" | "unknown";
  reasonCode?: string;
};

export class SuperSkillCliError extends Error {
  constructor(
    message: string,
    readonly exitCode: 1 | 2 | 3 | 4,
    readonly reasonCode: string,
    readonly next: string
  ) {
    super(message);
    this.name = "SuperSkillCliError";
  }
}

export const SUPERSKILL_RUNTIME = {
  cliPackage: "onlyharness",
  cliVersion: "0.2.15",
  activationContractVersion: "superskill.activation.v1"
} as const;

export const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
export const CAPABILITY_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const REQUEST_ID_RE = /^req_[A-Za-z0-9_-]{8,120}$/;
export const RECOMMENDATION_ID_RE = /^rec_[A-Za-z0-9_-]{8,120}$/;
