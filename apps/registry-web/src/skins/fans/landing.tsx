import { useState } from "react";

import { useHarness } from "../../core/store";
import type { RegistryItem } from "../../core/types";
import { Avatar, Btn, Pill, Stat, SubscribeButton } from "./primitives";

/**
 * The Fans marketing landing — the OnlyFans-style PARODY hero where you "subscribe
 * to" and support harnesses like creators. A pure consumer of `useHarness()`:
 *
 * - the creator collage is built from real `h.items` (never fabricated), so an
 *   empty registry shows an honest empty state instead of fake cards;
 * - heat / forks / eval render only when the item actually carries them;
 * - the stats bar figures come straight from `h.totals`;
 * - the sign-up card is a marketing entry point to the real auth modal
 *   (`openLogon`), and Subscribe reuses the real star action (`toggleStar`).
 *
 * IP note: original parody — own "O" mark, own copy, footer says "a parody
 * landing". No third-party logos, wordmarks, or verbatim marketing copy.
 */

/* Fixed collage geometry from the hi-fi handoff (absolute placement + per-card
   bob duration). Cards beyond this many are simply not shown in the collage. */
const COLLAGE_SLOTS = [
  { top: "0px", left: "6%", w: "250px", rot: "-4deg", dur: "6s", avBg: "#e5f6ff" },
  { top: "150px", left: "42%", w: "256px", rot: "3deg", dur: "7.5s", avBg: "#efe9ff" },
  { top: "300px", left: "2%", w: "248px", rot: "2deg", dur: "8.2s", avBg: "#e6faed" },
  { top: "350px", left: "46%", w: "238px", rot: "-3deg", dur: "6.8s", avBg: "#e5f9f7" }
] as const;

/* A rotating palette of friendly avatar emoji, indexed by card position. Purely
   decorative (the registry item carries no icon), so this never asserts anything
   about the harness itself. */
const AVATAR_EMOJI = ["🔬", "🧩", "🛡️", "🕹️", "🤖", "📊", "🧠", "⚙️"];

const STEPS = [
  {
    n: "1",
    title: "Find your fave",
    body: "Browse skills, plugins, workflows, MCP servers and native packages with source and trust context."
  },
  {
    n: "2",
    title: "Subscribe & fork",
    body: "One click to run it, one fork to make it yours. Tweak the prompt, swap the tools, keep the results."
  },
  {
    n: "3",
    title: "Post & flex",
    body: "Publish a scaffold, verified native package, or hosted resource package without hiding its trust state."
  }
] as const;

/** Compact number formatting for the stats bar (12043 → "12,043"). */
function fmtInt(value: number): string {
  return value.toLocaleString("en-US");
}

/** One floating "creator" card in the collage, backed by a real registry item. */
function CreatorCard({
  item,
  slot,
  emoji
}: {
  item: RegistryItem;
  slot: (typeof COLLAGE_SLOTS)[number];
  emoji: string;
}) {
  const h = useHarness();
  const key = `${item.owner}/${item.name}`;
  const subscribed = Boolean(h.starred[key]);
  /* Only surface heat once the item has qualified for it, so the collage never
     shows an unqualified/zero heat as if it were real. */
  const showHeat = item.heatQualified && item.heat > 0;
  const showEval = item.evalStatus === "passed" && item.evalScore > 0;

  return (
    <div
      className="fa-creator"
      style={{
        top: slot.top,
        left: slot.left,
        width: slot.w,
        transform: `rotate(${slot.rot})`,
        // custom props consumed by the fa-float keyframes + card animation
        ["--fa-r" as string]: slot.rot,
        ["--fa-dur" as string]: slot.dur
      }}
    >
      <div className="fa-creator-head">
        <Avatar emoji={emoji} bg={slot.avBg} />
        <div className="fa-creator-meta">
          <div className="fa-creator-title">{item.title}</div>
          <div className="fa-creator-handle">@{item.owner}</div>
        </div>
      </div>
      <div className="fa-creator-price-row">
        <span className="fa-creator-price">
          $0<small>/mo</small>
        </span>
        <SubscribeButton
          subscribed={subscribed}
          onClick={() => h.toggleStar(item)}
          title={subscribed ? `Unsubscribe from ${item.title}` : `Subscribe to ${item.title}`}
        />
      </div>
      <div className="fa-creator-stats">
        {showHeat ? <Stat>🔥 {item.heat.toFixed(1)}</Stat> : null}
        <Stat>⑂ {fmtInt(item.forks)}</Stat>
        {showEval ? <Stat eval>eval {item.evalScore.toFixed(2)}</Stat> : null}
      </div>
    </div>
  );
}

/** The floating collage of up to 4 creator cards + the "Top creator" badge. */
function CreatorCollage() {
  const h = useHarness();
  const cards = h.items.slice(0, COLLAGE_SLOTS.length);

  return (
    <div className="fa-collage">
      {cards.length === 0 ? (
        <div className="fa-collage-empty">
          No creators to feature yet — publish a harness to headline the collage. 🤠
        </div>
      ) : (
        cards.map((item, index) => (
          <CreatorCard
            key={`${item.owner}/${item.name}`}
            item={item}
            slot={COLLAGE_SLOTS[index]}
            emoji={AVATAR_EMOJI[index % AVATAR_EMOJI.length]}
          />
        ))
      )}
      {cards.length > 0 ? (
        <div className="fa-top-badge">
          <Pill tone="dark">🏆 Top creator this week</Pill>
        </div>
      ) : null}
    </div>
  );
}

/** The white sign-up card: email + primary CTA, OR divider, GitHub + CLI pills. */
function SignUpCard() {
  const h = useHarness();
  const [email, setEmail] = useState("");
  const signedInAs = h.myHandle ? `@${h.myHandle}` : h.user?.email ?? "";

  /* The real account flow (name + password + confirmation) lives in the shared
     logon modal, so the landing's sign-up card is a marketing entry point into
     it. We seed a friendly note; if the visitor typed an email we mention it so
     the hand-off feels continuous. This keeps the wiring honest — we never call
     `signUp` with an empty password just to look interactive. */
  function startSignUp() {
    const note = email.trim()
      ? `Create your account for ${email.trim()} to start supporting harnesses.`
      : "Create your account to start supporting harnesses.";
    h.openLogon(note);
  }

  if (h.user) {
    return (
      <div className="fa-signup">
        <div className="fa-signup-primary">
          <div className="fa-input fa-signed-in" aria-label="Signed in account">
            Signed in as {signedInAs}
          </div>
          <Btn variant="primary" onClick={h.openMyBriefcase}>
            Open profile
          </Btn>
        </div>

        <div className="fa-or">
          <span aria-hidden />
          OR
          <span aria-hidden />
        </div>

        <div className="fa-oauth">
          <Btn variant="outline" onClick={h.openNetwork}>
            Workspaces
          </Btn>
          <Btn variant="cli" onClick={h.openCli}>
            &gt;_ Continue with CLI
          </Btn>
        </div>

        <p className="fa-fine">Your session is shared across every OnlyHarness skin.</p>
      </div>
    );
  }

  return (
    <div className="fa-signup">
      <div className="fa-signup-primary">
        <input
          className="fa-input"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          aria-label="Email"
          spellCheck={false}
          onKeyDown={(event) => {
            if (event.key === "Enter") startSignUp();
          }}
        />
        <Btn variant="primary" onClick={startSignUp}>
          Create your account
        </Btn>
      </div>

      <div className="fa-or">
        <span aria-hidden />
        OR
        <span aria-hidden />
      </div>

      <div className="fa-oauth">
        <Btn variant="outline" onClick={() => h.openLogon("Continue with GitHub to support harnesses.")}>
          <span aria-hidden>🔑</span> Continue with GitHub
        </Btn>
        <Btn variant="cli" onClick={h.openCli}>
          &gt;_ Continue with CLI
        </Btn>
      </div>

      <p className="fa-fine">By signing up you agree to fork responsibly, cowboy. 🤠</p>
    </div>
  );
}

/** Full-bleed brand-blue stats bar — four figures straight from `h.totals`. */
function StatsBar() {
  const h = useHarness();
  const { indexed, stars, forks, threads } = h.totals;
  const figures = [
    { value: fmtInt(indexed), label: "native packages indexed" },
    { value: fmtInt(stars), label: "stars given" },
    { value: fmtInt(forks), label: "total forks" },
    { value: fmtInt(threads), label: "thread posts" }
  ];

  return (
    <section className="fa-statsbar">
      <div className="fa-statsbar-inner">
        {figures.map((figure) => (
          <div key={figure.label}>
            <div className="fa-statsbar-figure">{figure.value}</div>
            <div className="fa-statsbar-label">{figure.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** "How it works" — 3 numbered step cards + a centered blue CTA → `openPublish`. */
function HowItWorks() {
  const h = useHarness();
  return (
    <section className="fa-how">
      <h2 className="fa-how-title">Everyone's shipping. Are you?</h2>
      <p className="fa-how-sub">Three steps from lurker to legend.</p>
      <div className="fa-steps">
        {STEPS.map((step) => (
          <div key={step.n} className="fa-step">
            <div className="fa-step-n" aria-hidden>{step.n}</div>
            <div className="fa-step-title">{step.title}</div>
            <div className="fa-step-body">{step.body}</div>
          </div>
        ))}
      </div>
      <div className="fa-how-cta">
        <Btn variant="primary" onClick={h.openPublish}>
          Start a resource →
        </Btn>
      </div>
    </section>
  );
}

/** Dark ink footer — logo + links + the parody disclaimer line. */
function Footer() {
  return (
    <footer className="fa-footer">
      <div className="fa-footer-inner">
        <div className="fa-footer-brand">
          <span className="fa-footer-logo" aria-hidden>O</span>
          <span>OnlyHarness</span>
        </div>
        <div className="fa-nav-spacer" />
        <nav className="fa-footer-links" aria-label="Footer">
          <a href="#">About</a>
          <a href="#">Docs</a>
          <a href="#">Safety</a>
          <a href="#">Terms</a>
        </nav>
      </div>
      <div className="fa-footer-fine">
        onlyharness.com — a parody landing. Fork responsibly. 🤠
      </div>
    </footer>
  );
}

/** The Fans landing (Explore surface): hero → stats bar → how it works → footer. */
export function FansLanding() {
  return (
    <>
      <section className="fa-hero">
        <div className="fa-blob fa-blob-1" aria-hidden />
        <div className="fa-blob fa-blob-2" aria-hidden />
        <div className="fa-hero-inner">
          <div>
            <h1 className="fa-h1">
              Sign up to support
              <br />
              your favorite <b>resources</b>.
            </h1>
            <p className="fa-lede">
              OnlyHarness is the home for reusable AI-agent resources. Find skills, plugins,
              workflows, MCP servers and verified native packages without guessing the install path. 🔥
            </p>
            <SignUpCard />
          </div>
          <CreatorCollage />
        </div>
      </section>

      <StatsBar />
      <HowItWorks />
      <Footer />
    </>
  );
}
