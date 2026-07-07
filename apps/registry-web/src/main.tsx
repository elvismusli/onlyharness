import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { apiUrl, CLAUDE_PLUGIN_INSTALL_COMMAND, CODEX_MCP_INSTALL_COMMAND, remixRecipe } from "./core/constants";
import { supabase } from "./core/supabase";
import { clockLabel, keyFor } from "./core/format";
import { useAuth } from "./core/useAuth";
import { useRegistry } from "./core/useRegistry";
import { useClipboard } from "./core/useClipboard";
import { initialRefCode, keyForCheckout, parseCheckoutLocation, parseHarnessHash, parseStorefrontHash, refFromLocation, setHarnessHash } from "./core/url";
import type { CheckoutLinkState, DetailTab, DialogSpec, FloatWin, OrgWorkspace, RegistryItem, ResourceItem, StorefrontPage, StorefrontProfile, ThreadItem, WinKind } from "./core/types";
import { AwardWindow, DesktopIcons, LogonDialog, Mascot, PaintWindow, StartMenu, Taskbar, type StartEntry, type TaskEntry } from "./desktop";
import { DetailBody } from "./detail";
import { ExploreWindow } from "./explore";
import { CheckoutBody, CliBody, InstallBody, LeaderboardBody, NetworkBody, PublishBody, ReviewBody, ShareBody, StorefrontBody, StorefrontEditorBody } from "./windows";
import { Btn, Dialog, FloatWindow } from "./win98";
import "./styles.css";

const WIN_WIDTHS: Record<WinKind, number> = {
  harness: 960,
  publish: 640,
  install: 760,
  checkout: 760,
  cli: 620,
  review: 860,
  leaderboard: 460,
  share: 660,
  storefront: 860,
  profile: 660,
  network: 900
};

type ActiveDialog = DialogSpec & { onOk?: () => void };

function App() {
  /* registry/resource data (extracted to core/useRegistry) */
  const [storefronts, setStorefronts] = useState<Record<string, StorefrontPage>>({});
  const [checkoutLinks, setCheckoutLinks] = useState<Record<string, CheckoutLinkState>>({});

  /* social state */
  const [starred, setStarred] = useState<Record<string, boolean>>({});
  const [remixed, setRemixed] = useState<Record<string, boolean>>({});
  const [remotePosts, setRemotePosts] = useState<Record<string, ThreadItem[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [kinds, setKinds] = useState<Record<string, string>>({});
  const [tryStates, setTryStates] = useState<Record<string, "idle" | "running" | "done">>({});

  /* registry/resource data + discovery controls (starred/org headers stay here; they extract later) */
  const reg = useRegistry({ starred, orgHeadersForOwner });

  /* auth (extracted to core/useAuth; storefront/social identity stays here for now) */
  const auth = useAuth({ onFlash: flashMsg });
  const [myHandle, setMyHandle] = useState("");
  const [myStorefront, setMyStorefront] = useState<StorefrontProfile | undefined>();
  const [storefrontHandle, setStorefrontHandle] = useState("");
  const [storefrontDisplayName, setStorefrontDisplayName] = useState("");
  const [storefrontBio, setStorefrontBio] = useState("");
  const [storefrontStatus, setStorefrontStatus] = useState("");
  const [storefrontBusy, setStorefrontBusy] = useState(false);

  /* publish */
  const [importName, setImportName] = useState("customer-research-pipeline");
  const [importMarkdown, setImportMarkdown] = useState("# Customer Research Pipeline\n\nResearch target users, synthesize pains, critique assumptions, produce a decision memo with unresolved fields marked.");
  const [importStatus, setImportStatus] = useState("");
  const [importBusy, setImportBusy] = useState(false);

  /* organization workspace */
  const [networkOrg, setNetworkOrg] = useState(() => localStorage.getItem("hh:networkOrg") ?? "acme");
  const [networkToken, setNetworkToken] = useState("");
  const [networkStatus, setNetworkStatus] = useState("");
  const [networkBusy, setNetworkBusy] = useState(false);
  const [orgWorkspace, setOrgWorkspace] = useState<OrgWorkspace | undefined>();

  /* window manager: `wins` keeps stable taskbar order, `stack` keeps stacking order (last = top) */
  const [wins, setWins] = useState<FloatWin[]>([]);
  const [stack, setStack] = useState<string[]>([]);
  const [focusedId, setFocusedId] = useState("");
  const [tabs, setTabs] = useState<Record<string, DetailTab>>({});
  const openCount = useRef(0);

  /* chrome */
  const [dialog, setDialog] = useState<ActiveDialog | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [flash, setFlash] = useState("");
  const [refCode, setRefCode] = useState(() => initialRefCode());
  const [time, setTime] = useState(() => clockLabel(new Date()));
  const flashTimer = useRef(0);
  const handledHash = useRef("");
  const { copyText, copiedTag, copyFallback, dismissFallback } = useClipboard({ onFlash: flashMsg });

  /* ---------- effects ---------- */

  useEffect(() => {
    if (!supabase || !auth.session?.user) {
      setStarred({});
      setRemixed({});
      setMyHandle("");
      setMyStorefront(undefined);
      setStorefrontHandle("");
      setStorefrontDisplayName("");
      setStorefrontBio("");
      setStorefrontStatus("");
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
  }, [auth.session]);

  useEffect(() => {
    if (!auth.accessToken) return;
    fetch(`${apiUrl}/me/storefront`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
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
  }, [auth.session]);

  useEffect(() => {
    const timer = window.setInterval(() => setTime(clockLabel(new Date())), 20_000);
    return () => window.clearInterval(timer);
  }, []);

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
        if (handledHash.current === canonical && wins.some((win) => win.id === `checkout:${checkoutKey}` && !win.minimized)) return;
        handledHash.current = canonical;
        openWin("checkout", checkoutKey);
        return;
      }
      const storefront = parseStorefrontHash(window.location.hash);
      if (storefront) {
        const canonical = `#/@${storefront.handle}`;
        if (handledHash.current === canonical && wins.some((win) => win.id === `storefront:${storefront.handle}` && !win.minimized)) return;
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
      if (handledHash.current === canonical && wins.some((win) => win.id === `harness:${key}` && !win.minimized)) return;
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
  }, [reg.allItems, reg.knownItems, wins]);

  /* ---------- helpers ---------- */

  function flashMsg(message: string) {
    setFlash(message);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(""), 2000);
  }

  function recordHarnessEvent(kind: "view" | "copy", item: RegistryItem, target: string) {
    void fetch(`${apiUrl}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {})
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

  function showDialog(spec: ActiveDialog) {
    setDialog(spec);
  }

  /* ---------- window manager ---------- */

  function raise(id: string) {
    setStack((current) => [...current.filter((entry) => entry !== id), id]);
    setFocusedId(id);
  }

  function focusWin(id: string) {
    setWins((current) => current.map((win) => (win.id === id ? { ...win, minimized: false } : win)));
    raise(id);
  }

  function openWin(kind: WinKind, hkey?: string) {
    const id = kind === "harness" ? `harness:${hkey}` : kind === "storefront" ? `storefront:${hkey}` : kind === "checkout" ? `checkout:${hkey}` : kind;
    openCount.current += 1;
    const step = openCount.current % 5;
    setWins((current) => {
      const existing = current.find((win) => win.id === id);
      if (existing) {
        return current.map((win) => (win.id === id ? { ...win, hkey: hkey ?? win.hkey, minimized: false } : win));
      }
      const width = WIN_WIDTHS[kind];
      const x = Math.max(8, Math.round((window.innerWidth - width) / 2) + step * 28 - 40);
      const y = 42 + step * 26;
      return [...current, { id, kind, hkey, x, y, minimized: false }];
    });
    raise(id);
  }

  function closeWin(id: string) {
    clearDeepLinkForClosedWindow(id);
    setWins((current) => current.filter((win) => win.id !== id));
    setStack((current) => current.filter((entry) => entry !== id));
    setFocusedId((current) => (current === id ? "" : current));
  }

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

  function minimizeWin(id: string) {
    setWins((current) => current.map((win) => (win.id === id ? { ...win, minimized: true } : win)));
    setFocusedId((current) => (current === id ? "" : current));
  }

  function moveWin(id: string, x: number, y: number) {
    setWins((current) => current.map((win) => (win.id === id ? { ...win, x, y } : win)));
  }

  /* ---------- data actions ---------- */

  function orgHeadersForOwner(owner: string): Record<string, string> {
    const slug = owner.startsWith("@") ? owner.slice(1) : "";
    if (!slug || slug !== networkOrg.replace(/^@/, "").trim().toLowerCase() || !networkToken) return {};
    return { Authorization: `Bearer ${networkToken}` };
  }

  function loadStorefront(handle: string) {
    if (storefronts[handle]) return;
    fetch(`${apiUrl}/storefront/${encodeURIComponent(handle)}`)
      .then((response) => response.json())
      .then((data: StorefrontPage) => {
        setStorefronts((current) => ({ ...current, [handle]: data }));
        reg.cacheItems(data.items ?? []);
      })
      .catch(() => undefined);
  }

  async function loadOrgWorkspace() {
    const slug = networkOrg.replace(/^@/, "").trim().toLowerCase();
    if (!slug) return;
    setNetworkBusy(true);
    setNetworkStatus("");
    try {
      const response = await fetch(`${apiUrl}/orgs/${encodeURIComponent(slug)}/workspace`, {
        headers: networkToken ? { Authorization: `Bearer ${networkToken}` } : {}
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
      const workspace = data as OrgWorkspace;
      setOrgWorkspace(workspace);
      setNetworkOrg(workspace.organization.slug);
      localStorage.setItem("hh:networkOrg", workspace.organization.slug);
      reg.cacheItems(workspace.items ?? []);
      setNetworkStatus(`Loaded ${workspace.items.length} private harnesses · ${workspace.audit.length} audit rows`);
    } catch (error) {
      setNetworkStatus(error instanceof Error ? error.message : "Org workspace failed");
    } finally {
      setNetworkBusy(false);
    }
  }

  function openHarness(item: RegistryItem, tab?: DetailTab) {
    const key = keyFor(item);
    reg.cacheItem(item);
    if (tab) setTabs((current) => ({ ...current, [key]: tab }));
    reg.loadDetail(item);
    setHarnessHash(item);
    openWin("harness", key);
  }

  function openResource(item: ResourceItem) {
    const openAction = item.actions?.find((action) => action.id === "open_mirror" && "url" in action)
      ?? item.actions?.find((action) => action.id === "open_upstream" && "url" in action);
    const url = openAction && "url" in openAction ? openAction.url : item.canonicalUrl;
    window.open(url, "_blank", "noopener,noreferrer");
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
    flashMsg(`Opened ${item.title}`);
  }

  function openStorefront(handle: string) {
    const clean = handle.replace(/^@/, "").toLowerCase();
    if (!clean) return;
    loadStorefront(clean);
    openWin("storefront", clean);
  }

  function openMyBriefcase() {
    if (!auth.user) {
      auth.openLogon("Log on to create your creator @handle.");
      return;
    }
    setStorefrontStatus("");
    openWin("profile");
  }

  async function saveMyStorefront() {
    if (!auth.accessToken) {
      openMyBriefcase();
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
          Authorization: `Bearer ${auth.accessToken}`
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
      flashMsg(`Saved @${profile.handle}`);
    } catch (error) {
      setStorefrontStatus(error instanceof Error ? error.message : "Storefront save failed");
    } finally {
      setStorefrontBusy(false);
    }
  }

  function openInstall(item?: RegistryItem) {
    const selected = item ?? reg.topItem;
    if (selected?.contentType === "directory" && selected.directory?.url) {
      window.open(selected.directory.url, "_blank", "noopener,noreferrer");
      recordHarnessEvent("view", selected, "directory-open");
      flashMsg(`Opened directory: ${selected.title}`);
      return;
    }
    if (selected) {
      const key = keyFor(selected);
      reg.cacheItem(selected);
      recordHarnessEvent("view", selected, "install-center");
      openWin("install", key);
      return;
    }
    openWin("install");
  }

  async function toggleStar(item: RegistryItem) {
    if (!auth.requireUser("Log on to star harnesses. Stars keep the heat honest.")) return;
    const key = keyFor(item);
    const next = !starred[key];
    setStarred((current) => ({ ...current, [key]: next }));
    flashMsg(next ? `★ Starred ${item.title} · heat +0.4` : `Unstarred ${item.title}`);
    if (!auth.accessToken) return;
    try {
      const response = await fetch(`${apiUrl}/repos/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.name)}/star`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.accessToken}`
        },
        body: JSON.stringify({ starred: next })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Star failed (${response.status})`);
      reg.bumpRefresh();
    } catch (error) {
      setStarred((current) => ({ ...current, [key]: !next }));
      flashMsg(error instanceof Error ? error.message : "Star failed");
    }
  }

  async function remixHarness(item: RegistryItem) {
    const recipe = remixRecipe(item);
    const key = keyFor(item);
    if (!auth.accessToken) {
      setRemixed((current) => ({ ...current, [key]: true }));
      void copyText(recipe, `Local remix recipe copied for ${item.title}`, `remix:${key}`);
      auth.openLogon("Log on to create a server-side local remix draft. A local recipe was copied.");
      return;
    }
    try {
      const response = await fetch(`${apiUrl}/repos/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.name)}/remixes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.accessToken}`
        },
        body: JSON.stringify({ name: `my-${item.name}` })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRemixed((current) => ({ ...current, [key]: true }));
        void copyText(recipe, `Local remix recipe copied for ${item.title}`, `remix:${key}`);
        const next = typeof data.next === "string" ? `\n\n${data.next}` : "";
        throw new Error(`${data.error ?? `Server-side remix failed (${response.status})`}${next}`);
      }
      const remixItem = data.item as RegistryItem | undefined;
      if (remixItem) {
        const remixKey = keyFor(remixItem);
        reg.prependItem(remixItem);
        setRemixed((current) => ({ ...current, [key]: true, [remixKey]: true }));
        reg.bumpRefresh();
        showDialog({
          title: "Local remix draft created",
          icon: "⑂",
          body: `${remixItem.title} is available as ${remixItem.owner}/${remixItem.name}.\n\nIt starts free and unverified; edit it, then run eval/gate before treating it as production-ready.`
        });
        openHarness(remixItem);
        return;
      }
      throw new Error("Server-side remix returned no registry item.");
    } catch (error) {
      showDialog({
        title: "Remix draft fallback",
        icon: "⑂",
        body: `${error instanceof Error ? error.message : "Server-side remix failed."}\n\nUse this local path instead:\n\n${recipe}`
      });
    }
  }

  async function runSample(item: RegistryItem) {
    if (item.contentType === "directory") {
      flashMsg("Directory entries are link-only; open the upstream index instead.");
      return;
    }
    const key = keyFor(item);
    setTryStates((current) => ({ ...current, [key]: "done" }));
    flashMsg("Preview only. Run hh eval or hh gate locally for execution evidence.");
  }

  async function addThreadPost(item: RegistryItem) {
    const key = keyFor(item);
    const draft = (drafts[key] ?? "").trim();
    if (!draft) return;
    if (!auth.requireUser("Log on to post in the thread.")) return;
    const kind = kinds[key] ?? "question";
    if (!auth.accessToken) return;
    try {
      const response = await fetch(`${apiUrl}/repos/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.name)}/thread`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.accessToken}`
        },
        body: JSON.stringify({ kind, body: draft })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Post failed (${response.status})`);
      const post = data.item as ThreadItem | undefined;
      if (!post?.id) throw new Error("Post failed: empty API response");
      setRemotePosts((current) => ({ ...current, [key]: [...(current[key] ?? []), post] }));
      setDrafts((current) => ({ ...current, [key]: "" }));
      reg.bumpRefresh();
    } catch (error) {
      flashMsg(error instanceof Error ? error.message : "Post failed");
    }
  }

  async function submitImport() {
    if (!auth.requireUser("Log on to publish a harness.")) return;
    setImportBusy(true);
    setImportStatus("");
    try {
      const response = await fetch(`${apiUrl}/imports/markdown-to-harness`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.accessToken}`
        },
        body: JSON.stringify({ name: importName, markdown: importMarkdown })
      });
      const result = await response.json();
      if (!response.ok) {
        setImportStatus(result.error ?? "Publish failed.");
        return;
      }
      closeWin("publish");
      reg.setQuery("");
      reg.setJobFilter("all");
      reg.bumpRefresh();
      const warnings = Array.isArray(result.warnings) && result.warnings.length ? `\n\n${result.warnings.join("\n")}` : "";
      const next = typeof result.next === "string" ? `\n\n${result.next}` : "";
      showDialog({ title: "Harness published", icon: "📦", body: `${result.item.title} is live on the frontier. Give it a star before someone else does.${warnings}${next}` });
    } catch {
      setImportStatus("Publish failed: the harness API is unreachable.");
    } finally {
      setImportBusy(false);
    }
  }

  /* ---------- auth (sign-in/up/out/requireUser live in core/useAuth) ---------- */

  function logOff() {
    showDialog({
      title: "Log Off OnlyHarness",
      icon: "🔑",
      body: `Log off ${auth.user?.email ?? ""}? Your stars stay saved.`,
      onOk: () => { void auth.signOut(); }
    });
  }

  /* ---------- canned dialogs ---------- */

  const cantClose = () => showDialog({ title: "OnlyHarness", icon: "⚠️", body: "You can't close the Wild West, partner. Your harness is still on the leaderboard." });
  const shutDown = () => showDialog({ title: "Shut Down OnlyHarness", icon: "🤠", body: "It's now safe to turn off your agent. But the harnesses keep getting warmer without you..." });
  const binDialog = () => showDialog({ title: "Remix Bin", icon: "🗑️", body: "The bin is empty. Log on to create server-side local remix drafts; copied recipes stay as the fallback path." });
  const aboutDialog = () => showDialog({ title: "About OnlyHarness 98", icon: "🧷", body: "The community hub for reusable agent harnesses: discover, install, remix, eval, improve. Lovingly wrapped in Windows 98 chrome, MS Paint colours and WordArt. No harnesses were harmed." });

  /* ---------- taskbar ---------- */

  function winMeta(win: FloatWin): { icon: string; title: string } {
    const checkout = win.kind === "checkout" && win.hkey ? checkoutLinks[win.hkey] : undefined;
    const item = checkout ? reg.knownItems[`${checkout.owner}/${checkout.repo}`] : win.hkey ? reg.knownItems[win.hkey] : undefined;
    switch (win.kind) {
      case "harness": return { icon: "📦", title: item?.title ?? "Harness" };
      case "publish": return { icon: "📄", title: "New Harness Wizard" };
      case "install": return { icon: "💿", title: item ? `Install Center — ${item.title}` : "Install Center" };
      case "checkout": return { icon: "💳", title: checkout ? `Manual Checkout — ${checkout.owner}/${checkout.repo}` : "Manual Checkout" };
      case "cli": return { icon: "🖥️", title: "MS-DOS Prompt — hh.exe" };
      case "review": return { icon: "🔧", title: "Maintainer Review Preview" };
      case "leaderboard": return { icon: "🏆", title: "Wild West Top 10" };
      case "share": return { icon: "💾", title: `harness_flex.exe — ${item?.title ?? ""}` };
      case "storefront": return { icon: "🗂️", title: `@${win.hkey ?? "handle"} — My Briefcase` };
      case "profile": return { icon: "🗂️", title: "My Briefcase — Creator Profile" };
      case "network": return { icon: "🌐", title: "Network Neighborhood" };
    }
  }

  const taskEntries: TaskEntry[] = [
    {
      id: "explore",
      icon: "🌐",
      title: "OnlyHarness — Explore",
      active: focusedId === "",
      onClick: () => {
        setFocusedId("");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    ...wins.map((win) => {
      const meta = winMeta(win);
      return {
        id: win.id,
        icon: meta.icon,
        title: meta.title,
        active: focusedId === win.id && !win.minimized,
        onClick: () => {
          if (win.minimized || focusedId !== win.id) focusWin(win.id);
          else minimizeWin(win.id);
        }
      };
    })
  ];

  const startEntries: StartEntry[] = [
    { icon: "🧭", label: "Explore", onClick: () => { setFocusedId(""); window.scrollTo({ top: 0, behavior: "smooth" }); } },
    { icon: "🏆", label: "Leaderboard", onClick: () => openWin("leaderboard") },
    { icon: "🌐", label: "Network Neighborhood", onClick: () => openWin("network") },
    { icon: "💿", label: "Install Center", onClick: () => openInstall(reg.topItem) },
    { icon: "🗂️", label: myHandle ? `My Briefcase (@${myHandle})` : "My Briefcase...", onClick: openMyBriefcase },
    { icon: "📄", label: "New harness...", onClick: () => openWin("publish") },
    { icon: "🖥️", label: "MS-DOS Prompt", onClick: () => openWin("cli", reg.topItem ? keyFor(reg.topItem) : undefined) },
    { icon: "🔧", label: "Maintainer Review", onClick: () => openReview() },
    "sep",
    auth.user
      ? { icon: "🔑", label: `Log Off ${auth.user.email?.split("@")[0] ?? ""}...`, onClick: logOff }
      : { icon: "🔑", label: "Log On...", onClick: () => auth.openLogon() },
    "sep",
    { icon: "⏻", label: "Shut Down...", onClick: shutDown }
  ];

  function openReview() {
    const item = reg.topItem;
    if (item) reg.loadDetail(item);
    openWin("review", item ? keyFor(item) : undefined);
  }

  /* ---------- window bodies ---------- */

  function renderWinBody(win: FloatWin) {
    const checkout = win.kind === "checkout" && win.hkey ? checkoutLinks[win.hkey] : undefined;
    const item = checkout ? reg.knownItems[`${checkout.owner}/${checkout.repo}`] : win.hkey ? reg.knownItems[win.hkey] : reg.topItem;
    switch (win.kind) {
      case "harness": {
        if (!item) return <div className="win-body plate">This harness rode off into the sunset.</div>;
        const key = keyFor(item);
        const detail = reg.details[key];
        const thread = [
          ...(detail?.thread ?? []),
          ...(remotePosts[key] ?? []).map((post) =>
            post.userId && post.userId === auth.user?.id ? { ...post, author: "you" } : post
          )
        ];
        return (
          <DetailBody
            item={item}
            detail={detail}
            tab={tabs[key] ?? "Overview"}
            setTab={(tab) => setTabs((current) => ({ ...current, [key]: tab }))}
            starred={Boolean(starred[key])}
            remixed={Boolean(remixed[key])}
            thread={thread}
            draft={drafts[key] ?? ""}
            setDraft={(value) => setDrafts((current) => ({ ...current, [key]: value }))}
            kind={kinds[key] ?? "question"}
            setKind={(value) => setKinds((current) => ({ ...current, [key]: value }))}
            onPost={() => addThreadPost(item)}
            tryState={tryStates[key] ?? "idle"}
            onRunSample={() => runSample(item)}
            onStar={() => toggleStar(item)}
            onFork={() => remixHarness(item)}
            onCopyCli={() => {
              recordHarnessEvent("copy", item, "cli");
              void copyText(item.cliCommand, `Copied: ${item.cliCommand}`, `cli:${key}`);
            }}
            onInstall={() => openInstall(item)}
            onShare={() => openWin("share", key)}
            copied={copiedTag === `cli:${key}`}
          />
        );
      }
      case "publish":
        return (
          <PublishBody
            name={importName}
            setName={setImportName}
            markdown={importMarkdown}
            setMarkdown={setImportMarkdown}
            status={importStatus}
            busy={importBusy}
            loggedIn={Boolean(auth.user)}
            onSubmit={submitImport}
            onLogon={() => auth.openLogon("Log on to publish a harness.")}
          />
        );
      case "install":
        return (
          <InstallBody
            item={item}
            detail={item ? reg.details[keyFor(item)] : undefined}
            apiUrl={apiUrl}
            accessToken={auth.accessToken}
            refCode={refCode}
            onLogon={() => auth.openLogon("Log on to create a checkout session.")}
            onCopy={(text, target) => {
              if (item) recordHarnessEvent("copy", item, target);
              void copyText(text, "Install commands copied", "install");
            }}
            copied={copiedTag === "install"}
          />
        );
      case "checkout":
        return (
          <CheckoutBody
            checkout={checkout}
            item={item}
            detail={item ? reg.details[keyFor(item)] : undefined}
            apiUrl={apiUrl}
            refCode={checkout?.ref ?? refCode}
            onOpenInstall={() => openInstall(item)}
            onCopy={(text) => copyText(text, "Checkout retry command copied", "checkout")}
            copied={copiedTag === "checkout"}
          />
        );
      case "cli":
        return <CliBody item={item} onCopy={(text) => {
          if (item) recordHarnessEvent("copy", item, "cli");
          void copyText(text, "CLI commands copied", "cliwin");
        }} copied={copiedTag === "cliwin"} />;
      case "review":
        return <ReviewBody item={item} detail={item ? reg.details[keyFor(item)] : undefined} onCopy={(text) => copyText(text, "Gate commands copied", "gate")} copied={copiedTag === "gate"} />;
      case "leaderboard":
        return <LeaderboardBody items={reg.leaderboard} onOpen={(entry) => openHarness(entry)} />;
      case "share":
        return item
          ? <ShareBody item={item} starred={Boolean(starred[keyFor(item)])} refCode={refCode} onCopy={(text) => copyText(text, "Share text copied", "brag")} copied={copiedTag === "brag"} />
          : <div className="win-body plate">Nothing to brag about yet.</div>;
      case "storefront": {
        const handle = win.hkey ?? "";
        return <StorefrontBody page={storefronts[handle]} handle={handle} referrer={refCode} onOpen={(entry) => openHarness(entry)} onCopy={(text) => copyText(text, "Ref-link copied", `storefront:${handle}`)} copied={copiedTag === `storefront:${handle}`} />;
      }
      case "profile":
        return (
          <StorefrontEditorBody
            loggedIn={Boolean(auth.user)}
            profile={myStorefront}
            handle={storefrontHandle}
            setHandle={setStorefrontHandle}
            displayName={storefrontDisplayName}
            setDisplayName={setStorefrontDisplayName}
            bio={storefrontBio}
            setBio={setStorefrontBio}
            status={storefrontStatus}
            busy={storefrontBusy}
            onSave={saveMyStorefront}
            onOpenPublic={() => myStorefront && openStorefront(myStorefront.handle)}
            onLogon={() => auth.openLogon("Log on to create your creator @handle.")}
          />
        );
      case "network":
        return (
          <NetworkBody
            orgSlug={networkOrg}
            setOrgSlug={setNetworkOrg}
            orgToken={networkToken}
            setOrgToken={setNetworkToken}
            workspace={orgWorkspace}
            status={networkStatus}
            busy={networkBusy}
            onLoad={loadOrgWorkspace}
            onOpen={(entry) => openHarness(entry)}
          />
        );
    }
  }

  /* ---------- render ---------- */

  return (
    <div className="desktop">
      <DesktopIcons
        onMyHarnesses={() => {
          reg.setResourceTab("All");
          reg.setJobFilter("all");
          document.getElementById("trending")?.scrollIntoView({ behavior: "smooth" });
        }}
        onNetwork={() => openWin("network")}
        onBin={binDialog}
      />
      <AwardWindow leader={reg.leader} />

      <div onPointerDownCapture={() => setFocusedId("")}>
        <ExploreWindow
          items={reg.items}
          resources={reg.visibleResources}
          resourceCounts={reg.resourceCounts}
          resourceTab={reg.resourceTab}
          setResourceTab={reg.setResourceTab}
          jobs={reg.jobs}
          jobFilter={reg.jobFilter}
          setJobFilter={reg.setJobFilter}
          query={reg.query}
          setQuery={reg.setQuery}
          sort={reg.sort}
          setSort={reg.setSort}
          starred={starred}
          remixed={remixed}
          session={auth.session}
          totals={reg.totals}
          leader={reg.leader}
          flash={flash}
          active={focusedId === ""}
          actions={{
            openHarness,
            openResource,
            openInstall,
            star: toggleStar,
            remix: remixHarness,
            share: (item) => openWin("share", keyFor(item)),
            openPublish: () => openWin("publish"),
            openCli: () => openWin("cli", reg.topItem ? keyFor(reg.topItem) : undefined),
            openReview,
            openLeaderboard: () => openWin("leaderboard"),
            openProfile: openMyBriefcase,
            openLogon: () => auth.openLogon(),
            logOff,
            cantClose,
            about: aboutDialog,
            copyClaudePluginInstall: () => copyText(CLAUDE_PLUGIN_INSTALL_COMMAND, "Claude Code plugin install copied", "agent-install:claude"),
            copyCodexMcpInstall: () => copyText(CODEX_MCP_INSTALL_COMMAND, "Codex MCP install copied", "agent-install:codex"),
            copyText: (text, label) => copyText(text, label),
            refresh: () => {
              reg.refresh();
              setRemotePosts({});
              flashMsg("Registry refreshed");
            }
          }}
        />
      </div>

      {wins.map((win) => {
        const meta = winMeta(win);
        return (
          <FloatWindow
            key={win.id}
            win={win}
            zIndex={30 + Math.max(0, stack.indexOf(win.id))}
            width={WIN_WIDTHS[win.kind]}
            icon={meta.icon}
            title={meta.title}
            active={focusedId === win.id}
            maroon={win.kind === "leaderboard"}
            onFocus={() => { if (focusedId !== win.id) focusWin(win.id); }}
            onClose={() => closeWin(win.id)}
            onMinimize={() => minimizeWin(win.id)}
            onMove={(x, y) => moveWin(win.id, x, y)}
          >
            {renderWinBody(win)}
          </FloatWindow>
        );
      })}

      <PaintWindow items={reg.leaderboard} />
      <Mascot onYes={() => openWin("publish")} />

      {startOpen && <StartMenu items={startEntries} onClose={() => setStartOpen(false)} />}

      <Taskbar
        tasks={taskEntries}
        startOpen={startOpen}
        onStart={() => setStartOpen((open) => !open)}
        time={time}
        onTrayFire={() => openWin("leaderboard")}
      />

      {auth.logon.open && (
        <LogonDialog
          note={auth.logon.note}
          status={auth.authStatus}
          busy={auth.authBusy}
          configured={auth.configured}
          onSignIn={auth.signIn}
          onSignUp={auth.signUp}
          onResendConfirmation={auth.resendConfirmation}
          onClose={auth.closeLogon}
        />
      )}

      {dialog && (
        <Dialog
          title={dialog.title}
          icon={dialog.icon}
          body={dialog.body}
          onClose={() => setDialog(null)}
          actions={
            dialog.onOk ? (
              <>
                <Btn strong onClick={() => { dialog.onOk?.(); setDialog(null); }}>OK</Btn>
                <Btn onClick={() => setDialog(null)}>Cancel</Btn>
              </>
            ) : undefined
          }
        />
      )}

      {copyFallback && (
        <Dialog
          title="Copy Text"
          onClose={dismissFallback}
          actions={<Btn strong onClick={dismissFallback}>OK</Btn>}
        >
          <div className="dialog-body copy-fallback">
            <span className="di">📋</span>
            <div className="copy-fallback-body">
              <span>{copyFallback.label}</span>
              <textarea
                className="copy-fallback-text"
                readOnly
                value={copyFallback.text}
                onFocus={(event) => event.currentTarget.select()}
                autoFocus
              />
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

type HarnessWindow = Window & { __harnessHub98Root?: Root };

const container = document.getElementById("root")!;
const root = (window as HarnessWindow).__harnessHub98Root ?? createRoot(container);
(window as HarnessWindow).__harnessHub98Root = root;
root.render(<App />);

