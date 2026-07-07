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
 * Registered skins, in switcher order. Each is lazily mounted so only the active
 * skin's chunk loads. The default skin is resolved in SkinProvider (still Win98),
 * independent of this array's order.
 */
export const SKINS: SkinEntry[] = [
  {
    id: "modern",
    label: "Modern",
    icon: "🖥",
    mount: lazy(() => import("./modern").then((m) => ({ default: m.ModernSkin })))
  },
  {
    id: "win98",
    label: "W98",
    icon: "🪟",
    mount: lazy(() => import("./win98").then((m) => ({ default: m.Win98Skin })))
  },
  {
    id: "fans",
    label: "Fans",
    icon: "💙",
    mount: lazy(() => import("./fans").then((m) => ({ default: m.FansSkin })))
  }
];
