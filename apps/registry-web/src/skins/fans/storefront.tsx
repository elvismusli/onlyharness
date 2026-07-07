import { useEffect } from "react";

import { fmtK, keyFor } from "../../core/format";
import { useHarness } from "../../core/store";
import type { RegistryItem } from "../../core/types";
import type { Surface } from "../../core/useAppNav";
import { Avatar, Btn, Pill, Stat, SubscribeButton } from "./primitives";
import "./storefront.css";

/**
 * Fans Storefront — the creator page. Same data as the Modern/Win98 storefront
 * (a public creator profile for the `storefront` surface, whose `key` is the
 * handle), reskinned into the friendly blue OnlyFans-parody creator metaphor:
 * a big round avatar + @handle + bio + a "Subscribe" / supporters header, a feed
 * of the creator's published harnesses rendered as creator-cards (click →
 * `openHarness`, each with its own Subscribe pill wired to the real star action),
 * and a Creator ref-link block with Copy ref-link.
 *
 * Honest states: the shared store caches whatever `/storefront/:handle` returns,
 * including error bodies when no storefront store is configured (the local API
 * returns a 503 `{ error }`). We only treat the page as loaded once it actually
 * carries a `profile`, so an unavailable/malformed response falls through to a
 * friendly loading state instead of throwing. The published feed says it is empty
 * or loading rather than inventing creator-cards; the ref-link falls back to the
 * current `refCode` while the page loads.
 */
export function FansStorefront({ surface }: { surface: Surface }) {
  const h = useHarness();
  const handle = surface.key ?? "";

  /* Self-sufficient load: the store's `openStorefront` normally kicks this off,
     but calling it here (idempotent — `loadStorefront` early-returns when the
     page is already cached) means this view also works if rendered directly for a
     handle that hasn't been fetched yet. */
  useEffect(() => {
    if (handle) h.loadStorefront(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  const page = h.storefronts[handle];
  const profile = page?.profile;
  const items: RegistryItem[] = page?.items ?? [];
  const loaded = Boolean(profile);

  const baseUrl = typeof window === "undefined" ? "https://onlyharness.com" : window.location.origin;
  const ref = page?.referralCode || h.refCode || "";
  const shownHandle = profile?.handle ?? handle;
  const refLink = `${baseUrl}/#/@${encodeURIComponent(shownHandle)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`;
  const copied = h.copiedTag === `storefront:${handle}`;

  return (
    <div className="fa-overlay fans-storefront" role="dialog" aria-label={`@${shownHandle}`}>
      <div className="fans-storefront-card">
        <button
          type="button"
          className="fans-storefront-close"
          aria-label="Close"
          onClick={() => h.closeSurface(surface.id)}
        >
          ✕
        </button>

        {/* ================= creator header ================= */}
        <header className="fans-storefront-head">
          <Avatar emoji="💙" size={92} />
          <div className="fans-storefront-identity">
            <div className="fans-storefront-kicker">Creator</div>
            <h1 className="fans-storefront-name">@{shownHandle}</h1>
            {profile?.display_name && (
              <div className="fans-storefront-displayname">{profile.display_name}</div>
            )}
            <p className="fans-storefront-bio">
              {profile?.bio
                || (loaded ? "This creator hasn't written a bio yet." : "Creator page is loading…")}
            </p>
            <div className="fans-storefront-badges">
              <Pill tone="soft">💙 supporters welcome</Pill>
              {ref && <Pill tone="brand">ref {ref}</Pill>}
              <Pill tone="soft">public safe profile</Pill>
            </div>
            <div className="fans-storefront-cta">
              <Btn variant="primary">💙 Subscribe</Btn>
              <span className="fans-storefront-cta-note">
                {loaded
                  ? `${items.length} published harness${items.length === 1 ? "" : "es"}`
                  : "loading…"}
              </span>
            </div>
          </div>
        </header>

        {/* ================= published feed ================= */}
        <section className="fans-storefront-feed">
          <h2 className="fans-storefront-feed-title">Published harnesses</h2>
          {items.length > 0 ? (
            <div className="fans-storefront-grid">
              {items.map((item) => {
                const key = keyFor(item);
                const subscribed = Boolean(h.starred[key]);
                return (
                  <button
                    type="button"
                    className="fans-storefront-post"
                    key={key}
                    onClick={() => h.openHarness(item)}
                  >
                    <div className="fans-storefront-post-head">
                      <Avatar emoji={item.contentType === "directory" ? "🗂️" : "📦"} size={40} />
                      <div className="fans-storefront-post-meta">
                        <div className="fans-storefront-post-title">{item.title}</div>
                        <div className="fans-storefront-post-handle">{item.owner}/{item.name}</div>
                      </div>
                      <SubscribeButton
                        subscribed={subscribed}
                        onClick={() => h.toggleStar(item)}
                        title={subscribed ? "Unsubscribe (unstar)" : "Subscribe (star)"}
                      />
                    </div>
                    <p className="fans-storefront-post-promise">{item.summary}</p>
                    <div className="fans-storefront-post-stats">
                      {item.heatQualified && <Stat>🔥 {item.heat.toFixed(1)}</Stat>}
                      <Stat>★ {fmtK(item.stars + (subscribed ? 1 : 0))}</Stat>
                      <Stat>⑂ {fmtK(item.forks)}</Stat>
                      <Stat>💬 {item.threads}</Stat>
                      {item.contentType === "directory" ? (
                        <Stat>link-only</Stat>
                      ) : (
                        <Stat eval>eval {item.evalScore ? item.evalScore.toFixed(2) : "—"}</Stat>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="fans-storefront-empty">
              {loaded
                ? "No public harnesses on this creator page yet. 💙"
                : "Loading creator page…"}
            </div>
          )}
        </section>

        {/* ================= creator ref-link ================= */}
        <section className="fans-storefront-reflink">
          <h2 className="fans-storefront-reflink-title">Creator ref-link</h2>
          <p className="fans-storefront-reflink-sub">
            Share this to bring supporters in. Attribution is applied at checkout — it does not grant free access.
          </p>
          <div className="fans-storefront-reflink-row">
            <code className="fans-storefront-reflink-url">{refLink}</code>
            <span className="fans-storefront-reflink-meta">{ref ? `ref ${ref}` : "no referral code yet"}</span>
          </div>
          <Btn
            variant="primary"
            onClick={() => h.copyText(refLink, "Ref-link copied", `storefront:${handle}`)}
          >
            {copied ? "✓ Copied" : "📋 Copy ref-link"}
          </Btn>
        </section>
      </div>
    </div>
  );
}
