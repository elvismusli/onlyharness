import { useState } from "react";

import type { PermissionDelta as PermissionDeltaData } from "../../../core/superskill-types";
import { SSButton } from "../primitives";
import { PermissionDelta } from "./PermissionDelta";

export function ConsentPanel({ tier, delta, onConfirm, onCancel }: { tier: "T2" | "T3"; delta: PermissionDeltaData; onConfirm?: () => void; onCancel?: () => void }) {
  const [understood, setUnderstood] = useState(false);
  return (
    <section className={`ss-consent ss-consent--${tier.toLowerCase()}`} aria-labelledby="ss-consent-title">
      <h2 id="ss-consent-title">{tier === "T3" ? "Critical powers require deliberate consent" : "Review before activation"}</h2>
      <p>This disclosure is what the terminal client will show. The web showroom does not activate the resource.</p>
      <PermissionDelta delta={delta} />
      {tier === "T3" ? <label className="ss-hard-confirm"><input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} /> I understand the critical powers listed above</label> : null}
      <div className="ss-consent-actions"><SSButton type="button" variant="secondary" onClick={onCancel}>Cancel</SSButton><SSButton type="button" variant={tier === "T3" ? "danger" : "primary"} disabled={tier === "T3" && !understood} onClick={onConfirm}>Continue in client</SSButton></div>
    </section>
  );
}
