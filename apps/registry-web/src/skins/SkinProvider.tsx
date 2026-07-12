import { createContext, Suspense, useContext, useEffect, useMemo, useState } from "react";

import { SKINS, type SkinId } from "./registry";
import { GlobalSkinSwitcher } from "./SkinSwitcher";
import "./skin-switcher.css";

const SAFE_DEFAULT_SKIN: SkinId = "win98";
const STORAGE_KEY = "oh:skin";
const QUERY_KEY = "skin";

type SkinContextValue = {
  /** The active skin id. */
  skin: SkinId;
  /** Switch skins: persists to localStorage + `?skin=` and re-renders. */
  setSkin: (id: SkinId) => void;
};

const SkinContext = createContext<SkinContextValue | null>(null);

/** Narrow an arbitrary string to a known `SkinId`, or `null` if unregistered. */
function asSkinId(value: string | null | undefined): SkinId | null {
  return value && SKINS.some((entry) => entry.id === value) ? (value as SkinId) : null;
}

export function resolveConfiguredDefaultSkin(value: string | null | undefined): SkinId {
  return asSkinId(value) ?? SAFE_DEFAULT_SKIN;
}

export function isSkinSwitcherEnabled(value: string | null | undefined): boolean {
  return value === "true";
}

export function resolveHostnameDefaultSkin(hostname: string | null | undefined): SkinId | null {
  const normalized = hostname?.trim().toLowerCase();
  return normalized === "superskill.sh" || normalized === "www.superskill.sh" ? "superskill" : null;
}

/**
 * Resolve the initial skin by precedence: `?skin=` URL param, a product-specific
 * hostname, `localStorage["oh:skin"]`, then the configured default. Unknown ids
 * are ignored so stale values fall through rather than rendering nothing.
 */
function resolveInitialSkin(): SkinId {
  const fromQuery = asSkinId(new URLSearchParams(window.location.search).get(QUERY_KEY));
  if (fromQuery) return fromQuery;
  const fromHostname = resolveHostnameDefaultSkin(window.location.hostname);
  if (fromHostname) return fromHostname;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  const fromStorage = asSkinId(stored);
  if (fromStorage) return fromStorage;
  return resolveConfiguredDefaultSkin(import.meta.env.VITE_DEFAULT_SKIN);
}

/**
 * Owns the active skin id and renders it. Mount it *inside* `<HarnessStore>` so
 * `useHarness()` state survives a skin switch. The active skin's lazy `mount`
 * renders inside `<Suspense fallback={null}>`.
 */
export function SkinProvider() {
  const [skin, setSkinState] = useState<SkinId>(resolveInitialSkin);

  useEffect(() => {
    document.title = skin === "superskill" ? "SuperSkill — exact skills for agent tasks" : "OnlyHarness 98";
  }, [skin]);

  const value = useMemo<SkinContextValue>(
    () => ({
      skin,
      setSkin: (id: SkinId) => {
        try {
          window.localStorage.setItem(STORAGE_KEY, id);
        } catch {
          /* private mode / storage disabled: skin still switches in-memory */
        }
        const url = new URL(window.location.href);
        url.searchParams.set(QUERY_KEY, id);
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
        setSkinState(id);
      }
    }),
    [skin]
  );

  const active = SKINS.find((entry) => entry.id === skin) ?? SKINS[0];
  const Mount = active.mount;

  return (
    <SkinContext.Provider value={value}>
      <Suspense fallback={null}>
        <Mount />
      </Suspense>
      {/* One global switcher for every skin: fixed position, same viewport spot
          on all skins, styled outside any `.skin-*` scope (skin-switcher.css). */}
      {isSkinSwitcherEnabled(import.meta.env.VITE_ENABLE_SKIN_SWITCHER) ? <GlobalSkinSwitcher /> : null}
    </SkinContext.Provider>
  );
}

/** Read the active skin + switcher. Must be called within `<SkinProvider>`. */
export function useSkin(): SkinContextValue {
  const value = useContext(SkinContext);
  if (!value) throw new Error("useSkin must be used within <SkinProvider>");
  return value;
}
