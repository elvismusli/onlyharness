import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { apiUrl, CLAUDE_PLUGIN_INSTALL_COMMAND, CODEX_MCP_INSTALL_COMMAND } from "./core/constants";
import { clockLabel, keyFor } from "./core/format";
import { useAuth } from "./core/useAuth";
import { useRegistry } from "./core/useRegistry";
import { useClipboard } from "./core/useClipboard";
import { useSocial } from "./core/useSocial";
import { usePublish } from "./core/usePublish";
import { useStorefront } from "./core/useStorefront";
import { useOrgWorkspace } from "./core/useOrgWorkspace";
import { useAppNav } from "./core/useAppNav";
import type { Surface } from "./core/useAppNav";
import { initialRefCode, keyForCheckout, parseCheckoutLocation, parseHarnessHash, parseStorefrontHash, refFromLocation, setHarnessHash } from "./core/url";
import type { CheckoutLinkState, DetailTab, DialogSpec, RegistryItem, ResourceItem, WinKind } from "./core/types";
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
  const [checkoutLinks, setCheckoutLinks] = useState<Record<string, CheckoutLinkState>>({});

  /* auth (extracted to core/useAuth; storefront/social identity stays here for now) */
  const auth = useAuth({ onFlash: flashMsg });

  /* clipboard (extracted to core/useClipboard). Declared before `social` because
     `social`'s remix fallback copies the local recipe via `copyText`. */
  const { copyText, copiedTag, copyFallback, dismissFallback } = useClipboard({ onFlash: flashMsg });

  /* social state + handlers (extracted to core/useSocial). Registry cache helpers
     are injected via lazy wrappers so `social` is created before `reg` (which reads
     `social.starred` as a plain value for its derived memos); the wrappers only
     dereference `reg` inside user-action handlers, well after both are mounted. */
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

  /* organization workspace (extracted to core/useOrgWorkspace). Created before
     `reg` because `reg` needs `org.orgHeadersForOwner`; the `cacheItems` wrapper
     only dereferences `reg` inside `loadOrgWorkspace`'s fetch handler, well after
     both hooks mount — the same lazy trick used for reg↔social above. */
  const org = useOrgWorkspace({
    cacheItems: (items) => reg.cacheItems(items),
    onFlash: flashMsg
  });

  /* registry/resource data + discovery controls */
  const reg = useRegistry({ starred: social.starred, orgHeadersForOwner: org.orgHeadersForOwner });

  /* publish/import flow (extracted to core/usePublish) */
  const publish = usePublish({
    requireUser: auth.requireUser,
    accessToken: auth.accessToken,
    setQuery: reg.setQuery,
    setJobFilter: reg.setJobFilter,
    bumpRefresh: reg.bumpRefresh,
    closePublish: () => closeWin("publish"),
    showDialog
  });

  /* storefront/creator-profile flow (extracted to core/useStorefront) */
  const storefront = useStorefront({
    session: auth.session,
    accessToken: auth.accessToken,
    cacheItems: reg.cacheItems,
    onFlash: flashMsg,
    onNeedAuth: openMyBriefcase
  });

  /* skin-neutral surface stack: the source of truth for *which* windows exist,
     their taskbar order, the active surface, and each harness window's detail
     tab. The Win98 window manager keeps only its view-state on top of it. */
  const nav = useAppNav();

  /* Win98-only window chrome: per-surface position + minimized state (`winView`,
     keyed by surface id) and z-order (`stack`, last = top). `focusedId` is now
     `nav.activeId`; per-harness `tab` is now `surface.tab`. */
  const [winView, setWinView] = useState<Record<string, { x: number; y: number; minimized: boolean }>>({});
  const [stack, setStack] = useState<string[]>([]);
  const openCount = useRef(0);

  /* chrome */
  const [dialog, setDialog] = useState<ActiveDialog | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [flash, setFlash] = useState("");
  const [refCode, setRefCode] = useState(() => initialRefCode());
  const [time, setTime] = useState(() => clockLabel(new Date()));
  const flashTimer = useRef(0);
  const handledHash = useRef("");

  /* ---------- effects ---------- */

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
        if (handledHash.current === canonical && nav.surfaces.some((surface) => surface.id === `checkout:${checkoutKey}`) && !winView[`checkout:${checkoutKey}`]?.minimized) return;
        handledHash.current = canonical;
        openWin("checkout", checkoutKey);
        return;
      }
      const storefront = parseStorefrontHash(window.location.hash);
      if (storefront) {
        const canonical = `#/@${storefront.handle}`;
        if (handledHash.current === canonical && nav.surfaces.some((surface) => surface.id === `storefront:${storefront.handle}`) && !winView[`storefront:${storefront.handle}`]?.minimized) return;
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
      if (handledHash.current === canonical && nav.surfaces.some((surface) => surface.id === `harness:${key}`) && !winView[`harness:${key}`]?.minimized) return;
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
  }, [reg.allItems, reg.knownItems, nav.surfaces, winView]);

  /* ---------- helpers ---------- */

  function flashMsg(message: string) {
    setFlash(message);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(""), 2000);
  }

  function showDialog(spec: ActiveDialog) {
    setDialog(spec);
  }

  /* ---------- window manager ----------
     `nav` owns *which* surfaces exist + the active id; these wrappers layer the
     Win98 chrome (cascade position, minimized flag, z-order) on top. */

  function raise(id: string) {
    setStack((current) => [...current.filter((entry) => entry !== id), id]);
    nav.focus(id);
  }

  function focusWin(id: string) {
    setWinView((current) => (current[id] ? { ...current, [id]: { ...current[id], minimized: false } } : current));
    raise(id);
  }

  function openWin(kind: WinKind, hkey?: string) {
    const id = nav.open(kind, { key: hkey });
    openCount.current += 1;
    const step = openCount.current % 5;
    setWinView((current) => {
      if (current[id]) return current;
      const width = WIN_WIDTHS[kind];
      const x = Math.max(8, Math.round((window.innerWidth - width) / 2) + step * 28 - 40);
      const y = 42 + step * 26;
      return { ...current, [id]: { x, y, minimized: false } };
    });
    setStack((current) => (current.includes(id) ? current : [...current, id]));
    raise(id);
    return id;
  }

  function closeWin(id: string) {
    clearDeepLinkForClosedWindow(id);
    nav.close(id);
    setWinView((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setStack((current) => current.filter((entry) => entry !== id));
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
    setWinView((current) => (current[id] ? { ...current, [id]: { ...current[id], minimized: true } } : current));
    if (nav.activeId === id) nav.focus("");
  }

  function moveWin(id: string, x: number, y: number) {
    setWinView((current) => (current[id] ? { ...current, [id]: { ...current[id], x, y } } : current));
  }

  /* ---------- data actions ---------- */

  function openHarness(item: RegistryItem, tab?: DetailTab) {
    const key = keyFor(item);
    reg.cacheItem(item);
    reg.loadDetail(item);
    setHarnessHash(item);
    const id = openWin("harness", key);
    if (tab) nav.setTab(id, tab);
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
    storefront.loadStorefront(clean);
    openWin("storefront", clean);
  }

  function openMyBriefcase() {
    if (!auth.user) {
      auth.openLogon("Log on to create your creator @handle.");
      return;
    }
    storefront.setStorefrontStatus("");
    openWin("profile");
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
      openWin("install", key);
      return;
    }
    openWin("install");
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

  function winMeta(surface: Surface): { icon: string; title: string } {
    const checkout = surface.kind === "checkout" && surface.key ? checkoutLinks[surface.key] : undefined;
    const item = checkout ? reg.knownItems[`${checkout.owner}/${checkout.repo}`] : surface.key ? reg.knownItems[surface.key] : undefined;
    switch (surface.kind) {
      case "harness": return { icon: "📦", title: item?.title ?? "Harness" };
      case "publish": return { icon: "📄", title: "New Harness Wizard" };
      case "install": return { icon: "💿", title: item ? `Install Center — ${item.title}` : "Install Center" };
      case "checkout": return { icon: "💳", title: checkout ? `Manual Checkout — ${checkout.owner}/${checkout.repo}` : "Manual Checkout" };
      case "cli": return { icon: "🖥️", title: "MS-DOS Prompt — hh.exe" };
      case "review": return { icon: "🔧", title: "Maintainer Review Preview" };
      case "leaderboard": return { icon: "🏆", title: "Wild West Top 10" };
      case "share": return { icon: "💾", title: `harness_flex.exe — ${item?.title ?? ""}` };
      case "storefront": return { icon: "🗂️", title: `@${surface.key ?? "handle"} — My Briefcase` };
      case "profile": return { icon: "🗂️", title: "My Briefcase — Creator Profile" };
      case "network": return { icon: "🌐", title: "Network Neighborhood" };
    }
  }

  const taskEntries: TaskEntry[] = [
    {
      id: "explore",
      icon: "🌐",
      title: "OnlyHarness — Explore",
      active: nav.activeId === "",
      onClick: () => {
        nav.focus("");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    ...nav.surfaces.map((surface) => {
      const meta = winMeta(surface);
      const minimized = Boolean(winView[surface.id]?.minimized);
      return {
        id: surface.id,
        icon: meta.icon,
        title: meta.title,
        active: nav.activeId === surface.id && !minimized,
        onClick: () => {
          if (minimized || nav.activeId !== surface.id) focusWin(surface.id);
          else minimizeWin(surface.id);
        }
      };
    })
  ];

  const startEntries: StartEntry[] = [
    { icon: "🧭", label: "Explore", onClick: () => { nav.focus(""); window.scrollTo({ top: 0, behavior: "smooth" }); } },
    { icon: "🏆", label: "Leaderboard", onClick: () => openWin("leaderboard") },
    { icon: "🌐", label: "Network Neighborhood", onClick: () => openWin("network") },
    { icon: "💿", label: "Install Center", onClick: () => openInstall(reg.topItem) },
    { icon: "🗂️", label: storefront.myHandle ? `My Briefcase (@${storefront.myHandle})` : "My Briefcase...", onClick: openMyBriefcase },
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

  function renderWinBody(surface: Surface) {
    const checkout = surface.kind === "checkout" && surface.key ? checkoutLinks[surface.key] : undefined;
    const item = checkout ? reg.knownItems[`${checkout.owner}/${checkout.repo}`] : surface.key ? reg.knownItems[surface.key] : reg.topItem;
    switch (surface.kind) {
      case "harness": {
        if (!item) return <div className="win-body plate">This harness rode off into the sunset.</div>;
        const key = keyFor(item);
        const detail = reg.details[key];
        const thread = social.threadFor(item, detail);
        return (
          <DetailBody
            item={item}
            detail={detail}
            tab={surface.tab ?? "Overview"}
            setTab={(tab) => nav.setTab(surface.id, tab)}
            starred={Boolean(social.starred[key])}
            remixed={Boolean(social.remixed[key])}
            thread={thread}
            draft={social.drafts[key] ?? ""}
            setDraft={(value) => social.setDraft(key, value)}
            kind={social.kinds[key] ?? "question"}
            setKind={(value) => social.setKind(key, value)}
            onPost={() => social.addThreadPost(item)}
            tryState={social.tryStates[key] ?? "idle"}
            onRunSample={() => social.runSample(item)}
            onStar={() => social.toggleStar(item)}
            onFork={() => social.remixHarness(item)}
            onCopyCli={() => {
              social.recordHarnessEvent("copy", item, "cli");
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
            name={publish.importName}
            setName={publish.setImportName}
            markdown={publish.importMarkdown}
            setMarkdown={publish.setImportMarkdown}
            status={publish.importStatus}
            busy={publish.importBusy}
            loggedIn={Boolean(auth.user)}
            onSubmit={publish.submitImport}
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
              if (item) social.recordHarnessEvent("copy", item, target);
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
          if (item) social.recordHarnessEvent("copy", item, "cli");
          void copyText(text, "CLI commands copied", "cliwin");
        }} copied={copiedTag === "cliwin"} />;
      case "review":
        return <ReviewBody item={item} detail={item ? reg.details[keyFor(item)] : undefined} onCopy={(text) => copyText(text, "Gate commands copied", "gate")} copied={copiedTag === "gate"} />;
      case "leaderboard":
        return <LeaderboardBody items={reg.leaderboard} onOpen={(entry) => openHarness(entry)} />;
      case "share":
        return item
          ? <ShareBody item={item} starred={Boolean(social.starred[keyFor(item)])} refCode={refCode} onCopy={(text) => copyText(text, "Share text copied", "brag")} copied={copiedTag === "brag"} />
          : <div className="win-body plate">Nothing to brag about yet.</div>;
      case "storefront": {
        const handle = surface.key ?? "";
        return <StorefrontBody page={storefront.storefronts[handle]} handle={handle} referrer={refCode} onOpen={(entry) => openHarness(entry)} onCopy={(text) => copyText(text, "Ref-link copied", `storefront:${handle}`)} copied={copiedTag === `storefront:${handle}`} />;
      }
      case "profile":
        return (
          <StorefrontEditorBody
            loggedIn={Boolean(auth.user)}
            profile={storefront.myStorefront}
            handle={storefront.storefrontHandle}
            setHandle={storefront.setStorefrontHandle}
            displayName={storefront.storefrontDisplayName}
            setDisplayName={storefront.setStorefrontDisplayName}
            bio={storefront.storefrontBio}
            setBio={storefront.setStorefrontBio}
            status={storefront.storefrontStatus}
            busy={storefront.storefrontBusy}
            onSave={storefront.saveMyStorefront}
            onOpenPublic={() => storefront.myStorefront && openStorefront(storefront.myStorefront.handle)}
            onLogon={() => auth.openLogon("Log on to create your creator @handle.")}
          />
        );
      case "network":
        return (
          <NetworkBody
            orgSlug={org.networkOrg}
            setOrgSlug={org.setNetworkOrg}
            orgToken={org.networkToken}
            setOrgToken={org.setNetworkToken}
            workspace={org.orgWorkspace}
            status={org.networkStatus}
            busy={org.networkBusy}
            onLoad={org.loadOrgWorkspace}
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

      <div onPointerDownCapture={() => nav.focus("")}>
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
          starred={social.starred}
          remixed={social.remixed}
          session={auth.session}
          totals={reg.totals}
          leader={reg.leader}
          flash={flash}
          active={nav.activeId === ""}
          actions={{
            openHarness,
            openResource,
            openInstall,
            star: social.toggleStar,
            remix: social.remixHarness,
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
              social.clearRemotePosts();
              flashMsg("Registry refreshed");
            }
          }}
        />
      </div>

      {nav.surfaces.map((surface) => {
        const meta = winMeta(surface);
        const view = winView[surface.id] ?? { x: 0, y: 0, minimized: false };
        return (
          <FloatWindow
            key={surface.id}
            win={{ id: surface.id, kind: surface.kind, hkey: surface.key, ...view }}
            zIndex={30 + Math.max(0, stack.indexOf(surface.id))}
            width={WIN_WIDTHS[surface.kind]}
            icon={meta.icon}
            title={meta.title}
            active={nav.activeId === surface.id}
            maroon={surface.kind === "leaderboard"}
            onFocus={() => { if (nav.activeId !== surface.id) focusWin(surface.id); }}
            onClose={() => closeWin(surface.id)}
            onMinimize={() => minimizeWin(surface.id)}
            onMove={(x, y) => moveWin(surface.id, x, y)}
          >
            {renderWinBody(surface)}
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

