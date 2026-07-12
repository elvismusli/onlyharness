import type { ReactNode } from "react";

import { SSButton } from "../primitives";

export function StatePanel({ kind, title, reason, next, onRetry, children }: { kind: "loading" | "empty" | "error" | "blocked" | "not-found"; title: string; reason?: string; next?: string; onRetry?: () => void; children?: ReactNode }) {
  const critical = kind === "blocked";
  return (
    <section className={`ss-state ss-state--${kind}`} role={critical ? "alert" : "status"} aria-live={critical ? "assertive" : "polite"}>
      <div className="ss-state-glyph" aria-hidden>{kind === "loading" ? "◐" : kind === "empty" ? "◇" : kind === "blocked" ? "⛔" : "!"}</div>
      <div><h2>{title}</h2>{reason ? <p>{reason}</p> : null}{next ? <p><strong>Next:</strong> {next}</p> : null}{children}</div>
      {onRetry ? <SSButton type="button" variant="secondary" onClick={onRetry}>Retry</SSButton> : null}
    </section>
  );
}
