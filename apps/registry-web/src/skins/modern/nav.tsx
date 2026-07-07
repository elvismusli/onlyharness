import { useEffect, useRef } from "react";

import { useHarness } from "../../core/store";
import { SkinSwitcher } from "../SkinSwitcher";
import { Btn } from "./primitives";

const NAV_TABS = ["Explore", "Collections", "Leaderboard", "Docs"] as const;

/**
 * Sticky top nav (60px, blurred, bottom hairline):
 * gradient "O" logo + "OnlyHarness" wordmark · nav tabs (Explore active pill) ·
 * a search field bound to `useHarness().query`/`setQuery` with a `/` key hint ·
 * an accent Publish button (`openPublish`) · the shared `<SkinSwitcher/>` styled
 * here as a rounded pill group.
 *
 * Only Explore is wired for now (it's the active tab); the other tabs are inert
 * labels until later tasks. The `/` shortcut focuses the search input from
 * anywhere on the page (unless already typing in a field).
 */
export function Nav() {
  const h = useHarness();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="oh-nav">
      <div className="oh-nav-inner">
        <a
          className="oh-brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            h.focus("");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <span className="oh-logo" aria-hidden>O</span>
          <span className="oh-wordmark">OnlyHarness</span>
        </a>

        <nav className="oh-navtabs" aria-label="Primary">
          {NAV_TABS.map((tab) => (
            <span key={tab} className="oh-navtab" data-active={tab === "Explore" ? "" : undefined}>
              {tab}
            </span>
          ))}
        </nav>

        <div className="oh-nav-spacer" />

        <label className="oh-search">
          <span className="oh-search-icon" aria-hidden>⌕</span>
          <input
            ref={searchRef}
            value={h.query}
            onChange={(event) => h.setQuery(event.target.value)}
            placeholder="Search harnesses"
            aria-label="Search harnesses"
            spellCheck={false}
          />
          <span className="oh-search-kbd" aria-hidden>/</span>
        </label>

        <Btn variant="primary" onClick={h.openPublish}>Publish</Btn>

        <SkinSwitcher />
      </div>
    </header>
  );
}
