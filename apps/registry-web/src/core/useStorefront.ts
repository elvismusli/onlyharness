import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { apiUrl } from "./constants";
import { supabase } from "./supabase";
import type { RegistryItem, StorefrontPage, StorefrontProfile } from "./types";

export type UseStorefrontOptions = {
  session: Session | null;
  accessToken?: string;
  cacheItems: (items: RegistryItem[]) => void;
  onFlash?: (msg: string) => void;
  /**
   * Defensive fallback used by `saveMyStorefront` when there is no access token.
   * In practice unreachable from the UI (the save button only renders when the
   * user is logged in, i.e. a token is present); preserved from the host
   * component's guard so behaviour is identical.
   */
  onNeedAuth?: () => void;
};

export type UseStorefrontResult = {
  storefronts: Record<string, StorefrontPage>;
  loadStorefront: (handle: string) => void;
  myHandle: string;
  myStorefront: StorefrontProfile | undefined;
  storefrontHandle: string;
  setStorefrontHandle: (value: string) => void;
  storefrontDisplayName: string;
  setStorefrontDisplayName: (value: string) => void;
  storefrontBio: string;
  setStorefrontBio: (value: string) => void;
  storefrontStatus: string;
  setStorefrontStatus: (value: string) => void;
  storefrontBusy: boolean;
  saveMyStorefront: () => Promise<void>;
};

/**
 * Skin-agnostic storefront / creator-profile logic extracted from the Win98
 * `App()`.
 *
 * Owns the storefront page cache (`storefronts`), the logged-in creator identity
 * (`myHandle`, `myStorefront`), and the profile-editor form state
 * (`storefrontHandle`, `storefrontDisplayName`, `storefrontBio`,
 * `storefrontStatus`, `storefrontBusy`). Bootstraps the current user's storefront
 * from `/me/storefront`, resets that identity on logout, lazily loads public
 * storefront pages (merging their items into the registry via injected
 * `cacheItems`), and saves the editor via `PUT /me/storefront`. Endpoints, status
 * strings and error handling are preserved exactly from the host component.
 */
export function useStorefront(opts: UseStorefrontOptions): UseStorefrontResult {
  const { session, accessToken, cacheItems, onFlash, onNeedAuth } = opts;

  const [storefronts, setStorefronts] = useState<Record<string, StorefrontPage>>({});
  const [myHandle, setMyHandle] = useState("");
  const [myStorefront, setMyStorefront] = useState<StorefrontProfile | undefined>();
  const [storefrontHandle, setStorefrontHandle] = useState("");
  const [storefrontDisplayName, setStorefrontDisplayName] = useState("");
  const [storefrontBio, setStorefrontBio] = useState("");
  const [storefrontStatus, setStorefrontStatus] = useState("");
  const [storefrontBusy, setStorefrontBusy] = useState(false);

  useEffect(() => {
    if (!supabase || !session?.user) {
      setMyHandle("");
      setMyStorefront(undefined);
      setStorefrontHandle("");
      setStorefrontDisplayName("");
      setStorefrontBio("");
      setStorefrontStatus("");
    }
  }, [session]);

  useEffect(() => {
    if (!accessToken) return;
    fetch(`${apiUrl}/me/storefront`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
      .then(async (response) => {
        if (response.status === 404) return undefined;
        if (!response.ok) throw new Error(`Storefront profile failed (${response.status})`);
        return await response.json() as StorefrontProfile;
      })
      .then((profile) => {
        setMyStorefront(profile);
        setMyHandle(profile?.handle ?? "");
        setStorefrontHandle(profile?.handle ?? "");
        setStorefrontDisplayName(profile?.display_name ?? "");
        setStorefrontBio(profile?.bio ?? "");
      })
      .catch(() => undefined);
  }, [session]);

  function loadStorefront(handle: string) {
    if (storefronts[handle]) return;
    fetch(`${apiUrl}/storefront/${encodeURIComponent(handle)}`)
      .then((response) => response.json())
      .then((data: StorefrontPage) => {
        setStorefronts((current) => ({ ...current, [handle]: data }));
        cacheItems(data.items ?? []);
      })
      .catch(() => undefined);
  }

  async function saveMyStorefront() {
    if (!accessToken) {
      onNeedAuth?.();
      return;
    }
    setStorefrontBusy(true);
    setStorefrontStatus("");
    const previousHandle = myStorefront?.handle;
    try {
      const response = await fetch(`${apiUrl}/me/storefront`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          handle: storefrontHandle,
          display_name: storefrontDisplayName,
          bio: storefrontBio
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Storefront save failed (${response.status})`);
      const profile = data as StorefrontProfile;
      setMyStorefront(profile);
      setMyHandle(profile.handle);
      setStorefrontHandle(profile.handle);
      setStorefrontDisplayName(profile.display_name);
      setStorefrontBio(profile.bio);
      setStorefronts((current) => {
        const next = { ...current };
        if (previousHandle) delete next[previousHandle];
        delete next[profile.handle];
        return next;
      });
      setStorefrontStatus(`Saved @${profile.handle}`);
      onFlash?.(`Saved @${profile.handle}`);
    } catch (error) {
      setStorefrontStatus(error instanceof Error ? error.message : "Storefront save failed");
    } finally {
      setStorefrontBusy(false);
    }
  }

  return {
    storefronts,
    loadStorefront,
    myHandle,
    myStorefront,
    storefrontHandle,
    setStorefrontHandle,
    storefrontDisplayName,
    setStorefrontDisplayName,
    storefrontBio,
    setStorefrontBio,
    storefrontStatus,
    setStorefrontStatus,
    storefrontBusy,
    saveMyStorefront
  };
}
