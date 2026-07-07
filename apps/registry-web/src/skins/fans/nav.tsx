import { useHarness } from "../../core/store";
import { SkinSwitcher } from "../SkinSwitcher";

/**
 * Sticky top nav (64px, white, bottom hairline):
 * round brand-blue "O" mark + "OnlyHarness" wordmark (Harness in brand blue) ·
 * a flexible spacer · the shared `<SkinSwitcher/>` styled here as a rounded pill
 * segment (🖥 Normie / 🪟 W98 / 💙 Fans) · a bold "Log in" button → `openLogon`.
 *
 * Everything is a pure consumer of `useHarness()`; the brand click scrolls the
 * landing back to the top (Explore is the base surface, so there's nothing to
 * "navigate" to — it just returns focus to the landing and scrolls up).
 */
export function FansNav() {
  const h = useHarness();

  return (
    <header className="fa-nav">
      <div className="fa-nav-inner">
        <a
          className="fa-brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            h.focus("");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <span className="fa-logo" aria-hidden>O</span>
          <span className="fa-wordmark">
            Only<b>Harness</b>
          </span>
        </a>

        <div className="fa-nav-spacer" />

        <SkinSwitcher />

        <button type="button" className="fa-login" onClick={() => h.openLogon()}>
          Log in
        </button>
      </div>
    </header>
  );
}
