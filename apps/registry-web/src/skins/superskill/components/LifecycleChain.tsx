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
  const executionIndex = stateIndex(executionState);
  const steps = [
    { key: "ready", label: "Ready", done: executionIndex >= ORDER.indexOf("ready") },
    { key: "loaded", label: "Loaded", done: executionIndex >= ORDER.indexOf("loaded") },
    { key: "invoked", label: "Invoked", done: executionIndex >= ORDER.indexOf("invoked") },
    {
      key: "outcome",
      label: outcomeEvidence === "user_confirmed" ? "Outcome user-confirmed" : outcomeEvidence === "agent_reported" ? "Outcome agent-reported" : "Outcome unknown",
      done: executionState === "outcome_success" || executionState === "outcome_failed" || executionState === "outcome_unknown"
    }
  ];
  return (
    <div className="ss-lifecycle" aria-label={`${mode} activation lifecycle`}>
      <div className="ss-lifecycle-mode">{mode === "pinned" ? (pinState === "pinned" ? "Pinned" : pinState === "removed" ? "Pin removed" : "Pin pending") : "Temporary"}</div>
      <ol>
        {steps.map((step) => (
          <li key={step.key} data-complete={step.done ? "true" : "false"}>
            <span aria-hidden>{step.done ? "●" : "◌"}</span> {step.label}
          </li>
        ))}
      </ol>
    </div>
  );
}

function stateIndex(state: ExecutionState) {
  if (state === "outcome_failed" || state === "outcome_unknown") return ORDER.length - 1;
  if (state === "failed") return -1;
  return ORDER.indexOf(state);
}
