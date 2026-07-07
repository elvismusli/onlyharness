import { fmtK, keyFor } from "../../core/format";
import { useHarness } from "../../core/store";
import type { RegistryItem } from "../../core/types";
import type { Surface } from "../../core/useAppNav";
import { Btn, Tag } from "./primitives";

/**
 * Modern Storefront public page — the Win98 `StorefrontBody` (My Briefcase public
 * view) rebuilt on Modern tokens. A full-viewport `.ohd` layer above Explore that
 * renders a public creator storefront for the `storefront` surface (its `key` is
 * the handle): a header (@handle, bio, ref/safe-profile tags), a grid of the
 * creator's published harnesses (from `page.items`, click → `openHarness`), and a
 * sticky "Creator ref-link" block with a Copy ref-link button (→ `copyText`).
 *
 * Loading and empty states are honest: the ref-link falls back to the current
 * `refCode` while the page loads, and an empty published list says so rather than
 * inventing harnesses.
 */
export function ModernStorefront({ surface }: { surface: Surface }) {
  const h = useHarness();
  const handle = surface.key ?? "";
  const page = h.storefronts[handle];
  /* The shared store caches whatever `/storefront/:handle` returns, including
     error bodies when no storefront store is configured (e.g. `{ error }` on a
     503). Only treat the page as loaded once it actually carries a profile, so a
     malformed/unavailable response falls through to the honest loading state
     instead of throwing on `page.profile`. */
  const profile = page?.profile;
  const items: RegistryItem[] = page?.items ?? [];

  const baseUrl = typeof window === "undefined" ? "https://onlyharness.com" : window.location.origin;
  const ref = page?.referralCode || h.refCode || "";
  const refLink = `${baseUrl}/#/@${encodeURIComponent(profile?.handle ?? handle)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`;
  const copied = h.copiedTag === `storefront:${handle}`;

  return (
    <main className="oh-main ohd">
      <button type="button" className="ohd-back" onClick={() => h.closeSurface(surface.id)}>
        ← Explore
      </button>

      <header className="ohd-head">
        <div className="oh-store-avatar" aria-hidden>@</div>
        <div className="ohd-head-main">
          <div className="ohd-owner">Creator storefront</div>
          <h1 className="ohd-title">@{profile?.handle ?? handle}</h1>
          <p className="ohd-summary">{profile?.bio || (profile ? "This creator hasn't written a bio yet." : "Creator storefront is loading…")}</p>
          <div className="ohd-tags">
            {profile?.display_name && <Tag>{profile.display_name}</Tag>}
            {ref && <span className="oh-safe-badge">ref {ref}</span>}
            <span className="oh-tag">public safe profile</span>
          </div>
        </div>
      </header>

      <div className="ohd-grid">
        {/* ================= LEFT: published harnesses ================= */}
        <section className="ohd-panel">
          <h4 className="ohd-h" style={{ marginTop: 0 }}>Published harnesses</h4>
          {items.length > 0 ? (
            <div className="oh-store-grid">
              {items.map((item) => (
                <button
                  type="button"
                  className="oh-store-card"
                  key={keyFor(item)}
                  onClick={() => h.openHarness(item)}
                >
                  <div className="oh-store-card-head">
                    <span className="oh-store-card-ic" aria-hidden>{item.contentType === "directory" ? "🗂️" : "📦"}</span>
                    <div className="oh-store-card-heading">
                      <div className="oh-store-card-title">{item.title}</div>
                      <div className="oh-store-card-author">{item.owner}/{item.name}</div>
                    </div>
                    {item.heatQualified && <span className="oh-heat-badge">🔥 {item.heat.toFixed(1)}</span>}
                  </div>
                  <p className="oh-store-card-promise">{item.summary}</p>
                  <div className="oh-store-card-foot">
                    <span>★ {fmtK(item.stars + (h.starred[keyFor(item)] ? 1 : 0))}</span>
                    <span>⑂ {fmtK(item.forks)}</span>
                    <span>💬 {item.threads}</span>
                    <span className="oh-store-card-eval">
                      {item.contentType === "directory" ? "link-only" : `eval ${item.evalScore ? item.evalScore.toFixed(2) : "—"}`}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="oh-empty">
              {profile
                ? "No public harnesses attached to this handle yet."
                : "Loading storefront…"}
            </div>
          )}
        </section>

        {/* ================= RIGHT: ref-link ================= */}
        <aside className="ohd-aside">
          <section className="ohd-box">
            <h4 className="ohd-box-title">Creator ref-link</h4>
            <div className="ohd-cliline">
              <span className="ohd-cliline-cmd">{refLink}</span>
              <span className="ohd-cliline-meta">{ref ? `ref ${ref}` : "no referral code yet"}</span>
            </div>
            <div style={{ marginTop: 12 }}>
              <Btn variant="primary" onClick={() => h.copyText(refLink, "Ref-link copied", `storefront:${handle}`)}>
                {copied ? "✓ Copied" : "📋 Copy ref-link"}
              </Btn>
            </div>
            <p className="ohd-fine" style={{ marginTop: 12 }}>
              Referral attribution is applied at checkout; it does not grant free access.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
