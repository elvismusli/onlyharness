import { useLayoutEffect } from "react";

/*
 * Motion per the b2a design system: "Reveals stagger 120ms … everything honours
 * prefers-reduced-motion by snapping to final state." Transform + opacity only.
 *
 * Robustness is the priority — content must NEVER stay hidden:
 *  - CSS hides elements ONLY after this hook adds `ss-reveal-ready`, and that is
 *    never added under reduced-motion or without IntersectionObserver, so content
 *    is always visible if JS/motion is off.
 *  - IntersectionObserver gives the nice in-view / on-scroll reveal.
 *  - scroll + resize listeners recover if the viewport was degenerate at mount.
 *  - an unconditional timeout failsafe reveals anything still hidden.
 *  - dedup is per-mount (WeakSet), so a StrictMode re-mount re-observes.
 */
const REVEAL_SELECTORS = [
  ".ss-hero-copy > *",
  ".ss-hero > .ss-task-prompt",
  ".ss-section-heading",
  ".ss-state",
  ".ss-skill-card",
  ".ss-explainer-grid > article",
  ".ss-install-steps > div",
  ".ss-client-tabs",
  ".ss-trust-report",
  ".ss-category > p",
  ".ss-check-explainer p"
].join(",");

function reveal(el: HTMLElement, index: number): void {
  el.style.transitionDelay = `${Math.min(Math.max(index, 0), 6) * 90}ms`;
  el.classList.add("is-revealed");
}

export function useReveal(): void {
  useLayoutEffect(() => {
    const root = document.querySelector<HTMLElement>(".skin-superskill");
    if (!root || typeof window === "undefined") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) return; // leave everything visible

    root.classList.add("ss-reveal-ready");
    const observed = new WeakSet<Element>();
    const io = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          const siblings = el.parentElement
            ? Array.from(el.parentElement.querySelectorAll<HTMLElement>(":scope > [data-reveal]"))
            : [el];
          reveal(el, siblings.indexOf(el));
          obs.unobserve(el);
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.05 }
    );

    const mark = () => {
      root.querySelectorAll<HTMLElement>(REVEAL_SELECTORS).forEach((el) => {
        if (el.classList.contains("is-revealed") || observed.has(el)) return;
        el.dataset.reveal = "1";
        observed.add(el);
        io.observe(el);
      });
    };
    mark();
    const mo = new MutationObserver(mark);
    mo.observe(root, { childList: true, subtree: true });

    // Recover if the viewport was degenerate at mount, and back up the observer.
    const recheck = () => {
      root.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-revealed)").forEach((el, index) => {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) reveal(el, index);
      });
    };
    window.addEventListener("scroll", recheck, { passive: true });
    window.addEventListener("resize", recheck);

    // Absolute guarantee: nothing stays hidden regardless of observer behaviour.
    const failsafe = window.setTimeout(() => {
      root.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-revealed)").forEach((el, index) => reveal(el, index));
    }, 2200);

    return () => {
      window.clearTimeout(failsafe);
      window.removeEventListener("scroll", recheck);
      window.removeEventListener("resize", recheck);
      io.disconnect();
      mo.disconnect();
    };
  }, []);
}
