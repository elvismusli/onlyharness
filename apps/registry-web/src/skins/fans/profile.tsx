import { useHarness } from "../../core/store";
import type { Surface } from "../../core/useAppNav";
import { Avatar, Btn, Pill } from "./primitives";
import "./profile.css";

/**
 * Fans Profile editor — the shared creator-profile form (the Win98
 * `StorefrontEditorBody` / My Briefcase creator profile, also rebuilt as
 * `ModernProfile`) painted in the friendly sky-blue Fans look. Rendered as a
 * full-viewport overlay above the Fans landing for the `profile` surface, matching
 * every other Fans surface's overlay pattern.
 *
 * It is a pure consumer of `useHarness()` and drives the exact same storefront
 * state as the other skins — field-for-field with `ModernProfile`, only the
 * chrome differs:
 *   - Logged out → a friendly "Create your @handle" card with a single Log in
 *     action (`openLogon`).
 *   - Logged in → the editor form: Handle / Display name / Bio inputs bound to
 *     `storefrontHandle` / `storefrontDisplayName` / `storefrontBio` with the
 *     3–32 / lowercase rule hints, a Save profile / Claim handle button
 *     (`saveMyStorefront`, disabled while `storefrontBusy`), an Open public page
 *     button (`openStorefront`, enabled once a profile exists), the
 *     `storefrontStatus` line, and a Public-URL block.
 *
 * `surface` is optional so the component is callable as `FansProfile()`; when the
 * surface router passes it we close that exact surface, otherwise we fall back to
 * the deterministic keyless `profile` surface id.
 */
export function FansProfile({ surface }: { surface?: Surface } = {}) {
  const h = useHarness();
  const loggedIn = Boolean(h.user);
  const close = () => h.closeSurface(surface?.id ?? "profile");

  /* ---- logged-out gate ---- */
  if (!loggedIn) {
    return (
      <div className="fa-overlay" role="dialog" aria-label="Create your @handle">
        <div className="fans-profile-card">
          <button type="button" className="fans-profile-close" aria-label="Close" onClick={close}>
            ✕
          </button>

          <div className="fans-profile-gate">
            <Avatar emoji="💙" size={64} />
            <h2 className="fans-profile-gate-title">Create your @handle</h2>
            <p className="fans-profile-gate-body">
              Claim a public creator page and start collecting subscribers for your harnesses. Log in first — your
              email, auth identity and private harnesses stay off the public page. 🤠
            </p>
            <Btn
              variant="primary"
              className="fans-profile-gate-btn"
              onClick={() => h.openLogon("Log in to create your creator @handle.")}
            >
              🔑 Log in
            </Btn>
            <p className="fans-profile-fine">fork responsibly, cowboy 🤠</p>
          </div>
        </div>
      </div>
    );
  }

  /* ---- logged-in editor ---- */
  const profile = h.myStorefront;
  const publicHandle = profile?.handle ?? h.storefrontHandle.trim().replace(/^@/, "").toLowerCase();
  const baseUrl = typeof window === "undefined" ? "https://onlyharness.com" : window.location.origin;
  const publicUrl = publicHandle ? `${baseUrl}/#/@${encodeURIComponent(publicHandle)}` : "";

  return (
    <div className="fa-overlay" role="dialog" aria-label="Edit your creator profile">
      <div className="fans-profile-card">
        <button type="button" className="fans-profile-close" aria-label="Close" onClick={close}>
          ✕
        </button>

        {/* header — avatar + current identity */}
        <header className="fans-profile-head">
          <Avatar emoji="💙" size={56} />
          <div className="fans-profile-head-meta">
            <h2 className="fans-profile-title">{profile ? "Edit your profile" : "Create your @handle"}</h2>
            <div className="fans-profile-subline">
              {publicHandle ? (
                <span className="fans-profile-handle">@{publicHandle}</span>
              ) : (
                <span className="fans-profile-handle fans-profile-handle-empty">@your-handle</span>
              )}
              {profile?.referral_code && <Pill tone="soft">ref {profile.referral_code}</Pill>}
            </div>
          </div>
        </header>

        {/* editor form */}
        <div className="fans-profile-form">
          <label className="fans-profile-field">
            <span className="fans-profile-label">Handle</span>
            <input
              className="fa-input"
              value={h.storefrontHandle}
              onChange={(event) => h.setStorefrontHandle(event.target.value)}
              placeholder="founder-tools"
              autoComplete="nickname"
              spellCheck={false}
            />
            <div className="fans-profile-hints">
              <Pill tone="soft">3–32 chars</Pill>
              <Pill tone="soft">lowercase · numbers · hyphens</Pill>
            </div>
          </label>

          <label className="fans-profile-field">
            <span className="fans-profile-label">Display name</span>
            <input
              className="fa-input"
              value={h.storefrontDisplayName}
              onChange={(event) => h.setStorefrontDisplayName(event.target.value)}
              placeholder="Founder Tools"
              autoComplete="name"
            />
          </label>

          <label className="fans-profile-field">
            <span className="fans-profile-label">Bio</span>
            <textarea
              className="fa-input fans-profile-bio"
              rows={4}
              value={h.storefrontBio}
              onChange={(event) => h.setStorefrontBio(event.target.value)}
              placeholder="Reusable agent harnesses for operator workflows. 💙"
            />
          </label>
        </div>

        {/* actions */}
        <div className="fans-profile-actions">
          <Btn variant="primary" onClick={h.saveMyStorefront} disabled={h.storefrontBusy}>
            {h.storefrontBusy ? "⌛ Saving…" : profile ? "💾 Save profile" : "🗂️ Claim handle"}
          </Btn>
          <Btn
            variant="outline"
            onClick={() => profile && h.openStorefront(profile.handle)}
            disabled={!profile}
          >
            🌐 Open public page
          </Btn>
        </div>

        {h.storefrontStatus && <p className="fans-profile-status">{h.storefrontStatus}</p>}

        {/* public URL block */}
        <section className="fans-profile-url">
          <span className="fans-profile-url-label">Your public page</span>
          <code className="fans-profile-url-value">
            {publicUrl || "Save a handle to create your public URL."}
          </code>
        </section>

        <p className="fans-profile-fine">
          Email, auth identity and private harnesses stay out of the public storefront.
        </p>
      </div>
    </div>
  );
}
