import { SKINS } from "./registry";
import { useSkin } from "./SkinProvider";

/**
 * Headless skin switcher: one button per registered skin, calling `setSkin(id)`
 * and marking the active one (`aria-pressed` + `data-active`). Ships no visual
 * styling of its own — the consuming skin styles `.skin-switcher` / its buttons
 * to look native. With one skin registered this renders a single control.
 */
export function SkinSwitcher() {
  const { skin, setSkin } = useSkin();
  return (
    <div className="skin-switcher" role="group" aria-label="Skin">
      {SKINS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="skin-switcher-btn"
          data-active={entry.id === skin ? "" : undefined}
          aria-pressed={entry.id === skin}
          title={`Skin: ${entry.label}`}
          onClick={() => setSkin(entry.id)}
        >
          {entry.icon} {entry.label}
        </button>
      ))}
    </div>
  );
}
