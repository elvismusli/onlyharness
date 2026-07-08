import { SKINS } from "./registry";
import { useSkin } from "./SkinProvider";

/**
 * Global skin switcher: a single, self-styled floating pill rendered ONCE at the
 * `SkinProvider` level (next to the active skin's mount) so it sits in the exact
 * same viewport position on every skin and can never be clipped by a skin's own
 * chrome. Its look is fully self-contained in `skin-switcher.css` (NOT scoped
 * under any `.skin-*`): a dark translucent blurred pill with light text + a white
 * "active" chip, which reads clearly on the dark Modern, teal Win98 and light
 * Fans backgrounds alike. On narrow viewports the labels drop away (icon-only)
 * so it stays compact and fully visible.
 *
 * One `<button>` per registered `SKINS` entry: clicking calls `setSkin(id)`, the
 * active one is marked with `aria-pressed` + `data-active`.
 */
export function GlobalSkinSwitcher() {
  const { skin, setSkin } = useSkin();
  return (
    <div className="gss" role="group" aria-label="Choose skin">
      {SKINS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="gss-btn"
          data-active={entry.id === skin ? "" : undefined}
          aria-pressed={entry.id === skin}
          title={`Skin: ${entry.label}`}
          onClick={() => setSkin(entry.id)}
        >
          <span className="gss-icon" aria-hidden>{entry.icon}</span>
          <span className="gss-label">{entry.label}</span>
        </button>
      ))}
    </div>
  );
}
