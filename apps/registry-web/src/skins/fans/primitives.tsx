import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

/**
 * Small, reusable Fans-skin primitives. Deliberately minimal. Their visual
 * styling lives in `tokens.css` under `.skin-fans .fa-*` selectors (only a little
 * structural sizing is inline here); every colour resolves from the CSS custom
 * properties defined in that file, so these render correctly only inside a
 * `.skin-fans` subtree and never leak into other skins.
 *
 * The look is friendly and rounded: Nunito, pill radii, soft BLUE-tinted shadows.
 */

type BtnVariant = "primary" | "outline" | "cli";

const BTN_BASE: CSSProperties = {
  fontSize: 14
};

/**
 * Fans button in three variants:
 * - primary: solid brand blue, white text (the main call-to-action pill)
 * - outline: white fill + hairline border (e.g. "Continue with GitHub")
 * - cli: dark ink fill, JetBrains Mono (e.g. "> Continue with CLI")
 */
export function Btn({
  variant = "primary",
  children,
  className,
  style,
  ...rest
}: {
  variant?: BtnVariant;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={["fa-btn", `fa-btn-${variant}`, className].filter(Boolean).join(" ")}
      style={{ ...BTN_BASE, ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}

type PillTone = "brand" | "soft" | "dark";

/**
 * A rounded chip. `brand` = solid blue, `soft` = pale wash, `dark` = the ink
 * "🏆 Top creator this week" badge (larger radius + shadow, styled in tokens.css).
 */
export function Pill({ tone = "brand", children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`fa-pill fa-pill-${tone}`}>{children}</span>;
}

/**
 * Round emoji-on-tint avatar (44×44 by default). `bg` sets the tint fill; the
 * emoji is sized to ~half the diameter.
 */
export function Avatar({
  emoji,
  bg,
  size = 44
}: {
  emoji: ReactNode;
  bg?: string;
  size?: number;
}) {
  return (
    <div
      className="fa-avatar"
      style={{
        width: size,
        height: size,
        background: bg ?? "var(--fa-wash)",
        fontSize: Math.round(size * 0.5)
      }}
      aria-hidden
    >
      {emoji}
    </div>
  );
}

/**
 * One stat item (emoji/glyph + value), e.g. "🔥 21.4" or the green "eval 0.91".
 * `eval` tints it the eval green; `color` overrides inline.
 */
export function Stat({
  children,
  eval: isEval,
  color
}: {
  children: ReactNode;
  eval?: boolean;
  color?: string;
}) {
  return (
    <span
      className={["fa-stat", isEval ? "fa-stat-eval" : ""].filter(Boolean).join(" ")}
      style={color ? { color } : undefined}
    >
      {children}
    </span>
  );
}

/**
 * The blue "Subscribe" pill on a creator card. It's the playful skin for the
 * real star action, so `subscribed` reflects `starred` state and flips the label
 * to "Subscribed" with a green fill. Clicking stops propagation so it doesn't
 * also fire the card's own open handler.
 */
export function SubscribeButton({
  subscribed,
  onClick,
  title
}: {
  subscribed?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="fa-subscribe"
      data-subscribed={subscribed ? "" : undefined}
      aria-pressed={subscribed}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
    >
      {subscribed ? "Subscribed" : "Subscribe"}
    </button>
  );
}
