import { useEffect } from "react";
import type { ReactNode } from "react";

import { useHarness } from "../../core/store";
import type { Surface } from "../../core/useAppNav";
import type { WinKind } from "../../core/types";
import { Btn } from "./primitives";
import { Nav } from "./nav";
import { ModernExplore } from "./explore";
import { ModernDetail } from "./detail";
import { ModernPublish } from "./publish";
import { ModernLeaderboard } from "./leaderboard";
import { ModernShare } from "./share";
import { ModernStorefront } from "./storefront";
import { ModernProfile } from "./profile";
import { ModernLogon } from "./auth";
import { ModernChrome } from "./chrome";
import { NeutralInstall } from "../shared/neutral/install";
import { NeutralCli } from "../shared/neutral/cli";
import { NeutralCheckout } from "../shared/neutral/checkout";
import { NeutralReview } from "../shared/neutral/review";
import { NeutralNetwork } from "../shared/neutral/network";
import "./tokens.css";
import "../shared/neutral/neutral.css";

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;450;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap";

/** Belt-and-braces: ensure the Modern Google Fonts <link> exists once the skin
 *  mounts (tokens.css also @imports them; this guards against a build that
 *  strips/inlines the @import). Idempotent — keyed by id, never duplicated. */
function useModernFonts() {
  useEffect(() => {
    const id = "oh-modern-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = FONTS_HREF;
    document.head.appendChild(link);
    /* leave it in place across skin switches so re-entry is instant */
  }, []);
}

/**
 * Paint the page canvas (html/body) with the Modern near-black while this skin
 * is mounted, restoring the prior value on unmount. Other skins style `body`
 * globally (e.g. Win98's teal) and their CSS chunk stays in the document after a
 * skin switch, so without this the old body colour bleeds behind Modern during
 * overscroll. Scoped entirely to the Modern skin — no other skin's CSS is
 * touched. */
function useModernCanvas() {
  useEffect(() => {
    const { body, documentElement: html } = document;
    const prev = { body: body.style.background, html: html.style.background };
    body.style.background = "#0a0a0b";
    html.style.background = "#0a0a0b";
    return () => {
      body.style.background = prev.body;
      html.style.background = prev.html;
    };
  }, []);
}

/** Human title for a placeholder surface (until Tasks 1.4–1.6 build real ones). */
function surfaceTitle(surface: Surface, h: ReturnType<typeof useHarness>): string {
  const item = surface.key ? h.knownItems[surface.key] : undefined;
  const titles: Record<WinKind, string> = {
    harness: item?.title ?? "Harness",
    publish: "Publish a resource",
    install: item ? `Install — ${item.title}` : "Install Center",
    checkout: "Checkout",
    cli: "CLI",
    review: "Maintainer review",
    leaderboard: "Leaderboard",
    share: item ? `Share — ${item.title}` : "Share",
    storefront: surface.key ? `@${surface.key}` : "Creator",
    profile: "Your profile",
    network: "Network"
  };
  return titles[surface.kind];
}

/**
 * Minimal placeholder panel for any non-Explore surface. Tasks 1.4–1.6 replace
 * these with real Modern detail/install/etc. views. Shown as a centered overlay
 * card so a click-through from Explore lands somewhere honest and closable.
 */
function SurfacePlaceholder({ surface }: { surface: Surface }) {
  const h = useHarness();
  const which =
    surface.kind === "harness"
      ? "Detail coming in 1.4"
      : `${surface.kind[0].toUpperCase()}${surface.kind.slice(1)} coming soon`;
  return (
    <div className="oh-overlay" role="dialog" aria-label={surfaceTitle(surface, h)}>
      <div className="oh-overlay-card">
        <div className="oh-overlay-head">
          <h2 className="oh-overlay-title">{surfaceTitle(surface, h)}</h2>
          <button
            type="button"
            className="oh-overlay-close"
            aria-label="Close"
            onClick={() => h.closeSurface(surface.id)}
          >
            ✕
          </button>
        </div>
        <p className="oh-overlay-body">{which}.</p>
        <div className="oh-overlay-actions">
          <Btn variant="secondary" onClick={() => h.closeSurface(surface.id)}>Close</Btn>
        </div>
      </div>
    </div>
  );
}

/**
 * Modern page shell for a shared-neutral surface. The Install Center and CLI
 * terminal are skin-neutral (`skins/shared/neutral/*`) so they read serious in
 * every skin; here we drop them into the same full-viewport `.ohd` layer the
 * Modern detail/publish surfaces use — near-black canvas + top-right glow, its own
 * scroll, a back button and a content-max column — then render the neutral body
 * inside. The neutral CSS is self-contained (`.oh-neutral` + `--neutral-*`), so it
 * simply inherits the dark chrome around it.
 */
function ModernNeutralShell({ surface, children }: { surface: Surface; children: ReactNode }) {
  const h = useHarness();
  return (
    <main className="oh-main ohd">
      <button type="button" className="ohd-back" onClick={() => h.closeSurface(surface.id)}>
        ← Explore
      </button>
      <div style={{ maxWidth: "var(--oh-content-max)", margin: "0 auto" }}>{children}</div>
    </main>
  );
}

/**
 * Surface router. The active surface is `h.activeId` ("" == Explore). Explore
 * always renders underneath; when a surface is active we render its placeholder
 * (or, later, its real view) on top. The switch is exhaustive over `WinKind` so
 * every surface has a home — `install`/`cli` route to the shared-neutral surfaces.
 */
function SurfaceRouter() {
  const h = useHarness();
  const active = h.surfaces.find((surface) => surface.id === h.activeId);

  /* Explore is the base layer (activeId "" or no matching surface). */
  const overlay = active ? renderSurface(active) : null;

  return (
    <>
      <ModernExplore />
      {overlay}
    </>
  );
}

function renderSurface(surface: Surface) {
  switch (surface.kind) {
    case "harness":
      /* Task 1.4: the real two-column Modern detail page. */
      return <ModernDetail surface={surface} />;
    case "publish":
      /* Task 1.5a: the Modern New Resource Wizard. */
      return <ModernPublish surface={surface} />;
    case "leaderboard":
      /* Task 1.5a: the Modern Harness-Heat leaderboard. */
      return <ModernLeaderboard surface={surface} />;
    case "share":
      /* Task 1.5b: the Modern share/brag card. */
      return <ModernShare surface={surface} />;
    case "storefront":
      /* Task 1.5b: the Modern public creator storefront. */
      return <ModernStorefront surface={surface} />;
    case "profile":
      /* Task 1.5b: the Modern creator-profile editor. */
      return <ModernProfile surface={surface} />;
    case "install":
      /* Task 1.6a: the shared-neutral Install Center (used by every skin). */
      return (
        <ModernNeutralShell surface={surface}>
          <NeutralInstall surfaceKey={surface.key} />
        </ModernNeutralShell>
      );
    case "cli":
      /* Task 1.6a: the shared-neutral CLI terminal (used by every skin). */
      return (
        <ModernNeutralShell surface={surface}>
          <NeutralCli surfaceKey={surface.key} />
        </ModernNeutralShell>
      );
    case "checkout":
      /* Task 1.6b: the shared-neutral Manual Checkout handoff (used by every skin). */
      return (
        <ModernNeutralShell surface={surface}>
          <NeutralCheckout surfaceKey={surface.key} />
        </ModernNeutralShell>
      );
    case "review":
      /* Task 1.6b: the shared-neutral Maintainer Review (used by every skin). */
      return (
        <ModernNeutralShell surface={surface}>
          <NeutralReview surfaceKey={surface.key} />
        </ModernNeutralShell>
      );
    case "network":
      /* Task 1.6b: the shared-neutral Network / Org workspace (used by every skin). */
      return (
        <ModernNeutralShell surface={surface}>
          <NeutralNetwork />
        </ModernNeutralShell>
      );
    default: {
      /* exhaustiveness guard: a new WinKind must be handled above */
      const _never: never = surface.kind;
      return _never;
    }
  }
}

/**
 * Modern skin entry — a pure consumer of `useHarness()` (data/actions/nav come
 * from the store mounted above the skin in `main.tsx`, so switching skins
 * preserves state). Wraps everything in `.skin-modern` and renders the sticky
 * nav + the surface router.
 */
export function ModernSkin() {
  useModernFonts();
  useModernCanvas();
  return (
    <div className="skin-modern" data-skin="modern">
      <Nav />
      <SurfaceRouter />
      <ModernLogon />
      <ModernChrome />
    </div>
  );
}
