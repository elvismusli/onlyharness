import { useEffect } from "react";
import type { ReactNode } from "react";

import { useHarness } from "../../core/store";
import type { Surface } from "../../core/useAppNav";
import { Btn } from "./primitives";
import { FansNav } from "./nav";
import { FansLanding } from "./landing";
import { FansChrome } from "./chrome";
import { FansLogon } from "./auth";
import { FansDetail } from "./detail";
import { FansPublish } from "./publish";
import { FansLeaderboard } from "./leaderboard";
import { FansShare } from "./share";
import { FansStorefront } from "./storefront";
import { FansProfile } from "./profile";
import { NeutralInstall } from "../shared/neutral/install";
import { NeutralCli } from "../shared/neutral/cli";
import { NeutralCheckout } from "../shared/neutral/checkout";
import { NeutralReview } from "../shared/neutral/review";
import { NeutralNetwork } from "../shared/neutral/network";
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

/**
 * Fans page shell for a shared-neutral surface. The Install Center, CLI,
 * Checkout, Review and Network workspaces are skin-neutral
 * (`skins/shared/neutral/*`, self-contained `.oh-neutral` + `--neutral-*`) so they
 * read *serious* in every skin — money / maintainer review / org admin carry no
 * parody. Fans' `tokens.css` overrides `--neutral-*` to a light treatment so they
 * sit correctly on the blue wash. We render them inside the standard Fans overlay
 * with a friendly "back" affordance.
 */
function FansNeutralShell({ surface, children }: { surface: Surface; children: ReactNode }) {
  const h = useHarness();
  return (
    <div className="fa-overlay" role="dialog" aria-label="OnlyHarness">
      <div style={{ width: "100%", maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ marginBottom: 14 }}>
          <Btn variant="outline" onClick={() => h.closeSurface(surface.id)}>← Back</Btn>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Surface router. The active surface is `h.activeId` ("" == the landing). The
 * landing always renders underneath; when a surface is active we render its real
 * Fans view (or a shared-neutral surface wrapped in the Fans shell) on top. The
 * switch is exhaustive over `WinKind` with a `never` guard so a new surface kind
 * must be handled here.
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
    case "harness":
      return <FansDetail surface={surface} />;
    case "publish":
      return <FansPublish surface={surface} />;
    case "leaderboard":
      return <FansLeaderboard surface={surface} />;
    case "share":
      return <FansShare surface={surface} />;
    case "storefront":
      return <FansStorefront surface={surface} />;
    case "profile":
      return <FansProfile surface={surface} />;
    case "install":
      return (
        <FansNeutralShell surface={surface}>
          <NeutralInstall surfaceKey={surface.key} />
        </FansNeutralShell>
      );
    case "cli":
      return (
        <FansNeutralShell surface={surface}>
          <NeutralCli surfaceKey={surface.key} />
        </FansNeutralShell>
      );
    case "checkout":
      return (
        <FansNeutralShell surface={surface}>
          <NeutralCheckout surfaceKey={surface.key} />
        </FansNeutralShell>
      );
    case "review":
      return (
        <FansNeutralShell surface={surface}>
          <NeutralReview surfaceKey={surface.key} />
        </FansNeutralShell>
      );
    case "network":
      return (
        <FansNeutralShell surface={surface}>
          <NeutralNetwork />
        </FansNeutralShell>
      );
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
 * and renders the sticky nav + the surface router + the logon modal + chrome.
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
      <FansLogon />
      <FansChrome />
    </div>
  );
}
