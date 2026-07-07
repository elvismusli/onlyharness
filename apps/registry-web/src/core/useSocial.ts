import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { apiUrl, remixRecipe } from "./constants";
import { keyFor } from "./format";
import { supabase } from "./supabase";
import type { DetailTab, HarnessDetail, RegistryItem, ThreadItem } from "./types";

export type UseSocialOptions = {
  session: Session | null;
  accessToken?: string;
  requireUser: (note: string) => boolean;
  openLogon: (note?: string) => void;
  cacheItem: (item: RegistryItem) => void;
  prependItem: (item: RegistryItem) => void;
  bumpRefresh: () => void;
  copyText: (text: string, label: string, tag?: string) => void;
  openHarness: (item: RegistryItem, tab?: DetailTab) => void;
  showDialog: (spec: { title: string; icon: string; body: string; cancel?: boolean; onOk?: () => void }) => void;
  onFlash?: (msg: string) => void;
};

/**
 * Skin-agnostic social logic extracted from the Win98 `App()`.
 *
 * Owns the per-harness social state (`starred`, `remixed`, `remotePosts`,
 * `drafts`, `kinds`, `tryStates`), the logged-in star-map bootstrap effect, and
 * the star / remix / try-sample / thread handlers. Behaviour and API endpoints
 * are preserved exactly from the host component.
 *
 * This is the most cross-cutting hook, so every skin dependency is injected via
 * `opts`: gates (`requireUser`, `openLogon`), the registry cache helpers
 * (`cacheItem`, `prependItem`, `bumpRefresh`), clipboard (`copyText`), navigation
 * (`openHarness`), dialogs (`showDialog`), and toasts (`onFlash`). `session` is
 * used both for the star-map fetch and for marking the current user's own
 * optimistic thread posts in `threadFor`.
 */
export function useSocial(opts: UseSocialOptions) {
  const [starred, setStarred] = useState<Record<string, boolean>>({});
  const [remixed, setRemixed] = useState<Record<string, boolean>>({});
  const [remotePosts, setRemotePosts] = useState<Record<string, ThreadItem[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [kinds, setKinds] = useState<Record<string, string>>({});
  const [tryStates, setTryStates] = useState<Record<string, "idle" | "running" | "done">>({});

  useEffect(() => {
    if (!supabase || !opts.session?.user) {
      setStarred({});
      setRemixed({});
      return;
    }
    supabase
      .from("user_harness_actions")
      .select("owner,repo,action")
      .then(({ data }) => {
        const nextStars: Record<string, boolean> = {};
        for (const action of data ?? []) {
          const key = `${action.owner}/${action.repo}`;
          if (action.action === "star") nextStars[key] = true;
        }
        setStarred(nextStars);
        setRemixed({});
      });
  }, [opts.session]);

  function recordHarnessEvent(kind: "view" | "copy", item: RegistryItem, target: string) {
    void fetch(`${apiUrl}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(opts.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {})
      },
      body: JSON.stringify({
        kind,
        owner: item.owner,
        repo: item.name,
        target,
        client: "registry-web"
      })
    }).catch(() => undefined);
  }

  async function toggleStar(item: RegistryItem) {
    if (!opts.requireUser("Log on to star harnesses. Stars keep the heat honest.")) return;
    const key = keyFor(item);
    const next = !starred[key];
    setStarred((current) => ({ ...current, [key]: next }));
    opts.onFlash?.(next ? `★ Starred ${item.title} · heat +0.4` : `Unstarred ${item.title}`);
    if (!opts.accessToken) return;
    try {
      const response = await fetch(`${apiUrl}/repos/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.name)}/star`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.accessToken}`
        },
        body: JSON.stringify({ starred: next })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Star failed (${response.status})`);
      opts.bumpRefresh();
    } catch (error) {
      setStarred((current) => ({ ...current, [key]: !next }));
      opts.onFlash?.(error instanceof Error ? error.message : "Star failed");
    }
  }

  async function remixHarness(item: RegistryItem) {
    const recipe = remixRecipe(item);
    const key = keyFor(item);
    if (!opts.accessToken) {
      setRemixed((current) => ({ ...current, [key]: true }));
      void opts.copyText(recipe, `Local remix recipe copied for ${item.title}`, `remix:${key}`);
      opts.openLogon("Log on to create a server-side local remix draft. A local recipe was copied.");
      return;
    }
    try {
      const response = await fetch(`${apiUrl}/repos/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.name)}/remixes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.accessToken}`
        },
        body: JSON.stringify({ name: `my-${item.name}` })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRemixed((current) => ({ ...current, [key]: true }));
        void opts.copyText(recipe, `Local remix recipe copied for ${item.title}`, `remix:${key}`);
        const next = typeof data.next === "string" ? `\n\n${data.next}` : "";
        throw new Error(`${data.error ?? `Server-side remix failed (${response.status})`}${next}`);
      }
      const remixItem = data.item as RegistryItem | undefined;
      if (remixItem) {
        const remixKey = keyFor(remixItem);
        opts.prependItem(remixItem);
        setRemixed((current) => ({ ...current, [key]: true, [remixKey]: true }));
        opts.bumpRefresh();
        opts.showDialog({
          title: "Local remix draft created",
          icon: "⑂",
          body: `${remixItem.title} is available as ${remixItem.owner}/${remixItem.name}.\n\nIt starts free and unverified; edit it, then run eval/gate before treating it as production-ready.`
        });
        opts.openHarness(remixItem);
        return;
      }
      throw new Error("Server-side remix returned no registry item.");
    } catch (error) {
      opts.showDialog({
        title: "Remix draft fallback",
        icon: "⑂",
        body: `${error instanceof Error ? error.message : "Server-side remix failed."}\n\nUse this local path instead:\n\n${recipe}`
      });
    }
  }

  async function runSample(item: RegistryItem) {
    if (item.contentType === "directory") {
      opts.onFlash?.("Directory entries are link-only; open the upstream index instead.");
      return;
    }
    const key = keyFor(item);
    setTryStates((current) => ({ ...current, [key]: "done" }));
    opts.onFlash?.("Preview only. Run hh eval or hh gate locally for execution evidence.");
  }

  async function addThreadPost(item: RegistryItem) {
    const key = keyFor(item);
    const draft = (drafts[key] ?? "").trim();
    if (!draft) return;
    if (!opts.requireUser("Log on to post in the thread.")) return;
    const kind = kinds[key] ?? "question";
    if (!opts.accessToken) return;
    try {
      const response = await fetch(`${apiUrl}/repos/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.name)}/thread`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.accessToken}`
        },
        body: JSON.stringify({ kind, body: draft })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Post failed (${response.status})`);
      const post = data.item as ThreadItem | undefined;
      if (!post?.id) throw new Error("Post failed: empty API response");
      setRemotePosts((current) => ({ ...current, [key]: [...(current[key] ?? []), post] }));
      setDrafts((current) => ({ ...current, [key]: "" }));
      opts.bumpRefresh();
    } catch (error) {
      opts.onFlash?.(error instanceof Error ? error.message : "Post failed");
    }
  }

  function threadFor(item: RegistryItem, detail?: HarnessDetail): ThreadItem[] {
    const key = keyFor(item);
    return [
      ...(detail?.thread ?? []),
      ...(remotePosts[key] ?? []).map((post) =>
        post.userId && post.userId === opts.session?.user?.id ? { ...post, author: "you" } : post
      )
    ];
  }

  function setDraft(key: string, value: string) {
    setDrafts((current) => ({ ...current, [key]: value }));
  }

  function setKind(key: string, value: string) {
    setKinds((current) => ({ ...current, [key]: value }));
  }

  /* Registry "refresh" in the host drops optimistic thread posts so the
     re-fetched detail thread is the single source of truth. This mirrors the
     original `setRemotePosts({})` call that lived in the host's refresh action. */
  function clearRemotePosts() {
    setRemotePosts({});
  }

  return {
    starred,
    remixed,
    remotePosts,
    drafts,
    kinds,
    tryStates,
    setDraft,
    setKind,
    clearRemotePosts,
    toggleStar,
    remixHarness,
    runSample,
    addThreadPost,
    recordHarnessEvent,
    threadFor
  };
}
