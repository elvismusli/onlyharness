import type { ReactNode } from "react";

import { SSButton } from "../primitives";

export function StatePanel({ kind, title, reason, next, onRetry, children, headingLevel = 2 }: { kind: "loading" | "empty" | "error" | "blocked" | "not-found"; title: string; reason?: string; next?: string; onRetry?: () => void; children?: ReactNode; headingLevel?: 1 | 2 }) {
  const critical = kind === "blocked";
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section className={`ss-state ss-state--${kind}`} role={critical ? "alert" : "status"} aria-live={critical ? "assertive" : "polite"}>
      <div className="ss-state-glyph" aria-hidden>{kind === "loading" ? "◐" : kind === "empty" ? "◇" : kind === "blocked" ? "⛔" : "!"}</div>
      <div><Heading>{title}</Heading>{reason ? <p>{reason}</p> : null}{next ? <p><strong>Next:</strong> {next}</p> : null}{children ? <div className="ss-state-actions">{children}</div> : null}</div>
      {onRetry ? <SSButton type="button" variant="secondary" onClick={onRetry}>Retry</SSButton> : null}
    </section>
  );
}
