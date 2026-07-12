import type { TrustVerdict } from "../../../core/superskill-types";

const GLYPHS: Record<TrustVerdict, string> = {
  pass: "✓",
  warn: "⚠",
  fail: "✕",
  quarantined: "⛔",
  revoked: "↩",
  not_scanned: "◌"
};

export function VerdictChip({ verdict, namedCheckCount, label }: { verdict: TrustVerdict; namedCheckCount?: number; label?: string }) {
  const detail = typeof namedCheckCount === "number" ? ` · ${namedCheckCount} named ${namedCheckCount === 1 ? "check" : "checks"}` : "";
  return (
    <span className={`ss-verdict ss-verdict--${verdict}`} data-verdict={verdict}>
      <span aria-hidden>{GLYPHS[verdict]}</span>
      <span>{label ?? verdict.replace("_", " ")}{detail}</span>
    </span>
  );
}
