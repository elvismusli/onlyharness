import { useState } from "react";

import type { DetailTab, WinKind } from "./types";

/**
 * A skin-neutral "open surface" — one entry in the surface stack. It records
 * *which* thing is open (its `kind` + optional `key`) and any per-surface view
 * state that is genuinely skin-agnostic (`tab`). Purely visual chrome state that
 * only the Win98 window manager cares about — position, minimized, z-order —
 * lives in the host component, NOT here.
 */
export type Surface = {
  id: string;
  kind: WinKind;
  key?: string;
  tab?: DetailTab;
};

export type UseAppNavResult = {
  /** Insertion order == taskbar order (mirrors the old `wins` array identity). */
  surfaces: Surface[];
  /** Focused surface id; "" means the desktop / Explore surface. */
  activeId: string;
  /**
   * Open a surface. If one with the same `(kind, key)` already exists it is
   * reused (made active) and its id returned; otherwise a new surface is
   * appended, made active, and its id returned.
   */
  open: (kind: WinKind, opts?: { key?: string; tab?: DetailTab }) => string;
  /** Remove a surface; if it was active, clear the active id (""). */
  close: (id: string) => void;
  /** Make a surface active. */
  focus: (id: string) => void;
  /** Update a surface's detail tab. */
  setTab: (id: string, tab: DetailTab) => void;
  /** Locate a surface by `(kind, key)`. */
  find: (kind: WinKind, key?: string) => Surface | undefined;
};

/**
 * Build the deterministic surface id from a `(kind, key)` pair.
 *
 * This MUST match the old Win98 `openWin` id scheme exactly so that dedup — and
 * the deep-link dedup that compares against literal `harness:${key}` /
 * `storefront:${handle}` / `checkout:${checkoutKey}` ids — keeps matching:
 * keyed kinds get `${kind}:${key}`, keyless kinds are just `${kind}`.
 */
function surfaceId(kind: WinKind, key?: string): string {
  return kind === "harness" || kind === "storefront" || kind === "checkout" ? `${kind}:${key}` : kind;
}

/**
 * Skin-neutral surface stack: the single source of truth for *what* is open and
 * *which* surface is active, extracted from the Win98 window manager so future
 * skins can render the same open-list their own way.
 *
 * Pure state management: no fetches and no window/history side effects. Deep-link
 * URL handling stays in the host component and continues to drive `open`/`close`.
 */
export function useAppNav(): UseAppNavResult {
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [activeId, setActiveId] = useState("");

  function find(kind: WinKind, key?: string): Surface | undefined {
    const id = surfaceId(kind, key);
    return surfaces.find((surface) => surface.id === id);
  }

  function open(kind: WinKind, opts?: { key?: string; tab?: DetailTab }): string {
    const id = surfaceId(kind, opts?.key);
    setSurfaces((current) => {
      if (current.some((surface) => surface.id === id)) return current;
      return [...current, { id, kind, key: opts?.key, tab: opts?.tab }];
    });
    setActiveId(id);
    return id;
  }

  function close(id: string) {
    setSurfaces((current) => current.filter((surface) => surface.id !== id));
    setActiveId((current) => (current === id ? "" : current));
  }

  function focus(id: string) {
    setActiveId(id);
  }

  function setTab(id: string, tab: DetailTab) {
    setSurfaces((current) => current.map((surface) => (surface.id === id ? { ...surface, tab } : surface)));
  }

  return { surfaces, activeId, open, close, focus, setTab, find };
}
