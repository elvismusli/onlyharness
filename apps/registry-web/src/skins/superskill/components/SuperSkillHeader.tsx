import { useEffect, useRef, useState } from "react";

import { buildSuperSkillRoute, type SuperSkillRoute } from "../../../core/superskill-route";
import { ShellLink } from "../primitives";

type RoutableSuperSkillRoute = Exclude<SuperSkillRoute, { name: "not-found" }>;

const SHOWROOM_ROUTE = buildSuperSkillRoute({ name: "landing" });
const DOCS_ROUTE = buildSuperSkillRoute({ name: "docs" });
const AGENT_GUIDE_ROUTE = buildSuperSkillRoute({ name: "agent-guide" });
const INSTALL_ROUTE = buildSuperSkillRoute({ name: "install" });

export function SuperSkillHeader({ route }: { route: SuperSkillRoute }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const routeKey = routeName(route);

  useEffect(() => {
    setMenuOpen(false);
  }, [routeKey]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  const closeMenu = () => {
    if (!menuOpen) return;
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  };

  return (
    <header className="ss-nav">
      <div className="ss-nav-inner">
        <ShellLink className="ss-brand" href={SHOWROOM_ROUTE}><span aria-hidden>S</span><strong>SuperSkill</strong></ShellLink>
        <button
          ref={menuButtonRef}
          className="ss-menu-toggle"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="ss-primary-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          Menu
        </button>
        <nav id="ss-primary-navigation" aria-label="SuperSkill" data-open={menuOpen ? "true" : "false"}>
          <a href={SHOWROOM_ROUTE} aria-current={route.name === "landing" ? "page" : undefined} onClick={closeMenu}>Showroom</a>
          <a href={DOCS_ROUTE} aria-current={route.name === "docs" ? "page" : undefined} onClick={closeMenu}>Docs</a>
          <a href={AGENT_GUIDE_ROUTE} aria-current={route.name === "agent-guide" ? "page" : undefined} onClick={closeMenu}>Agent guide</a>
          <a className="ss-link ss-link--primary ss-nav-install-link" href={INSTALL_ROUTE} aria-current={route.name === "install" ? "page" : undefined} onClick={closeMenu}>Get SuperSkill</a>
        </nav>
      </div>
    </header>
  );
}

function routeName(route: RoutableSuperSkillRoute | { name: "not-found" }): string {
  if (route.name === "capability" || route.name === "selected" || route.name === "category") return `${route.name}:${JSON.stringify(route)}`;
  if (route.name === "install") return `${route.name}:${route.capabilityId ?? "shared"}`;
  return route.name;
}
