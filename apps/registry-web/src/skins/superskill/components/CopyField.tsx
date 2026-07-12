import { useState } from "react";

import { SSButton } from "../primitives";

export function CopyField({ label, value }: { label: string; value: string }) {
  const [status, setStatus] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("Copied");
    } catch {
      setStatus("Clipboard unavailable — select and copy the value manually.");
    }
  }
  return (
    <div className="ss-copy-field">
      <label><span>{label}</span><textarea readOnly rows={value.includes("\n") ? 3 : 1} value={value} /></label>
      <SSButton type="button" variant="secondary" onClick={copy}>Copy</SSButton>
      <span className="ss-sr-live" aria-live="polite">{status}</span>
    </div>
  );
}
