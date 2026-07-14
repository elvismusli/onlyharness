import { useState } from "react";

import type { SuperSkillClient } from "../../../core/superskill-types";
import { SSButton } from "../primitives";

export function TaskPrompt({ onContinue }: { onContinue: (task: string, client: SuperSkillClient) => void }) {
  const [task, setTask] = useState("");
  const [client, setClient] = useState<SuperSkillClient>("claude-code");
  const [error, setError] = useState("");
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalized = task.replace(/\s+/g, " ").trim();
    if (normalized.length < 3 || normalized.length > 500) {
      setError("Describe one concrete task in 3–500 characters.");
      return;
    }
    setError("");
    onContinue(normalized, client);
  }
  return (
    <form className="ss-task-prompt" onSubmit={submit}>
      <label htmlFor="ss-task">Task</label>
      <div className="ss-task-row"><span aria-hidden>$</span><textarea id="ss-task" value={task} maxLength={500} rows={2} onChange={(event) => setTask(event.target.value)} placeholder="Describe the result you need" /><SSButton type="submit">Find skill</SSButton><span className="ss-caret" aria-hidden="true" /></div>
      <fieldset><legend>Client</legend><label><input type="radio" name="ss-client" checked={client === "claude-code"} onChange={() => setClient("claude-code")} /> Claude Code</label><label><input type="radio" name="ss-client" checked={client === "codex"} onChange={() => setClient("codex")} /> Codex CLI</label></fieldset>
      <div className="ss-task-privacy">Your task stays in this tab. It is not sent, stored, or added to the URL by this showroom.</div>
      {error ? <div className="ss-form-error" role="alert">{error}</div> : null}
    </form>
  );
}
