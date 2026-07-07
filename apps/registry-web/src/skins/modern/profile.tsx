import { useHarness } from "../../core/store";
import type { Surface } from "../../core/useAppNav";
import { Btn, Tag } from "./primitives";

/**
 * Modern Profile editor — the Win98 `StorefrontEditorBody` (My Briefcase creator
 * profile) rebuilt on Modern tokens. A full-viewport `.ohd` layer above Explore
 * for the `profile` surface.
 *
 * Logged out it shows a gate with a single "Log on" action (`openLogon`). Logged
 * in it drives the shared storefront-editor state: `storefrontHandle`,
 * `storefrontDisplayName`, `storefrontBio` with the 3–32 / lowercase rule hints,
 * a Save profile / Claim handle button (`saveMyStorefront`), an Open public page
 * button (`openStorefront`, enabled once a profile exists), the `storefrontStatus`
 * line, and a sticky Public-URL block. Field-for-field with the Win98 editor,
 * restyled.
 */
export function ModernProfile({ surface }: { surface: Surface }) {
  const h = useHarness();
  const loggedIn = Boolean(h.user);

  /* ---- logged-out gate ---- */
  if (!loggedIn) {
    return (
      <main className="oh-main ohd">
        <button type="button" className="ohd-back" onClick={() => h.closeSurface(surface.id)}>
          ← Explore
        </button>

        <header className="ohd-head">
          <div className="ohd-head-main">
            <div className="ohd-owner">Creator profile</div>
            <h1 className="ohd-title">Create your @handle</h1>
            <p className="ohd-summary">Log on before publishing a public creator storefront.</p>
          </div>
        </header>

        <div className="oh-profile-wrap">
          <section className="ohd-box">
            <h4 className="ohd-box-title">Log on to claim a handle</h4>
            <p className="ohd-prose" style={{ marginBottom: 14 }}>
              A creator storefront gives your harnesses a public @handle and a referral ref-link. Your email,
              auth identity and private harnesses stay off the public page.
            </p>
            <Btn variant="primary" size="lg" onClick={() => h.openLogon("Log on to create your creator @handle.")}>
              🔑 Log on
            </Btn>
          </section>
        </div>
      </main>
    );
  }

  const profile = h.myStorefront;
  const publicHandle = profile?.handle ?? h.storefrontHandle.trim().replace(/^@/, "").toLowerCase();
  const baseUrl = typeof window === "undefined" ? "https://onlyharness.com" : window.location.origin;
  const publicUrl = publicHandle ? `${baseUrl}/#/@${encodeURIComponent(publicHandle)}` : "";

  return (
    <main className="oh-main ohd">
      <button type="button" className="ohd-back" onClick={() => h.closeSurface(surface.id)}>
        ← Explore
      </button>

      <header className="ohd-head">
        <div className="ohd-head-main">
          <div className="ohd-owner">Creator profile</div>
          <h1 className="ohd-title">{profile ? `@${profile.handle}` : "Create your @handle"}</h1>
          <p className="ohd-summary">{profile?.bio || "Claim a public handle before sharing creator ref-links."}</p>
          <div className="ohd-tags">
            {profile?.referral_code && <span className="oh-safe-badge">ref {profile.referral_code}</span>}
            <span className="oh-tag">public safe profile</span>
          </div>
        </div>
      </header>

      <div className="ohd-grid">
        {/* ================= LEFT: editor form ================= */}
        <section className="ohd-panel">
          <section className="ohd-box">
            <h4 className="ohd-box-title">Profile</h4>
            <div className="oh-profile-form">
              <label className="oh-profile-field">
                <span className="oh-profile-label">Handle</span>
                <input
                  className="ohd-input"
                  value={h.storefrontHandle}
                  onChange={(event) => h.setStorefrontHandle(event.target.value)}
                  placeholder="founder-tools"
                  autoComplete="nickname"
                  spellCheck={false}
                />
              </label>
              <label className="oh-profile-field">
                <span className="oh-profile-label">Display name</span>
                <input
                  className="ohd-input"
                  value={h.storefrontDisplayName}
                  onChange={(event) => h.setStorefrontDisplayName(event.target.value)}
                  placeholder="Founder Tools"
                  autoComplete="name"
                />
              </label>
              <label className="oh-profile-field">
                <span className="oh-profile-label">Bio</span>
                <textarea
                  className="ohd-input oh-profile-bio"
                  rows={4}
                  value={h.storefrontBio}
                  onChange={(event) => h.setStorefrontBio(event.target.value)}
                  placeholder="Reusable agent harnesses for operator workflows."
                />
              </label>
            </div>
            <div className="ohd-tags ohd-tags-flat" style={{ marginTop: 4 }}>
              <Tag>3-32 chars</Tag>
              <Tag>lowercase letters, numbers, hyphens</Tag>
            </div>
            <div className="ohd-btnrow">
              <Btn variant="primary" onClick={h.saveMyStorefront} disabled={h.storefrontBusy}>
                {h.storefrontBusy ? "⌛ Saving…" : profile ? "💾 Save profile" : "🗂️ Claim handle"}
              </Btn>
              <Btn
                variant="secondary"
                onClick={() => profile && h.openStorefront(profile.handle)}
                disabled={!profile}
              >
                🌐 Open public page
              </Btn>
            </div>
            {h.storefrontStatus && <p className="oh-profile-status">{h.storefrontStatus}</p>}
          </section>
        </section>

        {/* ================= RIGHT: public URL ================= */}
        <aside className="ohd-aside">
          <section className="ohd-box">
            <h4 className="ohd-box-title">Public URL</h4>
            <div className="ohd-cliline">
              <span className="ohd-cliline-cmd">{publicUrl || "Save a handle to create a public URL."}</span>
              {publicHandle && <span className="ohd-cliline-meta">@{publicHandle}</span>}
            </div>
          </section>
          <p className="ohd-fine">
            Email, auth identity and private harnesses stay out of the public storefront.
          </p>
        </aside>
      </div>
    </main>
  );
}
