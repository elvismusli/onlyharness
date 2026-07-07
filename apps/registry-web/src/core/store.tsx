import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { apiUrl } from "./constants";
import { keyFor } from "./format";
import { useAuth } from "./useAuth";
import { useRegistry } from "./useRegistry";
import { useClipboard } from "./useClipboard";
import { useSocial } from "./useSocial";
import { usePublish } from "./usePublish";
import { useStorefront } from "./useStorefront";
import { useOrgWorkspace } from "./useOrgWorkspace";
import { useAppNav } from "./useAppNav";
import {
  initialRefCode,
  keyForCheckout,
  parseCheckoutLocation,
  parseHarnessHash,
  parseStorefrontHash,
  refFromLocation,
  setHarnessHash
} from "./url";
import type { CheckoutLinkState, DetailTab, DialogSpec, RegistryItem, ResourceItem, WinKind } from "./types";

/** A live dialog spec plus its optional confirm handler. */
export type ActiveDialog = DialogSpec & { onOk?: () => void };

/**
 * Everything a skin needs, composed once. This is the single object returned by
 * `useHarness()`: every core hook's API spread flat, plus the skin-neutral chrome
 * state (`flash`/`dialog`/`copyFallback`), the `open*` surface orchestration, and
 * `closeSurface`. The Win98 window manager layers only its own view-state
 * (position, minimized, z-order) on top of this.
 */
export type HarnessStoreValue = ReturnType<typeof useHarnessStore>;

const HarnessContext = createContext<HarnessStoreValue | null>(null);

export type HarnessStoreProps = {
  children: ReactNode;
};

/**
 * Compose every core hook + neutral chrome + the surface orchestration into one
 * value. Hook instantiation order and cross-wiring mirror the original Win98
 * `App()` exactly (see the inline notes): `useAuth`/`useClipboard` first,
 * `useSocial` before `useRegistry` via lazy `reg.*` wrappers, `useOrgWorkspace`
 * before `useRegistry` (which needs `org.orgHeadersForOwner`), then `usePublish`,
 * `useStorefront`, `useAppNav`. `flashMsg`/`showDialog`/`openHarness`/
 * `openMyBriefcase` are function declarations so the lazy wrappers can reference
 * them before their definitions, identical to the host's hoisting today.
 */
function useHarnessStore() {
  /* deep-link checkout link cache (keyed by keyForCheckout) */
  const [checkoutLinks, setCheckoutLinks] = useState<Record<string, CheckoutLinkState>>({});

  /* auth (storefront/social identity lives in useStorefront/useSocial) */
  const auth = useAuth({ onFlash: flashMsg });

  /* clipboard. Declared before `social` because `social`'s remix fallback copies
     the local recipe via `copyText`. */
  const { copyText, copiedTag, copyFallback, dismissFallback } = useClipboard({ onFlash: flashMsg });

  /* social state + handlers. Registry cache helpers are injected via lazy
     wrappers so `social` is created before `reg` (which reads `social.starred` as
     a plain value for its derived memos); the wrappers only dereference `reg`
     inside user-action handlers, well after both are mounted. */
  const social = useSocial({
    session: auth.session,
    accessToken: auth.accessToken,
    requireUser: auth.requireUser,
    openLogon: auth.openLogon,
    cacheItem: (item) => reg.cacheItem(item),
    prependItem: (item) => reg.prependItem(item),
    bumpRefresh: () => reg.bumpRefresh(),
    copyText,
    openHarness,
    showDialog,
    onFlash: flashMsg
  });

  /* organization workspace. Created before `reg` because `reg` needs
     `org.orgHeadersForOwner`; the `cacheItems` wrapper only dereferences `reg`
     inside `loadOrgWorkspace`'s fetch handler, well after both hooks mount — the
     same lazy trick used for reg↔social above. */
  const org = useOrgWorkspace({
    cacheItems: (items) => reg.cacheItems(items),
    onFlash: flashMsg
  });

  /* registry/resource data + discovery controls */
  const reg = useRegistry({ starred: social.starred, orgHeadersForOwner: org.orgHeadersForOwner });

  /* publish/import flow */
  const publish = usePublish({
    requireUser: auth.requireUser,
    accessToken: auth.accessToken,
    setQuery: reg.setQuery,
    setJobFilter: reg.setJobFilter,
    bumpRefresh: reg.bumpRefresh,
    closePublish: () => closeSurface("publish"),
    showDialog
  });

  /* storefront/creator-profile flow */
  const storefront = useStorefront({
    session: auth.session,
    accessToken: auth.accessToken,
    cacheItems: reg.cacheItems,
    onFlash: flashMsg,
    onNeedAuth: openMyBriefcase
  });

  /* skin-neutral surface stack: the source of truth for *which* windows exist,
     their taskbar order, the active surface, and each harness window's detail
     tab. The skin's window manager keeps only its view-state on top of it. */
  const nav = useAppNav();

  /* ---------- neutral chrome state ---------- */

  const [dialog, setDialog] = useState<ActiveDialog | null>(null);
  const [flash, setFlash] = useState("");
  const [refCode, setRefCode] = useState(() => initialRefCode());
  const flashTimer = useRef(0);
  const handledHash = useRef("");

  function flashMsg(message: string) {
    setFlash(message);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(""), 2000);
  }

  function showDialog(spec: ActiveDialog) {
    setDialog(spec);
  }

  function closeDialog() {
    setDialog(null);
  }

  /* ---------- deep-link effect ---------- */

  useEffect(() => {
    function openFromHash() {
      const ref = refFromLocation(window.location.search, window.location.hash);
      if (ref) {
        setRefCode((current) => current === ref ? current : ref);
        localStorage.setItem("onlyharness.ref", ref);
      }
      const checkout = parseCheckoutLocation(window.location.pathname, window.location.search);
      if (checkout) {
        const checkoutKey = keyForCheckout(checkout);
        const harnessKey = `${checkout.owner}/${checkout.repo}`;
        const item = reg.knownItems[harnessKey] ?? reg.allItems.find((entry) => entry.owner === checkout.owner && entry.name === checkout.repo);
        setCheckoutLinks((current) => ({ ...current, [checkoutKey]: checkout }));
        if (item) {
          reg.cacheItem(item);
          reg.loadDetail(item);
        }
        const canonical = `checkout:${checkoutKey}`;
        if (handledHash.current === canonical && nav.surfaces.some((surface) => surface.id === `checkout:${checkoutKey}`)) return;
        handledHash.current = canonical;
        openCheckout(checkoutKey);
        return;
      }
      const storefront = parseStorefrontHash(window.location.hash);
      if (storefront) {
        const canonical = `#/@${storefront.handle}`;
        if (handledHash.current === canonical && nav.surfaces.some((surface) => surface.id === `storefront:${storefront.handle}`)) return;
        handledHash.current = canonical;
        openStorefront(storefront.handle);
        return;
      }
      const parsed = parseHarnessHash(window.location.hash);
      if (!parsed) return;
      const key = `${parsed.owner}/${parsed.name}`;
      const item = reg.knownItems[key] ?? reg.allItems.find((entry) => entry.owner === parsed.owner && entry.name === parsed.name);
      if (!item) return;
      const canonical = `#/h/${parsed.owner}/${parsed.name}`;
      if (handledHash.current === canonical && nav.surfaces.some((surface) => surface.id === `harness:${key}`)) return;
      handledHash.current = canonical;
      openHarness(item);
    }

    window.addEventListener("hashchange", openFromHash);
    window.addEventListener("popstate", openFromHash);
    openFromHash();
    return () => {
      window.removeEventListener("hashchange", openFromHash);
      window.removeEventListener("popstate", openFromHash);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reg.allItems, reg.knownItems, nav.surfaces]);

  /* ---------- surface orchestration (open* + closeSurface) ----------
     Each wrapper preserves its exact data side-effects from the host; the only
     change is that "open a window" is now `nav.open(...)` rather than the Win98
     `openWin(...)`. The skin reconciles view-state (position/z-order) off
     `nav.surfaces` reactively. */

  function openHarness(item: RegistryItem, tab?: DetailTab) {
    const key = keyFor(item);
    reg.cacheItem(item);
    reg.loadDetail(item);
    setHarnessHash(item);
    const id = nav.open("harness", { key, tab });
    if (tab) nav.setTab(id, tab);
  }

  function openResource(item: ResourceItem) {
    const onlyHarnessUrl = item.actions?.find((action) => action.id === "open_onlyharness" && "url" in action)?.url
      ?? `https://onlyharness.com/#/resources/${encodeURIComponent(item.id)}`;
    const archiveUrl = item.actions?.find((action) => action.id === "download_archive" && "url" in action)?.url;
    const upstreamUrl = item.actions?.find((action) => action.id === "open_upstream" && "url" in action)?.url ?? item.canonicalUrl;
    window.history.replaceState(null, "", `#/resources/${encodeURIComponent(item.id)}`);
    showDialog({
      title: `Use ${item.title}`,
      icon: "🌐",
      body: [
        "Use this resource from OnlyHarness.",
        `OnlyHarness: ${onlyHarnessUrl}`,
        archiveUrl ? `Download from OnlyHarness: ${archiveUrl}` : "Download from OnlyHarness: not hosted yet",
        `CLI: hh resources detail ${item.id}`,
        `Upstream attribution: ${upstreamUrl}`
      ].join("\n")
    });
    void fetch(`${apiUrl}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {})
      },
      body: JSON.stringify({
        kind: "view",
        owner: item.upstreamOwner,
        repo: item.upstreamRepo ?? item.title,
        target: "resource-open",
        client: "registry-web"
      })
    }).catch(() => undefined);
    flashMsg(`Using ${item.title} from OnlyHarness`);
  }

  function openStorefront(handle: string) {
    const clean = handle.replace(/^@/, "").toLowerCase();
    if (!clean) return;
    storefront.loadStorefront(clean);
    nav.open("storefront", { key: clean });
  }

  function openMyBriefcase() {
    if (!auth.user) {
      auth.openLogon("Log on to create your creator @handle.");
      return;
    }
    storefront.setStorefrontStatus("");
    nav.open("profile");
  }

  function openInstall(item?: RegistryItem) {
    const selected = item ?? reg.topItem;
    if (selected?.contentType === "directory" && selected.directory?.url) {
      window.open(selected.directory.url, "_blank", "noopener,noreferrer");
      social.recordHarnessEvent("view", selected, "directory-open");
      flashMsg(`Opened directory: ${selected.title}`);
      return;
    }
    if (selected) {
      const key = keyFor(selected);
      reg.cacheItem(selected);
      social.recordHarnessEvent("view", selected, "install-center");
      nav.open("install", { key });
      return;
    }
    nav.open("install");
  }

  function openReview() {
    const item = reg.topItem;
    if (item) reg.loadDetail(item);
    nav.open("review", { key: item ? keyFor(item) : undefined });
  }

  function openCheckout(checkoutKey: string) {
    nav.open("checkout", { key: checkoutKey });
  }

  function openCli() {
    nav.open("cli", { key: reg.topItem ? keyFor(reg.topItem) : undefined });
  }

  function openLeaderboard() {
    nav.open("leaderboard");
  }

  function openShare(item: RegistryItem) {
    nav.open("share", { key: keyFor(item) });
  }

  function openPublish() {
    nav.open("publish");
  }

  function openNetwork() {
    nav.open("network");
  }

  /* ---------- deep-link URL reset on close ---------- */

  function clearDeepLinkForClosedWindow(id: string) {
    const checkout = parseCheckoutLocation(window.location.pathname, window.location.search);
    if (checkout && id === `checkout:${keyForCheckout(checkout)}`) {
      const next = checkout.ref ? `/?ref=${encodeURIComponent(checkout.ref)}` : "/";
      window.history.replaceState(null, "", next);
      handledHash.current = "";
      return;
    }

    const storefront = parseStorefrontHash(window.location.hash);
    if (storefront && id === `storefront:${storefront.handle}`) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      handledHash.current = "";
      return;
    }

    const harness = parseHarnessHash(window.location.hash);
    if (harness && id === `harness:${harness.owner}/${harness.name}`) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      handledHash.current = "";
    }
  }

  function closeSurface(id: string) {
    clearDeepLinkForClosedWindow(id);
    nav.close(id);
  }

  return {
    /* composed hook APIs */
    ...auth,
    ...reg,
    ...social,
    ...publish,
    ...storefront,
    ...org,
    ...nav,

    /* clipboard (spread individually to keep names stable across skins) */
    copyText,
    copiedTag,
    copyFallback,
    dismissFallback,

    /* deep-link caches read by skins for window titles/bodies */
    checkoutLinks,
    refCode,

    /* neutral chrome */
    flash,
    flashMsg,
    dialog,
    showDialog,
    closeDialog,

    /* surface orchestration */
    openHarness,
    openResource,
    openStorefront,
    openMyBriefcase,
    openInstall,
    openReview,
    openCheckout,
    openCli,
    openLeaderboard,
    openShare,
    openPublish,
    openNetwork,
    closeSurface
  };
}

/**
 * Context provider composing all core hooks into one `useHarness()` value.
 * Mounted above the active skin (`<HarnessStore><SkinProvider/></HarnessStore>`)
 * so `useHarness()` state survives a skin switch. A skin reads everything from
 * `useHarness()`.
 */
export function HarnessStore({ children }: HarnessStoreProps) {
  const value = useHarnessStore();
  return <HarnessContext.Provider value={value}>{children}</HarnessContext.Provider>;
}

/** Read the composed harness store. Must be called within `<HarnessStore>`. */
export function useHarness(): HarnessStoreValue {
  const value = useContext(HarnessContext);
  if (!value) throw new Error("useHarness must be used within <HarnessStore>");
  return value;
}

/** Re-export so skins can annotate against the surface kind union. */
export type { WinKind };
