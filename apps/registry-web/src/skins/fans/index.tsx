import { useEffect } from "react";

import { useHarness } from "../../core/store";
import type { Surface } from "../../core/useAppNav";
import type { WinKind } from "../../core/types";
import { Btn } from "./primitives";
import { FansNav } from "./nav";
import { FansLanding } from "./landing";
import { FansChrome } from "./chrome";
import "./tokens.css";
import "../shared/neutral/neutral.css";

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=JetBrains+Mono:wght@500;600&display=swap";

/** Belt-and-braces: ensure the Fans Google Fonts <link> exists once the skin
 *  mounts (tokens.css also @imports them; this guards against a build that
 *  strips/inlines the @import). Idempotent — keyed by id, never duplicated. */
function useFansFonts() {
  useEffect(() => {
    const id = "oh-fans-fonts";
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
 * Paint the page canvas (html/body) with the Fans blue wash while this skin is
 * mounted, restoring the prior value on unmount. Other skins style `body`
 * globally (e.g. Win98's teal, Modern's near-black) and their CSS chunk stays in
 * the document after a skin switch, so without this the old body colour would
 * bleed behind Fans during overscroll. Scoped entirely to the Fans skin — no
 * other skin's CSS is touched. */
function useFansCanvas() {
  useEffect(() => {
    const { body, documentElement: html } = document;
    const prev = { body: body.style.background, html: html.style.background };
    body.style.background = "#e9f8ff";
    html.style.background = "#e9f8ff";
    return () => {
      body.style.background = prev.body;
      html.style.background = prev.html;
    };
  }, []);
}

/** Human title for a placeholder surface (until later tasks build real ones). */
function surfaceTitle(surface: Surface, h: ReturnType<typeof useHarness>): string {
  const item = surface.key ? h.knownItems[surface.key] : undefined;
  const titles: Record<WinKind, string> = {
    harness: item?.title ?? "Harness",
    publish: "Publish a harness",
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
 * Minimal Fans placeholder card for any non-landing surface. Later Fans tasks
 * each replace one of these with a real surface view. Shown as a centered overlay
 * card on the wash so a click-through from the landing lands somewhere honest and
 * closable ("‹Kind› coming soon" → `closeSurface`).
 */
function FansPlaceholder({ surface }: { surface: Surface }) {
  const h = useHarness();
  const title = surfaceTitle(surface, h);
  return (
    <div className="fa-overlay" role="dialog" aria-label={title}>
      <div className="fa-overlay-card">
        <div className="fa-overlay-head">
          <h2 className="fa-overlay-title">{title}</h2>
          <button
            type="button"
            className="fa-overlay-close"
            aria-label="Close"
            onClick={() => h.closeSurface(surface.id)}
          >
            ✕
          </button>
        </div>
        <p className="fa-overlay-body">Coming soon to the Fans skin. 💙</p>
        <div className="fa-overlay-actions">
          <Btn variant="outline" onClick={() => h.closeSurface(surface.id)}>Close</Btn>
        </div>
      </div>
    </div>
  );
}

/**
 * Surface router. The active surface is `h.activeId` ("" == the landing). The
 * landing always renders underneath; when a surface is active we render its
 * placeholder (later, its real Fans view) on top. The switch is exhaustive over
 * `WinKind` with a `never` guard so a new surface kind must be handled here.
 */
function SurfaceRouter() {
  const h = useHarness();
  const active = h.surfaces.find((surface) => surface.id === h.activeId);
  const overlay = active ? renderSurface(active) : null;

  return (
    <>
      <FansLanding />
      {overlay}
    </>
  );
}

function renderSurface(surface: Surface) {
  switch (surface.kind) {
    /* Every surface is a placeholder for now — later Fans tasks each add one
       real surface view (detail / publish / install / …). */
    case "harness":
    case "publish":
    case "install":
    case "checkout":
    case "cli":
    case "review":
    case "leaderboard":
    case "share":
    case "storefront":
    case "profile":
    case "network":
      return <FansPlaceholder surface={surface} />;
    default: {
      /* exhaustiveness guard: a new WinKind must be handled above */
      const _never: never = surface.kind;
      return _never;
    }
  }
}

/**
 * Fans skin entry — a pure consumer of `useHarness()` (data/actions/nav come
 * from the store mounted above the skin in `main.tsx`, so switching skins
 * preserves state). Wraps everything in `.skin-fans`, paints the wash canvas,
 * and renders the sticky nav + the surface router + chrome.
 */
export function FansSkin() {
  useFansFonts();
  useFansCanvas();
  return (
    <div className="skin-fans" data-skin="fans">
      <div className="fa-page">
        <FansNav />
        <SurfaceRouter />
      </div>
      <FansChrome />
    </div>
  );
}
