import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

/**
 * Small, reusable Modern-skin primitives. Deliberately minimal. Their visual
 * styling lives in `tokens.css` under `.skin-modern .oh-*` selectors (structural
 * layout is inline here); every colour resolves from the CSS custom properties
 * defined in that file, so these render correctly only inside a `.skin-modern`
 * subtree and never leak into other skins.
 */

type BtnVariant = "primary" | "secondary" | "ghost" | "mono";

const BTN_BASE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 9,
  borderRadius: "var(--oh-r-control)",
  border: "1px solid transparent",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600,
  lineHeight: 1,
  whiteSpace: "nowrap",
  transition: "background .15s, border-color .15s, color .15s",
  fontFamily: "var(--oh-font-ui)"
};

/**
 * Modern button in four variants:
 * - primary: solid accent on canvas text
 * - secondary: elevated fill + hairline border
 * - ghost: transparent, muted → white on hover
 * - mono: secondary shape but JetBrains Mono with an accent `$` prefix
 */
export function Btn({
  variant = "secondary",
  size = "md",
  prefix,
  children,
  className,
  ...rest
}: {
  variant?: BtnVariant;
  size?: "sm" | "md" | "lg";
  /** Optional leading glyph rendered in the accent colour (e.g. mono `$`). */
  prefix?: ReactNode;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const pad = size === "lg" ? "12px 22px" : size === "sm" ? "6px 12px" : "9px 16px";
  const style: CSSProperties = { ...BTN_BASE, padding: pad };
  if (size === "lg") style.fontSize = 15;
  return (
    <button
      type="button"
      className={["oh-btn", `oh-btn-${variant}`, className].filter(Boolean).join(" ")}
      style={style}
      {...rest}
    >
      {prefix != null && <span className="oh-btn-prefix">{prefix}</span>}
      {children}
    </button>
  );
}

/** Mono chip tag (`#research`). Faint text on an elevated fill + hairline. */
export function Tag({ children }: { children: ReactNode }) {
  return <span className="oh-tag">{children}</span>;
}

/** Green "✓ safety reviewed" style badge. */
export function SafeBadge({ children = "✓ safety reviewed" }: { children?: ReactNode }) {
  return <span className="oh-safe-badge">{children}</span>;
}

/**
 * 5px heat track with an orange→amber gradient fill sized by `pct` (0–100).
 * Purely presentational; callers compute the percentage.
 */
export function HeatBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="oh-heatbar" role="presentation">
      <div className="oh-heatbar-fill" style={{ width: `${clamped}%` }} />
    </div>
  );
}

/**
 * Footer stat row: a top hairline then a horizontal run of stat items. Children
 * are the individual stats; a spacer pushes anything after `<StatRow.Spacer/>`
 * to the right (e.g. the mono eval score).
 */
export function StatRow({ children }: { children: ReactNode }) {
  return <div className="oh-statrow">{children}</div>;
}

function StatRowSpacer() {
  return <span style={{ flex: 1 }} />;
}
StatRow.Spacer = StatRowSpacer;

/** One stat item (icon + label). `interactive`/`active` colour the star. */
export function Stat({
  children,
  interactive,
  active,
  color,
  onClick,
  title
}: {
  children: ReactNode;
  interactive?: boolean;
  active?: boolean;
  color?: string;
  onClick?: () => void;
  title?: string;
}) {
  if (interactive) {
    return (
      <button
        type="button"
        className={["oh-stat", "oh-stat-btn", active ? "oh-stat-on" : ""].filter(Boolean).join(" ")}
        style={color ? { color } : undefined}
        onClick={(event) => {
          /* the whole card is clickable; don't let a stat click bubble to it */
          event.stopPropagation();
          onClick?.();
        }}
        title={title}
      >
        {children}
      </button>
    );
  }
  return (
    <span className="oh-stat" style={color ? { color } : undefined}>
      {children}
    </span>
  );
}

/** Emoji on a tinted rounded tile (40×40 by default). */
export function IconTile({
  emoji,
  bg,
  size = 40,
  radius = "var(--oh-r-tile)"
}: {
  emoji: ReactNode;
  bg?: string;
  size?: number;
  radius?: string;
}) {
  return (
    <div
      className="oh-icontile"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: bg ?? "rgba(255,107,53,.14)",
        fontSize: Math.round(size * 0.5)
      }}
    >
      {emoji}
    </div>
  );
}
