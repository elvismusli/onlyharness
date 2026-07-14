import { useEffect, useRef, useState } from "react";

import { buildSuperSkillRoute, type SuperSkillRoute } from "../../../core/superskill-route";
import { ShellLink } from "../primitives";

type RoutableSuperSkillRoute = Exclude<SuperSkillRoute, { name: "not-found" }>;

const SHOWROOM_ROUTE = buildSuperSkillRoute({ name: "landing" });
const DOCS_ROUTE = buildSuperSkillRoute({ name: "docs" });
const AGENT_GUIDE_ROUTE = buildSuperSkillRoute({ name: "agent-guide" });
const INSTALL_ROUTE = buildSuperSkillRoute({ name: "install" });
const ACCOUNT_ROUTE = buildSuperSkillRoute({ name: "account" });
const PUBLISH_ROUTE = buildSuperSkillRoute({ name: "publish" });
const WORKSPACES_ROUTE = buildSuperSkillRoute({ name: "workspaces" });
const SEARCH_ROUTE = buildSuperSkillRoute({ name: "search" });

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

  // Task-first primary nav (UX handoff §7): only the two discovery destinations plus the single
  // "Get SuperSkill" CTA live in the primary landmark. Publishing/account destinations are demoted
  // to a secondary account grouping — still keyboard reachable, routes intact — so the primary nav
  // stays scannable for the core task.
  const accountLinks: Array<{ label: string; href: string; active: boolean }> = [
    { label: "Docs", href: DOCS_ROUTE, active: route.name === "docs" },
    { label: "Agent guide", href: AGENT_GUIDE_ROUTE, active: route.name === "agent-guide" },
    { label: "Publish", href: PUBLISH_ROUTE, active: route.name === "publish" },
    { label: "Workspaces", href: WORKSPACES_ROUTE, active: route.name === "workspaces" },
    { label: "Account", href: ACCOUNT_ROUTE, active: route.name === "account" }
  ];

  return (
    <header className="ss-nav">
      <div className="ss-nav-inner">
        <ShellLink className="ss-brand" href={SHOWROOM_ROUTE}><img src="/brand/superskill-mark.svg" alt="" width="30" height="30" /><strong>SuperSkill</strong></ShellLink>
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
          <a href={SEARCH_ROUTE} aria-current={route.name === "search" ? "page" : undefined} onClick={closeMenu}>Search</a>
          <a className="ss-link ss-link--primary ss-nav-install-link" href={INSTALL_ROUTE} aria-current={route.name === "install" ? "page" : undefined} onClick={closeMenu}>Get SuperSkill</a>
        </nav>
        <div className="ss-nav-account" role="navigation" aria-label="Account and publishing">
          {accountLinks.map((link) => (
            <a
              key={link.href}
              className="ss-nav-account-link"
              href={link.href}
              aria-current={link.active ? "page" : undefined}
              onClick={closeMenu}
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </header>
  );
}

function routeName(route: RoutableSuperSkillRoute | { name: "not-found" }): string {
  if (route.name === "capability" || route.name === "selected" || route.name === "category" || route.name === "resource" || route.name === "search") return `${route.name}:${JSON.stringify(route)}`;
  if (route.name === "install") return `${route.name}:${route.capabilityId ?? "shared"}`;
  return route.name;
}
