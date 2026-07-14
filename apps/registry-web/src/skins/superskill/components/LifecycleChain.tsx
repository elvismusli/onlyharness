type ExecutionState =
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

const ORDER: ExecutionState[] = ["accepted", "downloading", "digest_verified", "ready", "loaded", "invoked", "outcome_success"];

// The five honest, user-facing lifecycle states, in order. Internal execution
// states are mapped onto these; the non-glossary label "Ready" is never shown.
const STEPS: { key: string; label: string; reachedAt: ExecutionState }[] = [
  { key: "installed", label: "Installed", reachedAt: "digest_verified" },
  { key: "detected", label: "Detected", reachedAt: "ready" },
  { key: "loaded", label: "Loaded", reachedAt: "loaded" },
  { key: "invoked", label: "Invoked", reachedAt: "invoked" }
];

export function LifecycleChain({
  mode,
  executionState,
  pinState = "none",
  outcomeEvidence = "unknown"
}: {
  mode: "temporary" | "pinned";
  executionState: ExecutionState;
  pinState?: "none" | "pinned" | "removed";
  outcomeEvidence?: "agent_reported" | "user_confirmed" | "unknown";
}) {
  const progress = progressIndex(executionState);
  const outcome = outcomeStep(executionState);
  return (
    <div className="ss-lifecycle" aria-label={`${mode} activation lifecycle`}>
      <div className="ss-lifecycle-mode">{mode === "pinned" ? (pinState === "pinned" ? "Pinned" : pinState === "removed" ? "Pin removed" : "Pin pending") : "Temporary"}</div>
      <ol>
        {STEPS.map((step) => {
          const done = progress >= ORDER.indexOf(step.reachedAt);
          return (
            <li key={step.key} aria-label={step.label} data-complete={done ? "true" : "false"}>
              <span aria-hidden>{done ? "●" : "◌"}</span> <span className="ss-lc-label">{step.label}</span>
            </li>
          );
        })}
        <li key="outcome" aria-label={outcome.label} data-complete={outcome.complete ? "true" : "false"} data-outcome={outcome.state}>
          <span aria-hidden>{outcome.glyph}</span> <span className="ss-lc-label">{outcome.label}</span>
        </li>
      </ol>
      {outcome.state === "verified" ? <p className="ss-delta-note">{evidenceNote(outcomeEvidence)}</p> : null}
    </div>
  );
}

function progressIndex(state: ExecutionState) {
  if (state === "failed") return -1;
  if (state === "outcome_failed" || state === "outcome_unknown") return ORDER.indexOf("invoked");
  return ORDER.indexOf(state);
}

function outcomeStep(state: ExecutionState): { label: string; glyph: string; complete: boolean; state: "verified" | "failed" | "unknown" | "pending" } {
  if (state === "outcome_success") return { label: "Outcome verified", glyph: "●", complete: true, state: "verified" };
  if (state === "outcome_failed") return { label: "Outcome failed", glyph: "✕", complete: false, state: "failed" };
  if (state === "outcome_unknown") return { label: "Outcome unknown", glyph: "⚠", complete: false, state: "unknown" };
  return { label: "Outcome verified", glyph: "◌", complete: false, state: "pending" };
}

function evidenceNote(evidence: "agent_reported" | "user_confirmed" | "unknown") {
  if (evidence === "user_confirmed") return "Outcome confirmed by you.";
  if (evidence === "agent_reported") return "Outcome reported by the agent.";
  return "Outcome evidence was not recorded.";
}
