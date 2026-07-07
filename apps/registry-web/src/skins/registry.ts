import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

/** The set of skins the app knows about. Only `win98` ships today. */
export type SkinId = "win98" | "modern" | "fans";

/** One registered skin: its id, a short switcher label + icon, and its lazy mount. */
export type SkinEntry = {
  id: SkinId;
  label: string;
  icon: string;
  mount: LazyExoticComponent<ComponentType>;
};

/**
 * Registered skins, in switcher order. Modern/Fans are added in later phases;
 * for now only Win98 is mounted so the switcher shows a single control.
 */
export const SKINS: SkinEntry[] = [
  {
    id: "win98",
    label: "W98",
    icon: "🪟",
    mount: lazy(() => import("./win98").then((m) => ({ default: m.Win98Skin })))
  }
];
