import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { apiUrl, CLAUDE_PLUGIN_INSTALL_COMMAND, CODEX_MCP_INSTALL_COMMAND, JOB_FILTERS, remixRecipe } from "./core/constants";
import { supabase } from "./core/supabase";
import { clockLabel, keyFor } from "./core/format";
import type { CheckoutLinkState, DetailTab, DialogSpec, FloatWin, HarnessDetail, OrgWorkspace, RegistryItem, ResourceItem, StorefrontPage, StorefrontProfile, ThreadItem, WinKind } from "./core/types";
import { AwardWindow, DesktopIcons, LogonDialog, Mascot, PaintWindow, StartMenu, Taskbar, type StartEntry, type TaskEntry } from "./desktop";
import { DetailBody } from "./detail";
import { ExploreWindow, type ResourceTab } from "./explore";
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
  /* registry data */
  const [allItems, setAllItems] = useState<RegistryItem[]>([]);
  const [resourceItems, setResourceItems] = useState<ResourceItem[]>([]);
  const [resourceCounts, setResourceCounts] = useState({ externalSeed: 0, internal: 0, total: 0 });
  const [resourceTab, setResourceTab] = useState<ResourceTab>("All");
  const [leaderboard, setLeaderboard] = useState<RegistryItem[]>([]);
  const [details, setDetails] = useState<Record<string, HarnessDetail>>({});
  const [knownItems, setKnownItems] = useState<Record<string, RegistryItem>>({});
  const [storefronts, setStorefronts] = useState<Record<string, StorefrontPage>>({});
  const [checkoutLinks, setCheckoutLinks] = useState<Record<string, CheckoutLinkState>>({});
  const [query, setQuery] = useState("");
  const [jobFilter, setJobFilter] = useState("all");
  const [sort, setSort] = useState("trending");
  const [refreshTick, setRefreshTick] = useState(0);

  /* social state */
  const [starred, setStarred] = useState<Record<string, boolean>>({});
  const [remixed, setRemixed] = useState<Record<string, boolean>>({});
  const [remotePosts, setRemotePosts] = useState<Record<string, ThreadItem[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [kinds, setKinds] = useState<Record<string, string>>({});
  const [tryStates, setTryStates] = useState<Record<string, "idle" | "running" | "done">>({});

  /* auth */
  const [session, setSession] = useState<Session | null>(null);
  const [logon, setLogon] = useState<{ open: boolean; note: string }>({ open: false, note: "" });
  const [authStatus, setAuthStatus] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
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
  const [copyFallback, setCopyFallback] = useState<{ label: string; text: string } | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [flash, setFlash] = useState("");
  const [copiedTag, setCopiedTag] = useState("");
  const [refCode, setRefCode] = useState(() => initialRefCode());
  const [time, setTime] = useState(() => clockLabel(new Date()));
  const flashTimer = useRef(0);
  const copiedTimer = useRef(0);
  const handledHash = useRef("");

  /* ---------- effects ---------- */

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("sort", sort);
    fetch(`${apiUrl}/registry?${params.toString()}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => {
        const items: RegistryItem[] = data.items ?? [];
        setAllItems(items);
        setKnownItems((current) => {
          const next = { ...current };
          for (const item of items) next[keyFor(item)] = item;
          return next;
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setAllItems([]);
      });
    return () => controller.abort();
  }, [query, sort, refreshTick]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("sort", sort === "stars" ? "github-stars" : sort === "new" ? "new" : "popular");
    params.set("limit", "80");
    fetch(`${apiUrl}/resources?${params.toString()}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => {
        setResourceItems(data.resources ?? data.items ?? []);
        setResourceCounts(data.counts ?? { externalSeed: 0, internal: 0, total: 0 });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResourceItems([]);
          setResourceCounts({ externalSeed: 0, internal: 0, total: 0 });
        }
      });
    return () => controller.abort();
  }, [query, sort, refreshTick]);

  useEffect(() => {
    fetch(`${apiUrl}/leaderboard?limit=10`)
      .then((response) => response.json())
      .then((data) => setLeaderboard(data.items ?? []))
      .catch(() => setLeaderboard([]));
  }, [refreshTick]);

  useEffect(() => {
    if (!supabase || !session?.user) {
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
  }, [session]);

  useEffect(() => {
    if (!session?.access_token) return;
    fetch(`${apiUrl}/me/storefront`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
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

  useEffect(() => {
    const timer = window.setInterval(() => setTime(clockLabel(new Date())), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function openFromHash() {
      const ref = refFromLocation();
      if (ref) {
        setRefCode((current) => current === ref ? current : ref);
        localStorage.setItem("onlyharness.ref", ref);
      }
      const checkout = parseCheckoutLocation();
      if (checkout) {
        const checkoutKey = keyForCheckout(checkout);
        const harnessKey = `${checkout.owner}/${checkout.repo}`;
        const item = knownItems[harnessKey] ?? allItems.find((entry) => entry.owner === checkout.owner && entry.name === checkout.repo);
        setCheckoutLinks((current) => ({ ...current, [checkoutKey]: checkout }));
        if (item) {
          setKnownItems((current) => (current[harnessKey] ? current : { ...current, [harnessKey]: item }));
          loadDetail(item);
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
      const item = knownItems[key] ?? allItems.find((entry) => entry.owner === parsed.owner && entry.name === parsed.name);
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
  }, [allItems, knownItems, wins]);

  /* ---------- derived ---------- */

  const items = useMemo(() => {
    if (jobFilter === "all") return allItems;
    if (jobFilter === "starred") return allItems.filter((item) => starred[keyFor(item)]);
    return allItems.filter((item) => item.job === jobFilter || item.outcome === jobFilter);
  }, [allItems, jobFilter, starred]);

  const visibleResources = useMemo(() => {
    const typeByTab: Partial<Record<ResourceTab, ResourceItem["resourceType"][]>> = {
      Skills: ["skill", "subagent_pack", "agent_team"],
      Plugins: ["plugin", "command_pack", "config"],
      Workflows: ["workflow"],
      MCP: ["mcp_server"],
      Runtimes: ["agent_runtime", "framework"],
      Guides: ["guide", "directory"]
    };
    const types = typeByTab[resourceTab];
    if (!types) return resourceItems;
    return resourceItems.filter((resource) => types.includes(resource.resourceType));
  }, [resourceItems, resourceTab]);

  const jobs = useMemo(() => {
    const counts = JOB_FILTERS.map((label) => ({ label, count: allItems.filter((item) => item.job === label || item.outcome === label).length }));
    return [...counts, { label: "starred", count: allItems.filter((item) => starred[keyFor(item)]).length }];
  }, [allItems, starred]);

  const totals = useMemo(() => ({
    stars: allItems.reduce((sum, item) => sum + item.stars + (starred[keyFor(item)] ? 1 : 0), 0),
    forks: allItems.reduce((sum, item) => sum + item.forks, 0),
    threads: allItems.reduce((sum, item) => sum + item.threads, 0),
    indexed: allItems.length
  }), [allItems, starred]);

  const leader = leaderboard[0];
  const topItem = items[0] ?? allItems[0] ?? leader;

  /* ---------- helpers ---------- */

  function flashMsg(message: string) {
    setFlash(message);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(""), 2000);
  }

  function markCopied(tag: string) {
    setCopiedTag(tag);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopiedTag(""), 1600);
  }

  async function copyText(text: string, label: string, tag = "") {
    try {
      await writeClipboard(text);
      flashMsg(label);
      if (tag) markCopied(tag);
    } catch {
      setCopyFallback({ label, text });
      flashMsg("Clipboard unavailable — command shown");
    }
  }

  async function writeClipboard(text: string) {
    if (copyWithSelection(text)) return;
    await navigator.clipboard.writeText(text);
  }

  function copyWithSelection(text: string) {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.left = "-9999px";
    field.style.top = "0";
    document.body.appendChild(field);
    field.focus();
    field.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      document.body.removeChild(field);
    }
  }

  function recordHarnessEvent(kind: "view" | "copy", item: RegistryItem, target: string) {
    void fetch(`${apiUrl}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
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

  function requireUser(note: string) {
    if (session?.user) return true;
    setAuthStatus("");
    setLogon({ open: true, note });
    return false;
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
    const checkout = parseCheckoutLocation();
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

  function loadDetail(item: RegistryItem) {
    const key = keyFor(item);
    if (!details[key]) {
      fetch(`${apiUrl}/repos/${item.owner}/${item.name}/harness`, { headers: orgHeadersForOwner(item.owner) })
        .then((response) => response.json())
        .then((data) => setDetails((current) => ({ ...current, [key]: data })))
        .catch(() => undefined);
    }
  }

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
        setKnownItems((current) => {
          const next = { ...current };
          for (const item of data.items ?? []) next[keyFor(item)] = item;
          return next;
        });
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
      setKnownItems((current) => {
        const next = { ...current };
        for (const item of workspace.items ?? []) next[keyFor(item)] = item;
        return next;
      });
      setNetworkStatus(`Loaded ${workspace.items.length} private harnesses · ${workspace.audit.length} audit rows`);
    } catch (error) {
      setNetworkStatus(error instanceof Error ? error.message : "Org workspace failed");
    } finally {
      setNetworkBusy(false);
    }
  }

  function openHarness(item: RegistryItem, tab?: DetailTab) {
    const key = keyFor(item);
    setKnownItems((current) => (current[key] ? current : { ...current, [key]: item }));
    if (tab) setTabs((current) => ({ ...current, [key]: tab }));
    loadDetail(item);
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
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
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
    if (!session?.user) {
      setAuthStatus("");
      setLogon({ open: true, note: "Log on to create your creator @handle." });
      return;
    }
    setStorefrontStatus("");
    openWin("profile");
  }

  async function saveMyStorefront() {
    if (!session?.access_token) {
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
          Authorization: `Bearer ${session.access_token}`
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
    const selected = item ?? topItem;
    if (selected?.contentType === "directory" && selected.directory?.url) {
      window.open(selected.directory.url, "_blank", "noopener,noreferrer");
      recordHarnessEvent("view", selected, "directory-open");
      flashMsg(`Opened directory: ${selected.title}`);
      return;
    }
    if (selected) {
      const key = keyFor(selected);
      setKnownItems((current) => (current[key] ? current : { ...current, [key]: selected }));
      recordHarnessEvent("view", selected, "install-center");
      openWin("install", key);
      return;
    }
    openWin("install");
  }

  async function toggleStar(item: RegistryItem) {
    if (!requireUser("Log on to star harnesses. Stars keep the heat honest.")) return;
    const key = keyFor(item);
    const next = !starred[key];
    setStarred((current) => ({ ...current, [key]: next }));
    flashMsg(next ? `★ Starred ${item.title} · heat +0.4` : `Unstarred ${item.title}`);
    if (!session?.access_token) return;
    try {
      const response = await fetch(`${apiUrl}/repos/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.name)}/star`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ starred: next })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Star failed (${response.status})`);
      setRefreshTick((tick) => tick + 1);
    } catch (error) {
      setStarred((current) => ({ ...current, [key]: !next }));
      flashMsg(error instanceof Error ? error.message : "Star failed");
    }
  }

  async function remixHarness(item: RegistryItem) {
    const recipe = remixRecipe(item);
    const key = keyFor(item);
    if (!session?.access_token) {
      setRemixed((current) => ({ ...current, [key]: true }));
      void copyText(recipe, `Local remix recipe copied for ${item.title}`, `remix:${key}`);
      setLogon({ open: true, note: "Log on to create a server-side local remix draft. A local recipe was copied." });
      return;
    }
    try {
      const response = await fetch(`${apiUrl}/repos/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.name)}/remixes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
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
        setKnownItems((current) => ({ ...current, [remixKey]: remixItem }));
        setAllItems((current) => [remixItem, ...current.filter((entry) => keyFor(entry) !== remixKey)]);
        setRemixed((current) => ({ ...current, [key]: true, [remixKey]: true }));
        setRefreshTick((tick) => tick + 1);
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
    if (!requireUser("Log on to post in the thread.")) return;
    const kind = kinds[key] ?? "question";
    if (!session?.access_token) return;
    try {
      const response = await fetch(`${apiUrl}/repos/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.name)}/thread`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ kind, body: draft })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Post failed (${response.status})`);
      const post = data.item as ThreadItem | undefined;
      if (!post?.id) throw new Error("Post failed: empty API response");
      setRemotePosts((current) => ({ ...current, [key]: [...(current[key] ?? []), post] }));
      setDrafts((current) => ({ ...current, [key]: "" }));
      setRefreshTick((tick) => tick + 1);
    } catch (error) {
      flashMsg(error instanceof Error ? error.message : "Post failed");
    }
  }

  async function submitImport() {
    if (!requireUser("Log on to publish a harness.")) return;
    setImportBusy(true);
    setImportStatus("");
    try {
      const response = await fetch(`${apiUrl}/imports/markdown-to-harness`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({ name: importName, markdown: importMarkdown })
      });
      const result = await response.json();
      if (!response.ok) {
        setImportStatus(result.error ?? "Publish failed.");
        return;
      }
      closeWin("publish");
      setQuery("");
      setJobFilter("all");
      setRefreshTick((tick) => tick + 1);
      const warnings = Array.isArray(result.warnings) && result.warnings.length ? `\n\n${result.warnings.join("\n")}` : "";
      const next = typeof result.next === "string" ? `\n\n${result.next}` : "";
      showDialog({ title: "Harness published", icon: "📦", body: `${result.item.title} is live on the frontier. Give it a star before someone else does.${warnings}${next}` });
    } catch {
      setImportStatus("Publish failed: the harness API is unreachable.");
    } finally {
      setImportBusy(false);
    }
  }

  /* ---------- auth ---------- */

  async function signIn(email: string, password: string) {
    if (!supabase) return setAuthStatus("Auth backend is not configured.");
    if (!email || !password) return setAuthStatus("Email and password are required.");
    setAuthBusy(true);
    setAuthStatus("Logging on...");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setAuthBusy(false);
    if (error) return setAuthStatus(error.message);
    setLogon({ open: false, note: "" });
    flashMsg(`Logged on as ${email}`);
  }

  async function resendConfirmation(email: string) {
    if (!supabase) return setAuthStatus("Auth backend is not configured.");
    if (!email) return setAuthStatus("Email is required.");
    setAuthBusy(true);
    setAuthStatus("Sending confirmation email...");
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: window.location.origin }
    });
    setAuthBusy(false);
    if (error) return setAuthStatus(error.message);
    setAuthStatus("Confirmation email sent. Check your inbox, then log on.");
  }

  async function signUp(name: string, email: string, password: string) {
    if (!supabase) return setAuthStatus("Auth backend is not configured.");
    if (!email || !password) return setAuthStatus("Email and password are required.");
    setAuthBusy(true);
    setAuthStatus("Creating account...");
    const { error, data } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name || email.split("@")[0] },
        emailRedirectTo: window.location.origin
      }
    });
    setAuthBusy(false);
    if (error) return setAuthStatus(error.message);
    if (data.session) {
      setLogon({ open: false, note: "" });
      flashMsg(`Welcome to the frontier, ${name || email}`);
    } else {
      setAuthStatus("Account created. Check your email to confirm, then log on.");
    }
  }

  function logOff() {
    showDialog({
      title: "Log Off OnlyHarness",
      icon: "🔑",
      body: `Log off ${session?.user.email ?? ""}? Your stars stay saved.`,
      onOk: async () => {
        await supabase?.auth.signOut();
        setSession(null);
        flashMsg("Logged off");
      }
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
    const item = checkout ? knownItems[`${checkout.owner}/${checkout.repo}`] : win.hkey ? knownItems[win.hkey] : undefined;
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
    { icon: "💿", label: "Install Center", onClick: () => openInstall(topItem) },
    { icon: "🗂️", label: myHandle ? `My Briefcase (@${myHandle})` : "My Briefcase...", onClick: openMyBriefcase },
    { icon: "📄", label: "New harness...", onClick: () => openWin("publish") },
    { icon: "🖥️", label: "MS-DOS Prompt", onClick: () => openWin("cli", topItem ? keyFor(topItem) : undefined) },
    { icon: "🔧", label: "Maintainer Review", onClick: () => openReview() },
    "sep",
    session?.user
      ? { icon: "🔑", label: `Log Off ${session.user.email?.split("@")[0] ?? ""}...`, onClick: logOff }
      : { icon: "🔑", label: "Log On...", onClick: () => { setAuthStatus(""); setLogon({ open: true, note: "" }); } },
    "sep",
    { icon: "⏻", label: "Shut Down...", onClick: shutDown }
  ];

  function openReview() {
    const item = topItem;
    if (item) loadDetail(item);
    openWin("review", item ? keyFor(item) : undefined);
  }

  /* ---------- window bodies ---------- */

  function renderWinBody(win: FloatWin) {
    const checkout = win.kind === "checkout" && win.hkey ? checkoutLinks[win.hkey] : undefined;
    const item = checkout ? knownItems[`${checkout.owner}/${checkout.repo}`] : win.hkey ? knownItems[win.hkey] : topItem;
    switch (win.kind) {
      case "harness": {
        if (!item) return <div className="win-body plate">This harness rode off into the sunset.</div>;
        const key = keyFor(item);
        const detail = details[key];
        const thread = [
          ...(detail?.thread ?? []),
          ...(remotePosts[key] ?? []).map((post) =>
            post.userId && post.userId === session?.user.id ? { ...post, author: "you" } : post
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
            loggedIn={Boolean(session?.user)}
            onSubmit={submitImport}
            onLogon={() => { setAuthStatus(""); setLogon({ open: true, note: "Log on to publish a harness." }); }}
          />
        );
      case "install":
        return (
          <InstallBody
            item={item}
            detail={item ? details[keyFor(item)] : undefined}
            apiUrl={apiUrl}
            accessToken={session?.access_token}
            refCode={refCode}
            onLogon={() => { setAuthStatus(""); setLogon({ open: true, note: "Log on to create a checkout session." }); }}
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
            detail={item ? details[keyFor(item)] : undefined}
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
        return <ReviewBody item={item} detail={item ? details[keyFor(item)] : undefined} onCopy={(text) => copyText(text, "Gate commands copied", "gate")} copied={copiedTag === "gate"} />;
      case "leaderboard":
        return <LeaderboardBody items={leaderboard} onOpen={(entry) => openHarness(entry)} />;
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
            loggedIn={Boolean(session?.user)}
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
            onLogon={() => { setAuthStatus(""); setLogon({ open: true, note: "Log on to create your creator @handle." }); }}
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
          setResourceTab("All");
          setJobFilter("all");
          document.getElementById("trending")?.scrollIntoView({ behavior: "smooth" });
        }}
        onNetwork={() => openWin("network")}
        onBin={binDialog}
      />
      <AwardWindow leader={leader} />

      <div onPointerDownCapture={() => setFocusedId("")}>
        <ExploreWindow
          items={items}
          resources={visibleResources}
          resourceCounts={resourceCounts}
          resourceTab={resourceTab}
          setResourceTab={setResourceTab}
          jobs={jobs}
          jobFilter={jobFilter}
          setJobFilter={setJobFilter}
          query={query}
          setQuery={setQuery}
          sort={sort}
          setSort={setSort}
          starred={starred}
          remixed={remixed}
          session={session}
          totals={totals}
          leader={leader}
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
            openCli: () => openWin("cli", topItem ? keyFor(topItem) : undefined),
            openReview,
            openLeaderboard: () => openWin("leaderboard"),
            openProfile: openMyBriefcase,
            openLogon: () => { setAuthStatus(""); setLogon({ open: true, note: "" }); },
            logOff,
            cantClose,
            about: aboutDialog,
            copyClaudePluginInstall: () => copyText(CLAUDE_PLUGIN_INSTALL_COMMAND, "Claude Code plugin install copied", "agent-install:claude"),
            copyCodexMcpInstall: () => copyText(CODEX_MCP_INSTALL_COMMAND, "Codex MCP install copied", "agent-install:codex"),
            copyText: (text, label) => copyText(text, label),
            refresh: () => {
              setDetails({});
              setRemotePosts({});
              setRefreshTick((tick) => tick + 1);
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

      <PaintWindow items={leaderboard} />
      <Mascot onYes={() => openWin("publish")} />

      {startOpen && <StartMenu items={startEntries} onClose={() => setStartOpen(false)} />}

      <Taskbar
        tasks={taskEntries}
        startOpen={startOpen}
        onStart={() => setStartOpen((open) => !open)}
        time={time}
        onTrayFire={() => openWin("leaderboard")}
      />

      {logon.open && (
        <LogonDialog
          note={logon.note}
          status={authStatus}
          busy={authBusy}
          configured={Boolean(supabase)}
          onSignIn={signIn}
          onSignUp={signUp}
          onResendConfirmation={resendConfirmation}
          onClose={() => setLogon({ open: false, note: "" })}
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
          onClose={() => setCopyFallback(null)}
          actions={<Btn strong onClick={() => setCopyFallback(null)}>OK</Btn>}
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

function parseHarnessHash(hash: string): { owner: string; name: string } | undefined {
  const match = hash.match(/^#\/h\/([^/]+)\/([^/?#]+)(?:\?.*)?$/);
  if (!match) return undefined;
  return {
    owner: decodeURIComponent(match[1]),
    name: decodeURIComponent(match[2])
  };
}

function parseStorefrontHash(hash: string): { handle: string } | undefined {
  const match = hash.match(/^#\/@([^/?#]+)(?:\?.*)?$/);
  if (!match) return undefined;
  return { handle: decodeURIComponent(match[1]).replace(/^@/, "").toLowerCase() };
}

function parseCheckoutLocation(): CheckoutLinkState | undefined {
  if (window.location.pathname.replace(/\/+$/, "") !== "/checkout") return undefined;
  const params = new URLSearchParams(window.location.search);
  const owner = params.get("owner")?.trim();
  const repo = params.get("repo")?.trim();
  if (!owner || !repo) return undefined;
  return {
    owner,
    repo,
    version: params.get("version")?.trim() || "latest",
    providerRef: params.get("provider_ref")?.trim() || undefined,
    ref: params.get("ref")?.trim() || undefined
  };
}

function keyForCheckout(checkout: CheckoutLinkState): string {
  return [
    encodeURIComponent(checkout.owner),
    encodeURIComponent(checkout.repo),
    encodeURIComponent(checkout.providerRef || checkout.version || "latest")
  ].join("/");
}

function setHarnessHash(item: RegistryItem) {
  const next = `#/h/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.name)}`;
  if (window.location.hash === next) return;
  window.history.replaceState(null, "", next);
}

function initialRefCode(): string {
  return refFromLocation() ?? localStorage.getItem("onlyharness.ref") ?? "";
}

function refFromLocation(): string | undefined {
  const queryRef = new URLSearchParams(window.location.search).get("ref");
  if (queryRef) return queryRef;
  const hashQuery = window.location.hash.split("?")[1];
  return hashQuery ? new URLSearchParams(hashQuery).get("ref") ?? undefined : undefined;
}
