import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl, CLAUDE_PLUGIN_INSTALL_COMMAND, CODEX_MCP_INSTALL_COMMAND } from "../../core/constants";
import { clockLabel, keyFor } from "../../core/format";
import { HarnessStore, useHarness } from "../../core/store";
import type { Surface } from "../../core/useAppNav";
import type { WinKind } from "../../core/types";
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

function App({ onMinimizedChange }: { onMinimizedChange: (next: Record<string, boolean>) => void }) {
  /* Every core hook, chrome state, surface orchestration, and the deep-link
     effect now live in the store; the Win98 window manager reads them via `h`. */
  const h = useHarness();

  /* Win98-only window chrome: per-surface position + minimized state (`winView`,
     keyed by surface id) and z-order (`stack`, last = top). The active surface is
     `h.activeId`; per-harness detail `tab` is `surface.tab`. */
  const [winView, setWinView] = useState<Record<string, { x: number; y: number; minimized: boolean }>>({});
  const [stack, setStack] = useState<string[]>([]);
  const openCount = useRef(0);

  /* chrome */
  const [startOpen, setStartOpen] = useState(false);
  const [time, setTime] = useState(() => clockLabel(new Date()));

  /* ---------- effects ---------- */

  useEffect(() => {
    const timer = window.setInterval(() => setTime(clockLabel(new Date())), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  /* Publish the minimized projection up to the store so its deep-link dedup can
     tell a minimized deep-link window (which should re-focus on a repeat hash
     fire) from an already-visible one (which should be left untouched). The
     original effect read this straight off `winView`. */
  useEffect(() => {
    const minimized: Record<string, boolean> = {};
    for (const [id, view] of Object.entries(winView)) if (view.minimized) minimized[id] = true;
    onMinimizedChange(minimized);
  }, [winView, onMinimizedChange]);

  /* WM reconciliation: the window manager is a pure reactor to `h.surfaces`.
     Any surface without a view-state entry is seeded a cascade position (the same
     openCount-based x/y the old `openWin` used) and appended to the z-stack; any
     view-state/stack entry whose surface no longer exists is pruned. */
  useEffect(() => {
    const ids = new Set(h.surfaces.map((surface) => surface.id));
    setWinView((current) => {
      let next = current;
      for (const surface of h.surfaces) {
        if (next[surface.id]) continue;
        openCount.current += 1;
        const step = openCount.current % 5;
        const width = WIN_WIDTHS[surface.kind];
        const x = Math.max(8, Math.round((window.innerWidth - width) / 2) + step * 28 - 40);
        const y = 42 + step * 26;
        if (next === current) next = { ...current };
        next[surface.id] = { x, y, minimized: false };
      }
      for (const id of Object.keys(next)) {
        if (!ids.has(id)) {
          if (next === current) next = { ...current };
          delete next[id];
        }
      }
      return next;
    });
    setStack((current) => {
      const appended = [...current];
      for (const surface of h.surfaces) if (!appended.includes(surface.id)) appended.push(surface.id);
      const pruned = appended.filter((id) => ids.has(id));
      return pruned.length === current.length && pruned.every((id, index) => id === current[index]) ? current : pruned;
    });
  }, [h.surfaces]);

  /* ---------- window manager view ops ----------
     `h`/`nav` own *which* surfaces exist + the active id; these ops layer the
     Win98 chrome (z-order, minimized flag, position) on top. */

  function raise(id: string) {
    setStack((current) => [...current.filter((entry) => entry !== id), id]);
    h.focus(id);
  }

  function focusWin(id: string) {
    setWinView((current) => (current[id] ? { ...current, [id]: { ...current[id], minimized: false } } : current));
    raise(id);
  }

  function minimizeWin(id: string) {
    setWinView((current) => (current[id] ? { ...current, [id]: { ...current[id], minimized: true } } : current));
    if (h.activeId === id) h.focus("");
  }

  function moveWin(id: string, x: number, y: number) {
    setWinView((current) => (current[id] ? { ...current, [id]: { ...current[id], x, y } } : current));
  }

  /* ---------- auth confirm wrapper (sign-out lives in the store's auth API) ---------- */

  function logOff() {
    h.showDialog({
      title: "Log Off OnlyHarness",
      icon: "🔑",
      body: `Log off ${h.user?.email ?? ""}? Your stars stay saved.`,
      onOk: () => { void h.signOut(); }
    });
  }

  /* ---------- canned dialogs ---------- */

  const cantClose = () => h.showDialog({ title: "OnlyHarness", icon: "⚠️", body: "You can't close the Wild West, partner. Your harness is still on the leaderboard." });
  const shutDown = () => h.showDialog({ title: "Shut Down OnlyHarness", icon: "🤠", body: "It's now safe to turn off your agent. But the harnesses keep getting warmer without you..." });
  const binDialog = () => h.showDialog({ title: "Remix Bin", icon: "🗑️", body: "The bin is empty. Log on to create server-side local remix drafts; copied recipes stay as the fallback path." });
  const aboutDialog = () => h.showDialog({ title: "About OnlyHarness 98", icon: "🧷", body: "The community hub for reusable agent harnesses: discover, install, remix, eval, improve. Lovingly wrapped in Windows 98 chrome, MS Paint colours and WordArt. No harnesses were harmed." });

  /* ---------- taskbar ---------- */

  function winMeta(surface: Surface): { icon: string; title: string } {
    const checkout = surface.kind === "checkout" && surface.key ? h.checkoutLinks[surface.key] : undefined;
    const item = checkout ? h.knownItems[`${checkout.owner}/${checkout.repo}`] : surface.key ? h.knownItems[surface.key] : undefined;
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
      active: h.activeId === "",
      onClick: () => {
        h.focus("");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    ...h.surfaces.map((surface) => {
      const meta = winMeta(surface);
      const minimized = Boolean(winView[surface.id]?.minimized);
      return {
        id: surface.id,
        icon: meta.icon,
        title: meta.title,
        active: h.activeId === surface.id && !minimized,
        onClick: () => {
          if (minimized || h.activeId !== surface.id) focusWin(surface.id);
          else minimizeWin(surface.id);
        }
      };
    })
  ];

  const startEntries: StartEntry[] = [
    { icon: "🧭", label: "Explore", onClick: () => { h.focus(""); window.scrollTo({ top: 0, behavior: "smooth" }); } },
    { icon: "🏆", label: "Leaderboard", onClick: h.openLeaderboard },
    { icon: "🌐", label: "Network Neighborhood", onClick: h.openNetwork },
    { icon: "💿", label: "Install Center", onClick: () => h.openInstall(h.topItem) },
    { icon: "🗂️", label: h.myHandle ? `My Briefcase (@${h.myHandle})` : "My Briefcase...", onClick: h.openMyBriefcase },
    { icon: "📄", label: "New harness...", onClick: h.openPublish },
    { icon: "🖥️", label: "MS-DOS Prompt", onClick: h.openCli },
    { icon: "🔧", label: "Maintainer Review", onClick: h.openReview },
    "sep",
    h.user
      ? { icon: "🔑", label: `Log Off ${h.user.email?.split("@")[0] ?? ""}...`, onClick: logOff }
      : { icon: "🔑", label: "Log On...", onClick: () => h.openLogon() },
    "sep",
    { icon: "⏻", label: "Shut Down...", onClick: shutDown }
  ];

  /* ---------- window bodies ---------- */

  function renderWinBody(surface: Surface) {
    const checkout = surface.kind === "checkout" && surface.key ? h.checkoutLinks[surface.key] : undefined;
    const item = checkout ? h.knownItems[`${checkout.owner}/${checkout.repo}`] : surface.key ? h.knownItems[surface.key] : h.topItem;
    switch (surface.kind) {
      case "harness": {
        if (!item) return <div className="win-body plate">This harness rode off into the sunset.</div>;
        const key = keyFor(item);
        const detail = h.details[key];
        const thread = h.threadFor(item, detail);
        return (
          <DetailBody
            item={item}
            detail={detail}
            tab={surface.tab ?? "Overview"}
            setTab={(tab) => h.setTab(surface.id, tab)}
            starred={Boolean(h.starred[key])}
            remixed={Boolean(h.remixed[key])}
            thread={thread}
            draft={h.drafts[key] ?? ""}
            setDraft={(value) => h.setDraft(key, value)}
            kind={h.kinds[key] ?? "question"}
            setKind={(value) => h.setKind(key, value)}
            onPost={() => h.addThreadPost(item)}
            tryState={h.tryStates[key] ?? "idle"}
            onRunSample={() => h.runSample(item)}
            onStar={() => h.toggleStar(item)}
            onFork={() => h.remixHarness(item)}
            onCopyCli={() => {
              h.recordHarnessEvent("copy", item, "cli");
              void h.copyText(item.cliCommand, `Copied: ${item.cliCommand}`, `cli:${key}`);
            }}
            onInstall={() => h.openInstall(item)}
            onShare={() => h.openShare(item)}
            copied={h.copiedTag === `cli:${key}`}
          />
        );
      }
      case "publish":
        return (
          <PublishBody
            name={h.importName}
            setName={h.setImportName}
            markdown={h.importMarkdown}
            setMarkdown={h.setImportMarkdown}
            status={h.importStatus}
            busy={h.importBusy}
            loggedIn={Boolean(h.user)}
            onSubmit={h.submitImport}
            onLogon={() => h.openLogon("Log on to publish a harness.")}
          />
        );
      case "install":
        return (
          <InstallBody
            item={item}
            detail={item ? h.details[keyFor(item)] : undefined}
            apiUrl={apiUrl}
            accessToken={h.accessToken}
            refCode={h.refCode}
            onLogon={() => h.openLogon("Log on to create a checkout session.")}
            onCopy={(text, target) => {
              if (item) h.recordHarnessEvent("copy", item, target);
              void h.copyText(text, "Install commands copied", "install");
            }}
            copied={h.copiedTag === "install"}
          />
        );
      case "checkout":
        return (
          <CheckoutBody
            checkout={checkout}
            item={item}
            detail={item ? h.details[keyFor(item)] : undefined}
            apiUrl={apiUrl}
            refCode={checkout?.ref ?? h.refCode}
            onOpenInstall={() => h.openInstall(item)}
            onCopy={(text) => h.copyText(text, "Checkout retry command copied", "checkout")}
            copied={h.copiedTag === "checkout"}
          />
        );
      case "cli":
        return <CliBody item={item} onCopy={(text) => {
          if (item) h.recordHarnessEvent("copy", item, "cli");
          void h.copyText(text, "CLI commands copied", "cliwin");
        }} copied={h.copiedTag === "cliwin"} />;
      case "review":
        return <ReviewBody item={item} detail={item ? h.details[keyFor(item)] : undefined} onCopy={(text) => h.copyText(text, "Gate commands copied", "gate")} copied={h.copiedTag === "gate"} />;
      case "leaderboard":
        return <LeaderboardBody items={h.leaderboard} onOpen={(entry) => h.openHarness(entry)} />;
      case "share":
        return item
          ? <ShareBody item={item} starred={Boolean(h.starred[keyFor(item)])} refCode={h.refCode} onCopy={(text) => h.copyText(text, "Share text copied", "brag")} copied={h.copiedTag === "brag"} />
          : <div className="win-body plate">Nothing to brag about yet.</div>;
      case "storefront": {
        const handle = surface.key ?? "";
        return <StorefrontBody page={h.storefronts[handle]} handle={handle} referrer={h.refCode} onOpen={(entry) => h.openHarness(entry)} onCopy={(text) => h.copyText(text, "Ref-link copied", `storefront:${handle}`)} copied={h.copiedTag === `storefront:${handle}`} />;
      }
      case "profile":
        return (
          <StorefrontEditorBody
            loggedIn={Boolean(h.user)}
            profile={h.myStorefront}
            handle={h.storefrontHandle}
            setHandle={h.setStorefrontHandle}
            displayName={h.storefrontDisplayName}
            setDisplayName={h.setStorefrontDisplayName}
            bio={h.storefrontBio}
            setBio={h.setStorefrontBio}
            status={h.storefrontStatus}
            busy={h.storefrontBusy}
            onSave={h.saveMyStorefront}
            onOpenPublic={() => h.myStorefront && h.openStorefront(h.myStorefront.handle)}
            onLogon={() => h.openLogon("Log on to create your creator @handle.")}
          />
        );
      case "network":
        return (
          <NetworkBody
            orgSlug={h.networkOrg}
            setOrgSlug={h.setNetworkOrg}
            orgToken={h.networkToken}
            setOrgToken={h.setNetworkToken}
            workspace={h.orgWorkspace}
            status={h.networkStatus}
            busy={h.networkBusy}
            onLoad={h.loadOrgWorkspace}
            onOpen={(entry) => h.openHarness(entry)}
          />
        );
    }
  }

  /* ---------- render ---------- */

  return (
    <div className="desktop skin-win98" data-skin="win98">
      <DesktopIcons
        onMyHarnesses={() => {
          h.setResourceTab("All");
          h.setJobFilter("all");
          document.getElementById("trending")?.scrollIntoView({ behavior: "smooth" });
        }}
        onNetwork={h.openNetwork}
        onBin={binDialog}
      />
      <AwardWindow leader={h.leader} />

      <div onPointerDownCapture={() => h.focus("")}>
        <ExploreWindow
          items={h.items}
          resources={h.visibleResources}
          resourceCounts={h.resourceCounts}
          resourceTab={h.resourceTab}
          setResourceTab={h.setResourceTab}
          jobs={h.jobs}
          jobFilter={h.jobFilter}
          setJobFilter={h.setJobFilter}
          query={h.query}
          setQuery={h.setQuery}
          sort={h.sort}
          setSort={h.setSort}
          starred={h.starred}
          remixed={h.remixed}
          session={h.session}
          totals={h.totals}
          leader={h.leader}
          flash={h.flash}
          active={h.activeId === ""}
          actions={{
            openHarness: h.openHarness,
            openResource: h.openResource,
            openInstall: h.openInstall,
            star: h.toggleStar,
            remix: h.remixHarness,
            share: h.openShare,
            openPublish: h.openPublish,
            openCli: h.openCli,
            openReview: h.openReview,
            openLeaderboard: h.openLeaderboard,
            openProfile: h.openMyBriefcase,
            openLogon: () => h.openLogon(),
            logOff,
            cantClose,
            about: aboutDialog,
            copyClaudePluginInstall: () => h.copyText(CLAUDE_PLUGIN_INSTALL_COMMAND, "Claude Code plugin install copied", "agent-install:claude"),
            copyCodexMcpInstall: () => h.copyText(CODEX_MCP_INSTALL_COMMAND, "Codex MCP install copied", "agent-install:codex"),
            copyText: (text, label) => h.copyText(text, label),
            refresh: () => {
              h.refresh();
              h.clearRemotePosts();
              h.flashMsg("Registry refreshed");
            }
          }}
        />
      </div>

      {h.surfaces.map((surface) => {
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
            active={h.activeId === surface.id}
            maroon={surface.kind === "leaderboard"}
            onFocus={() => { if (h.activeId !== surface.id) focusWin(surface.id); }}
            onClose={() => h.closeSurface(surface.id)}
            onMinimize={() => minimizeWin(surface.id)}
            onMove={(x, y) => moveWin(surface.id, x, y)}
          >
            {renderWinBody(surface)}
          </FloatWindow>
        );
      })}

      <PaintWindow items={h.leaderboard} />
      <Mascot onYes={h.openPublish} />

      {startOpen && <StartMenu items={startEntries} onClose={() => setStartOpen(false)} />}

      <Taskbar
        tasks={taskEntries}
        startOpen={startOpen}
        onStart={() => setStartOpen((open) => !open)}
        time={time}
        onTrayFire={h.openLeaderboard}
      />

      {h.logon.open && (
        <LogonDialog
          note={h.logon.note}
          status={h.authStatus}
          busy={h.authBusy}
          configured={h.configured}
          onSignIn={h.signIn}
          onSignUp={h.signUp}
          onResendConfirmation={h.resendConfirmation}
          onClose={h.closeLogon}
        />
      )}

      {h.dialog && (
        <Dialog
          title={h.dialog.title}
          icon={h.dialog.icon}
          body={h.dialog.body}
          onClose={h.closeDialog}
          actions={
            h.dialog.onOk ? (
              <>
                <Btn strong onClick={() => { h.dialog?.onOk?.(); h.closeDialog(); }}>OK</Btn>
                <Btn onClick={h.closeDialog}>Cancel</Btn>
              </>
            ) : undefined
          }
        />
      )}

      {h.copyFallback && (
        <Dialog
          title="Remix draft fallback"
          onClose={h.dismissFallback}
          actions={<Btn strong onClick={h.dismissFallback}>OK</Btn>}
        >
          <div className="dialog-body copy-fallback">
            <span className="di">📋</span>
            <div className="copy-fallback-body">
              <span>{h.copyFallback.label}</span>
              <textarea
                className="copy-fallback-text"
                readOnly
                value={h.copyFallback.text}
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

/**
 * Win98 skin entry: composes the store with the Win98 window manager. The Win98
 * window manager injects its `winView.minimized` view-state into the store's
 * deep-link dedup so a repeat fire of the same hash re-focuses a minimized
 * deep-link window but leaves an already-visible one untouched — preserving the
 * original effect (which depended on `winView` directly and so re-ran, and
 * re-focused, when a deep-link window's minimized flag flipped). `winMinimized`
 * only re-identifies when the minimized *set* changes, so the store effect
 * re-runs on minimize/restore but not on pure position moves.
 */
export function Win98Skin() {
  const [winMinimized, setWinMinimized] = useState<Record<string, boolean>>({});
  const onMinimizedChange = useCallback((next: Record<string, boolean>) => {
    setWinMinimized((current) => {
      const currentIds = Object.keys(current);
      const nextIds = Object.keys(next);
      if (currentIds.length === nextIds.length && nextIds.every((id) => current[id])) return current;
      return next;
    });
  }, []);
  const isMinimized = useCallback((id: string) => Boolean(winMinimized[id]), [winMinimized]);
  return (
    <HarnessStore isMinimized={isMinimized}>
      <App onMinimizedChange={onMinimizedChange} />
    </HarnessStore>
  );
}
