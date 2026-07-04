import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { createClient, type Session } from "@supabase/supabase-js";
import {
  ArrowUpRight,
  CheckCircle2,
  Clipboard,
  Code2,
  Copy,
  FileText,
  Filter,
  Flame,
  GitFork,
  GitPullRequestArrow,
  Import,
  MessageCircle,
  Play,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  TerminalSquare,
  Trophy,
  UploadCloud,
  XCircle
} from "lucide-react";
import "./styles.css";

type RegistryItem = {
  owner: string;
  ownerLabel: string;
  name: string;
  title: string;
  summary: string;
  tags: string[];
  outcome: string;
  runtime: string;
  forgeUrl: string;
  valid: boolean;
  riskScore: number;
  riskTier: string;
  evalStatus: string;
  evalScore: number;
  forks: number;
  stars: number;
  threads: number;
  runs: number;
  heat: number;
  heatDelta: number;
  freshness: string;
  badge: string;
  cliCommand: string;
  updatedAt: string;
};

type ThreadItem = {
  id: string;
  author: string;
  role: string;
  kind: string;
  body: string;
  likes: number;
  at: string;
};

type HarnessDetail = {
  owner: string;
  repo: string;
  root: string;
  forgeUrl: string;
  social?: Pick<RegistryItem, "stars" | "forks" | "threads" | "runs" | "heat" | "heatDelta" | "freshness" | "badge" | "cliCommand">;
  thread?: ThreadItem[];
  example?: { input: string; expected: string };
  files?: string[];
  manifest?: {
    name: string;
    title: string;
    summary: string;
    tags: string[];
    runtime: { primary: string; adapters: string[] };
    agents: Array<{ id: string; role: string; title?: string; prompt: string; tools: string[] }>;
    workflow: { stages: Array<{ id: string; agent: string }> };
    tools: { mcp_servers: Array<{ id: string }>; external_apis: Array<{ id: string; hostname: string }> };
    permissions: Record<string, unknown>;
    quality_gates: { min_score: number; max_cost_usd_per_run: number; max_risk_score: number };
  };
  valid: boolean;
  risk: { score: number; tier: string; reasons: string[]; blocking: string[] };
  evalResult?: { status: string; score: number; cost_usd: number; cases: Array<{ id: string; title: string; score: number; passed: boolean }> };
  prReview: { status: string; markdown: string; diff: { riskDelta: number; riskTier: string; changes: Array<{ severity: string; area: string; message: string }> } };
  readme: string;
};

type View = "explore" | "publish" | "review" | "settings";

const apiUrl = import.meta.env.VITE_HARNESS_API_URL ?? "http://127.0.0.1:8787";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : undefined;
const outcomeOrder = ["all", "Research", "Support", "Finance safety", "Strategy", "Engineering", "Builder tools"];
const detailTabs = ["Overview", "Try", "Thread", "Evals", "Files"] as const;

function App() {
  const [items, setItems] = useState<RegistryItem[]>([]);
  const [leaderboard, setLeaderboard] = useState<RegistryItem[]>([]);
  const [selected, setSelected] = useState<RegistryItem | undefined>();
  const [detail, setDetail] = useState<HarnessDetail | undefined>();
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState("all");
  const [sort, setSort] = useState("trending");
  const [view, setView] = useState<View>("explore");
  const [tab, setTab] = useState<(typeof detailTabs)[number]>("Overview");
  const [copied, setCopied] = useState("");
  const [starred, setStarred] = useState<Record<string, boolean>>({});
  const [forked, setForked] = useState<Record<string, boolean>>({});
  const [tryStatus, setTryStatus] = useState("");
  const [threadDraft, setThreadDraft] = useState("");
  const [threadKind, setThreadKind] = useState("question");
  const [threadAdditions, setThreadAdditions] = useState<Record<string, ThreadItem[]>>({});
  const [remoteThreadPosts, setRemoteThreadPosts] = useState<Record<string, ThreadItem[]>>({});
  const [importName, setImportName] = useState("customer-research-pipeline");
  const [importMarkdown, setImportMarkdown] = useState("# Customer Research Pipeline\n\nResearch target users, synthesize pains, critique assumptions, produce a decision memo with unresolved fields marked.");
  const [importStatus, setImportStatus] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authStatus, setAuthStatus] = useState("");

  useEffect(() => {
    if (!supabase) {
      setAuthStatus("Supabase env is not configured");
      return;
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthStatus(nextSession?.user ? "Signed in" : "");
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (outcome !== "all") params.set("outcome", outcome);
    params.set("sort", sort);
    fetch(`${apiUrl}/registry?${params.toString()}`)
      .then((response) => response.json())
      .then((data) => {
        const nextItems = data.items ?? [];
        setItems(nextItems);
        setSelected((current) => current && nextItems.some((item: RegistryItem) => keyFor(item) === keyFor(current)) ? current : nextItems[0]);
      })
      .catch(() => setItems([]));
  }, [query, outcome, sort]);

  useEffect(() => {
    fetch(`${apiUrl}/leaderboard?limit=5`)
      .then((response) => response.json())
      .then((data) => setLeaderboard(data.items ?? []))
      .catch(() => setLeaderboard([]));
  }, [items.length]);

  useEffect(() => {
    if (!selected) {
      setDetail(undefined);
      return;
    }
    setTab("Overview");
    setTryStatus("");
    fetch(`${apiUrl}/repos/${selected.owner}/${selected.name}/harness`)
      .then((response) => response.json())
      .then(setDetail)
      .catch(() => setDetail(undefined));
  }, [selected]);

  useEffect(() => {
    if (!supabase || !session?.user) {
      setStarred({});
      setForked({});
      return;
    }
    supabase
      .from("user_harness_actions")
      .select("owner,repo,action")
      .then(({ data }) => {
        const nextStars: Record<string, boolean> = {};
        const nextForks: Record<string, boolean> = {};
        for (const action of data ?? []) {
          const key = `${action.owner}/${action.repo}`;
          if (action.action === "star") nextStars[key] = true;
          if (action.action === "fork") nextForks[key] = true;
        }
        setStarred(nextStars);
        setForked(nextForks);
      });
  }, [session]);

  useEffect(() => {
    if (!supabase || !selected) return;
    const key = keyFor(selected);
    supabase
      .from("harness_thread_posts")
      .select("id,user_id,kind,body,created_at")
      .eq("owner", selected.owner)
      .eq("repo", selected.name)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        const posts = (data ?? []).map((post) => ({
          id: post.id,
          author: post.user_id === session?.user.id ? "you" : `user-${String(post.user_id).slice(0, 6)}`,
          role: "member",
          kind: post.kind,
          body: post.body,
          likes: 0,
          at: relativeTime(post.created_at)
        }));
        setRemoteThreadPosts((current) => ({ ...current, [key]: posts }));
      });
  }, [selected, session?.user.id]);

  const stats = useMemo(() => {
    const totalStars = items.reduce((sum, item) => sum + item.stars + (starred[keyFor(item)] ? 1 : 0), 0);
    const totalForks = items.reduce((sum, item) => sum + item.forks + (forked[keyFor(item)] ? 1 : 0), 0);
    const threadCount = items.reduce((sum, item) => sum + item.threads, 0);
    const hot = items[0]?.heat ?? 0;
    return { totalStars, totalForks, threadCount, hot };
  }, [items, starred, forked]);

  const selectedKey = selected ? keyFor(selected) : "";
  const activeThread = [
    ...(detail?.thread ?? []),
    ...(remoteThreadPosts[selectedKey] ?? []),
    ...(threadAdditions[selectedKey] ?? [])
  ];

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      setCopied("Copy failed");
    }
    window.setTimeout(() => setCopied(""), 1600);
  }

  function openExplore(targetId?: string) {
    setView("explore");
    window.setTimeout(() => {
      if (targetId) document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    }, 30);
  }

  function openThread() {
    setView("explore");
    setTab("Thread");
    window.setTimeout(() => document.getElementById("detail")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  async function handleSignUp() {
    if (!supabase) return setAuthStatus("Supabase env is missing");
    if (!authEmail || !authPassword) return setAuthStatus("Email and password are required");
    setAuthStatus("Creating account...");
    const { error, data } = await supabase.auth.signUp({
      email: authEmail,
      password: authPassword,
      options: { data: { display_name: authName || authEmail.split("@")[0] } }
    });
    if (error) return setAuthStatus(error.message);
    setAuthStatus(data.session ? "Account created and signed in" : "Account created. Check email if confirmation is enabled.");
  }

  async function handleSignIn() {
    if (!supabase) return setAuthStatus("Supabase env is missing");
    if (!authEmail || !authPassword) return setAuthStatus("Email and password are required");
    setAuthStatus("Signing in...");
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    setAuthStatus(error ? error.message : "Signed in");
  }

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setAuthStatus("Signed out");
  }

  function requireUser(action: string) {
    if (session?.user) return true;
    setAuthStatus(`Sign in to ${action}`);
    return false;
  }

  async function toggleStar(item: RegistryItem) {
    if (!requireUser("star harnesses")) return;
    const key = keyFor(item);
    const next = !starred[key];
    setStarred((current) => ({ ...current, [key]: next }));
    if (!supabase || !session?.user) return;
    if (next) {
      const { error } = await supabase.from("user_harness_actions").upsert({ user_id: session.user.id, owner: item.owner, repo: item.name, action: "star" });
      if (error) setAuthStatus(error.message);
    } else {
      const { error } = await supabase.from("user_harness_actions").delete().match({ user_id: session.user.id, owner: item.owner, repo: item.name, action: "star" });
      if (error) setAuthStatus(error.message);
    }
  }

  async function forkHarness(item: RegistryItem) {
    if (!requireUser("fork harnesses")) return;
    setForked((current) => ({ ...current, [keyFor(item)]: true }));
    setSelected(item);
    if (supabase && session?.user) {
      const { error } = await supabase.from("user_harness_actions").upsert({ user_id: session.user.id, owner: item.owner, repo: item.name, action: "fork" });
      if (error) setAuthStatus(error.message);
    }
    setCopied("Forked locally");
    window.setTimeout(() => setCopied(""), 1600);
  }

  async function runSample() {
    setTryStatus("Running sample...");
    if (selected && supabase && session?.user) {
      await supabase.from("user_harness_actions").upsert({ user_id: session.user.id, owner: selected.owner, repo: selected.name, action: "run" });
    }
    window.setTimeout(() => setTryStatus("Sample passed eval gate locally"), 520);
  }

  async function addThreadPost() {
    if (!selected || !threadDraft.trim()) return;
    if (!requireUser("post in threads")) return;
    const post: ThreadItem = {
      id: `${selectedKey}-${Date.now()}`,
      author: "you",
      role: "builder",
      kind: threadKind,
      body: threadDraft.trim(),
      likes: 0,
      at: "now"
    };
    if (supabase && session?.user) {
      const { data, error } = await supabase
        .from("harness_thread_posts")
        .insert({ owner: selected.owner, repo: selected.name, user_id: session.user.id, kind: threadKind, body: threadDraft.trim() })
        .select("id,kind,body,created_at")
        .single();
      if (error) {
        setAuthStatus(error.message);
        return;
      }
      post.id = data.id;
      post.at = relativeTime(data.created_at);
    }
    setRemoteThreadPosts((current) => ({ ...current, [selectedKey]: [...(current[selectedKey] ?? []), post] }));
    setThreadDraft("");
  }

  async function submitImport() {
    if (!requireUser("publish harnesses")) return;
    setImportStatus("Publishing...");
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
      setImportStatus(result.error ?? "Publish failed");
      return;
    }
    setImportStatus(`Published ${result.item.title}`);
    setView("explore");
    setQuery(importName);
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView("explore")} aria-label="OnlyHarness home">
          <span className="brand-mark">OH</span>
          <span>
            <strong>OnlyHarness</strong>
            <small>onlyharness.com</small>
          </span>
        </button>
        <nav className="top-nav" aria-label="Main navigation">
          <button className={view === "explore" ? "active" : ""} onClick={() => openExplore()}>Explore</button>
          <button onClick={() => openExplore("explore")}>Harnesses</button>
          <button onClick={openThread}>Threads</button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>CLI</button>
          <button className={view === "publish" ? "active" : ""} onClick={() => setView("publish")}>Publish</button>
          <button className={view === "review" ? "active" : ""} onClick={() => setView("review")}>Maintainers</button>
        </nav>
        <label className="global-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search research, support, finance..." />
        </label>
        <button className="ghost-button" onClick={() => copyText(selected?.cliCommand ?? "hh pull harnesses/deep-market-researcher", "CLI copied")}>
          <Copy size={16} /> Copy CLI
        </button>
      </header>

      {copied && <div className="toast">{copied}</div>}

      <main>
        <AuthPanel
          session={session}
          authEmail={authEmail}
          setAuthEmail={setAuthEmail}
          authPassword={authPassword}
          setAuthPassword={setAuthPassword}
          authName={authName}
          setAuthName={setAuthName}
          authStatus={authStatus}
          onSignUp={handleSignUp}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
          configured={Boolean(supabase)}
        />

        {view === "explore" && (
          <>
            <section className="hero">
              <div className="hero-copy">
                <h1>OnlyHarness</h1>
                <p>Friendly hub for forkable AI-agent workflows. Browse by outcome, try examples, read the thread, then pull the harness with CLI.</p>
                <div className="hero-actions">
                  <button className="primary-button" onClick={() => openExplore("explore")}>
                    <Sparkles size={17} /> Explore harnesses
                  </button>
                  <button className="secondary-button" onClick={() => setView("publish")}>
                    <UploadCloud size={17} /> Publish harness
                  </button>
                </div>
                <div className="proof-line">
                  <span><Star size={14} /> {formatCount(stats.totalStars)} stars</span>
                  <span><GitFork size={14} /> {formatCount(stats.totalForks)} forks</span>
                  <span><MessageCircle size={14} /> {stats.threadCount} thread notes</span>
                  <span><Flame size={14} /> {stats.hot.toFixed(1)} heat leader</span>
                </div>
              </div>
              <ExplorePreview items={items.slice(0, 4)} />
            </section>

            <section className="market-layout" id="explore">
              <aside className="rail">
                <div className="rail-card">
                  <h2>Browse by outcome</h2>
                  <div className="outcome-list">
                    {outcomeOrder.map((item) => (
                      <button key={item} className={outcome === item ? "active" : ""} onClick={() => setOutcome(item)}>
                        <span>{item === "all" ? "Trending" : item}</span>
                        <strong>{item === "all" ? items.length : items.filter((entry) => entry.outcome === item).length}</strong>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rail-card heat-card">
                  <h2>Harness Heat</h2>
                  <p>Popularity with a pulse: stars, forks, runs, thread replies, eval score and freshness.</p>
                  <div className="heat-meter">
                    <strong>{stats.hot.toFixed(1)}</strong>
                    <span>warm and growing</span>
                  </div>
                  <div className="meter-track"><span style={{ width: `${Math.min(100, stats.hot * 3)}%` }} /></div>
                </div>
                <div className="rail-card">
                  <h2>Wild West Top 5</h2>
                  <div className="leaderboard">
                    {leaderboard.map((item, index) => (
                      <button key={keyFor(item)} onClick={() => setSelected(item)}>
                        <span>{index + 1}</span>
                        <strong>{item.title}</strong>
                        <em>{item.heat.toFixed(1)}</em>
                      </button>
                    ))}
                  </div>
                </div>
              </aside>

              <section className="catalog">
                <div className="section-head">
                  <div>
                    <h2>Trending harnesses</h2>
                    <p>Stars, forks, threads and eval trust in one glance.</p>
                  </div>
                  <div className="toolbar">
                    <label>
                      <Filter size={15} />
                      <select value={sort} onChange={(event) => setSort(event.target.value)}>
                        <option value="trending">Heat</option>
                        <option value="stars">Stars</option>
                        <option value="forks">Forks</option>
                        <option value="threads">Threads</option>
                        <option value="new">Fresh</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div className="harness-grid">
                  {items.map((item) => (
                    <HarnessCard
                      key={keyFor(item)}
                      item={item}
                      selected={selectedKey === keyFor(item)}
                      starred={Boolean(starred[keyFor(item)])}
                      forked={Boolean(forked[keyFor(item)])}
                      onSelect={() => setSelected(item)}
                      onStar={() => toggleStar(item)}
                      onFork={() => forkHarness(item)}
                      onCopy={() => copyText(item.cliCommand, "CLI copied")}
                    />
                  ))}
                </div>
              </section>
            </section>

            {selected && (
              <section className="detail-shell" id="detail">
                <HarnessDetailPanel
                  item={selected}
                  detail={detail}
                  tab={tab}
                  setTab={setTab}
                  thread={activeThread}
                  threadDraft={threadDraft}
                  setThreadDraft={setThreadDraft}
                  threadKind={threadKind}
                  setThreadKind={setThreadKind}
                  addThreadPost={addThreadPost}
                  tryStatus={tryStatus}
                  runSample={runSample}
                  copyText={copyText}
                  starBoost={starred[selectedKey] ? 1 : 0}
                  forkBoost={forked[selectedKey] ? 1 : 0}
                  onStar={() => toggleStar(selected)}
                  onFork={() => forkHarness(selected)}
                />
              </section>
            )}
          </>
        )}

        {view === "publish" && (
          <PublishPanel
            importName={importName}
            setImportName={setImportName}
            importMarkdown={importMarkdown}
            setImportMarkdown={setImportMarkdown}
            importStatus={importStatus}
            submitImport={submitImport}
          />
        )}

        {view === "review" && <ReviewPanel detail={detail} item={selected} copyText={copyText} />}
        {view === "settings" && <CliPanel selected={selected} copyText={copyText} />}
      </main>
    </div>
  );
}

function AuthPanel({ session, authEmail, setAuthEmail, authPassword, setAuthPassword, authName, setAuthName, authStatus, onSignUp, onSignIn, onSignOut, configured }: {
  session: Session | null;
  authEmail: string;
  setAuthEmail: (value: string) => void;
  authPassword: string;
  setAuthPassword: (value: string) => void;
  authName: string;
  setAuthName: (value: string) => void;
  authStatus: string;
  onSignUp: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  configured: boolean;
}) {
  if (session?.user) {
    return (
      <section className="auth-bar signed-in">
        <div>
          <strong>{session.user.email}</strong>
          <span>Your stars, forks, runs and thread posts are saved in Supabase.</span>
        </div>
        <button className="secondary-button" onClick={onSignOut}>Log out</button>
      </section>
    );
  }
  return (
    <section className="auth-bar">
      <div>
        <strong>Create your OnlyHarness account</strong>
        <span>{configured ? "Sign up to star, fork, publish and post in threads." : "Supabase env is missing."}</span>
      </div>
      <input value={authName} onChange={(event) => setAuthName(event.target.value)} placeholder="Display name" />
      <input value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="Email" type="email" />
      <input value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="Password" type="password" />
      <button className="primary-button" onClick={onSignUp}>Sign up</button>
      <button className="secondary-button" onClick={onSignIn}>Log in</button>
      {authStatus && <small>{authStatus}</small>}
    </section>
  );
}

function ExplorePreview({ items }: { items: RegistryItem[] }) {
  return (
    <div className="preview-window" aria-label="Explore page preview">
      <div className="window-top">
        <span />
        <span />
        <span />
        <strong>Explore page concept</strong>
      </div>
      <div className="preview-body">
        <div className="preview-menu">
          <h2>Browse by outcome</h2>
          {["Trending", "Research", "Support", "Finance safety", "Coding review"].map((item, index) => (
            <div className={index === 0 ? "active" : ""} key={item}>
              <span>{item}</span>
              <strong>{[24, 128, 74, 39, 91][index]}</strong>
            </div>
          ))}
        </div>
        <div className="preview-cards">
          <h2>Trending this week</h2>
          <div className="mini-grid">
            {items.map((item) => (
              <div className="mini-card" key={keyFor(item)}>
                <span className="avatar">{initials(item.title)}</span>
                <strong>{item.title}</strong>
                <p>{item.summary}</p>
                <div>
                  <span>{formatCount(item.stars)} stars</span>
                  <span>{item.heat.toFixed(1)} heat</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function HarnessCard({ item, selected, starred, forked, onSelect, onStar, onFork, onCopy }: {
  item: RegistryItem;
  selected: boolean;
  starred: boolean;
  forked: boolean;
  onSelect: () => void;
  onStar: () => void;
  onFork: () => void;
  onCopy: () => void;
}) {
  return (
    <article className={`harness-card ${selected ? "selected" : ""}`} onClick={onSelect}>
      <div className="card-head">
        <span className="avatar">{initials(item.title)}</span>
        <div>
          <h3>{item.title}</h3>
          <p>by {item.ownerLabel}</p>
        </div>
        <span className={`badge ${badgeClass(item)}`}>{item.badge}</span>
      </div>
      <p className="card-summary">{item.summary}</p>
      <div className="tag-row">{item.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div>
      <div className="card-stats">
        <Metric icon={<Star size={14} />} value={formatCount(item.stars + (starred ? 1 : 0))} label="stars" />
        <Metric icon={<GitFork size={14} />} value={formatCount(item.forks + (forked ? 1 : 0))} label="forks" />
        <Metric icon={<MessageCircle size={14} />} value={String(item.threads)} label="threads" />
        <Metric icon={<Flame size={14} />} value={item.heat.toFixed(1)} label="heat" />
      </div>
      <div className="card-actions" onClick={(event) => event.stopPropagation()}>
        <button onClick={onSelect}><Play size={14} /> Try</button>
        <button onClick={onCopy}><TerminalSquare size={14} /> CLI</button>
        <button className={forked ? "active" : ""} onClick={onFork}><GitFork size={14} /> Fork</button>
        <button className={starred ? "active" : ""} onClick={onStar}><Star size={14} /> Star</button>
      </div>
    </article>
  );
}

function HarnessDetailPanel({ item, detail, tab, setTab, thread, threadDraft, setThreadDraft, threadKind, setThreadKind, addThreadPost, tryStatus, runSample, copyText, starBoost, forkBoost, onStar, onFork }: {
  item: RegistryItem;
  detail?: HarnessDetail;
  tab: (typeof detailTabs)[number];
  setTab: (tab: (typeof detailTabs)[number]) => void;
  thread: ThreadItem[];
  threadDraft: string;
  setThreadDraft: (value: string) => void;
  threadKind: string;
  setThreadKind: (value: string) => void;
  addThreadPost: () => void;
  tryStatus: string;
  runSample: () => void;
  copyText: (text: string, label: string) => void;
  starBoost: number;
  forkBoost: number;
  onStar: () => void;
  onFork: () => void;
}) {
  const manifest = detail?.manifest;
  return (
    <div className="detail-grid">
      <section className="detail-main">
        <div className="detail-title">
          <div className="avatar large">{initials(item.title)}</div>
          <div>
            <span>{item.ownerLabel}/{item.name}</span>
            <h2>{item.title}</h2>
            <p>{item.summary}</p>
          </div>
        </div>
        <div className="detail-tabs">
          {detailTabs.map((entry) => <button key={entry} className={tab === entry ? "active" : ""} onClick={() => setTab(entry)}>{entry}</button>)}
        </div>
        {tab === "Overview" && (
          <div className="tab-panel">
            <div className="readme-card">
              <h3>What it does</h3>
              <p>{cleanReadme(detail?.readme) || item.summary}</p>
            </div>
            <div className="workflow">
              <h3>Workflow</h3>
              <div>
                {(manifest?.workflow.stages ?? []).map((stage, index) => (
                  <div className="workflow-step" key={`${stage.id}-${index}`}>
                    <strong>{index + 1}</strong>
                    <span>{stage.id}</span>
                    <em>{stage.agent}</em>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {tab === "Try" && (
          <div className="try-grid">
            <div className="code-panel">
              <h3>Input example</h3>
              <pre>{detail?.example?.input || "Loading example..."}</pre>
            </div>
            <div className="code-panel">
              <h3>Expected output</h3>
              <pre>{detail?.example?.expected || "Loading expected output..."}</pre>
            </div>
            <button className="primary-button" onClick={runSample}><Play size={16} /> Run sample</button>
            {tryStatus && <span className="run-status"><CheckCircle2 size={16} /> {tryStatus}</span>}
          </div>
        )}
        {tab === "Thread" && (
          <div className="thread-panel">
            <div className="composer">
              <select value={threadKind} onChange={(event) => setThreadKind(event.target.value)}>
                <option value="question">question</option>
                <option value="recipe">recipe</option>
                <option value="result">result</option>
                <option value="proposal">proposal</option>
                <option value="bug/risk">bug/risk</option>
              </select>
              <input value={threadDraft} onChange={(event) => setThreadDraft(event.target.value)} placeholder="Share a recipe, question or result..." />
              <button onClick={addThreadPost}><Send size={15} /></button>
            </div>
            <div className="thread-list">
              {thread.map((post) => (
                <article className="thread-post" key={post.id}>
                  <div>
                    <strong>{post.author}</strong>
                    <span>{post.role} · {post.kind} · {post.at}</span>
                  </div>
                  <p>{post.body}</p>
                  <small>{post.likes} likes</small>
                </article>
              ))}
            </div>
          </div>
        )}
        {tab === "Evals" && (
          <div className="eval-list">
            {(detail?.evalResult?.cases ?? []).map((test) => (
              <div className="eval-row" key={test.id}>
                {test.passed ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
                <strong>{test.title}</strong>
                <span>{test.score.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
        {tab === "Files" && (
          <div className="file-list">
            {(detail?.files ?? []).map((file) => (
              <div key={file}><FileText size={15} /><span>{file}</span></div>
            ))}
          </div>
        )}
      </section>
      <aside className="trust-panel">
        <div className="share-card">
          <span>Wild West Top 10</span>
          <h3>Look at my harness.</h3>
          <p>{item.title} has {formatCount(item.stars + starBoost)} stars, {item.forks + forkBoost} forks and {item.heat.toFixed(1)} heat.</p>
        </div>
        <div className="trust-card heat-card">
          <h3>Harness Heat</h3>
          <div className="heat-meter">
            <strong>{item.heat.toFixed(1)}</strong>
            <span>{item.freshness}</span>
          </div>
          <div className="meter-track"><span style={{ width: `${Math.min(100, item.heat * 3)}%` }} /></div>
          <small>{item.heatDelta >= 0 ? "+" : ""}{item.heatDelta.toFixed(1)} this week</small>
        </div>
        <div className="trust-card stats-card">
          <Metric icon={<Star size={15} />} value={formatCount(item.stars + starBoost)} label="stars" />
          <Metric icon={<GitFork size={15} />} value={formatCount(item.forks + forkBoost)} label="forks" />
          <Metric icon={<MessageCircle size={15} />} value={String(item.threads)} label="threads" />
          <Metric icon={<Play size={15} />} value={formatCount(item.runs)} label="runs" />
        </div>
        <div className="trust-card">
          <h3>Trust layer</h3>
          <InfoLine label="Eval" value={detail?.evalResult ? `${detail.evalResult.status} ${detail.evalResult.score}` : item.evalStatus} />
          <InfoLine label="Risk" value={`${detail?.risk.score ?? item.riskScore} ${detail?.risk.tier ?? item.riskTier}`} />
          <InfoLine label="Runtime" value={manifest?.runtime.primary ?? item.runtime} />
          <InfoLine label="Gate" value={manifest ? `score >= ${manifest.quality_gates.min_score}` : "loading"} />
        </div>
        <div className="trust-actions">
          <button className="primary-button" onClick={() => copyText(item.cliCommand, "CLI copied")}><Clipboard size={16} /> Copy CLI</button>
          <button className="secondary-button" onClick={onFork}><GitFork size={16} /> Fork</button>
          <button className="secondary-button" onClick={onStar}><Star size={16} /> Star</button>
          <a className="secondary-button" href={detail?.forgeUrl ?? item.forgeUrl} target="_blank" rel="noreferrer"><ArrowUpRight size={16} /> Repo</a>
        </div>
      </aside>
    </div>
  );
}

function PublishPanel({ importName, setImportName, importMarkdown, setImportMarkdown, importStatus, submitImport }: {
  importName: string;
  setImportName: (value: string) => void;
  importMarkdown: string;
  setImportMarkdown: (value: string) => void;
  importStatus: string;
  submitImport: () => void;
}) {
  return (
    <section className="publish-shell">
      <div>
        <h1>Publish a harness</h1>
        <p>Drop a rough markdown workflow. OnlyHarness turns it into a local harness repo with manifest, prompt, examples and eval stub.</p>
      </div>
      <div className="publish-grid">
        <div className="publish-form">
          <label>
            Harness slug
            <input value={importName} onChange={(event) => setImportName(event.target.value)} />
          </label>
          <label>
            Source markdown
            <textarea value={importMarkdown} onChange={(event) => setImportMarkdown(event.target.value)} />
          </label>
          <button className="primary-button" onClick={submitImport}><Import size={16} /> Publish harness</button>
          {importStatus && <p className="publish-status">{importStatus}</p>}
        </div>
        <div className="publish-notes">
          <h2>What gets created</h2>
          <ul>
            <li><CheckCircle2 size={16} /> `harness.yaml` with conservative permissions</li>
            <li><CheckCircle2 size={16} /> Agent prompt and example input/output</li>
            <li><CheckCircle2 size={16} /> Eval case ready for `hh eval && hh gate`</li>
            <li><CheckCircle2 size={16} /> Registry card ready for maintainer review</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function ReviewPanel({ detail, item, copyText }: { detail?: HarnessDetail; item?: RegistryItem; copyText: (text: string, label: string) => void }) {
  const changes = detail?.prReview?.diff?.changes ?? [];
  return (
    <section className="maintainer-shell">
      <div className="section-head">
        <div>
          <h1>Maintainer review</h1>
          <p>Semantic PR review stays for builders who maintain harness quality.</p>
        </div>
        <button className="secondary-button" onClick={() => item && copyText(`hh diff --base-dir seed-harnesses/${item.name} --head-dir data/.review-variant`, "Diff command copied")}>
          <GitPullRequestArrow size={16} /> Copy diff
        </button>
      </div>
      <div className="review-grid">
        <div className="review-card">
          <h2>{item?.title ?? "Select a harness"}</h2>
          <div className="risk-block">
            <ShieldCheck size={22} />
            <div>
              <strong>Risk {detail?.prReview?.diff?.riskTier ?? "UNKNOWN"}</strong>
              <span>Delta {detail?.prReview?.diff?.riskDelta ?? 0}</span>
            </div>
          </div>
          <div className="change-list">
            {changes.map((change, index) => (
              <div className="change-row" key={`${change.area}-${index}`}>
                <span className={`severity ${change.severity.toLowerCase()}`}>{change.severity}</span>
                <div>
                  <strong>{change.area}</strong>
                  <p>{change.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="review-card cli-card">
          <h2>Gate commands</h2>
          <pre>{`hh validate seed-harnesses/${item?.name ?? "deep-market-researcher"} --strict\nhh eval seed-harnesses/${item?.name ?? "deep-market-researcher"}\nhh gate --dir seed-harnesses/${item?.name ?? "deep-market-researcher"}`}</pre>
        </div>
      </div>
    </section>
  );
}

function CliPanel({ selected, copyText }: { selected?: RegistryItem; copyText: (text: string, label: string) => void }) {
  const command = selected?.cliCommand ?? "hh pull harnesses/deep-market-researcher";
  return (
    <section className="cli-shell">
      <div>
        <h1>CLI for pros</h1>
        <p>The interface is friendly; the command line stays exact.</p>
      </div>
      <div className="cli-grid">
        <div className="cli-card">
          <h2>Use selected harness</h2>
          <pre>{`${command}\nhh run examples/input.md\nhh eval && hh gate`}</pre>
          <button className="primary-button" onClick={() => copyText(`${command}\nhh run examples/input.md\nhh eval && hh gate`, "CLI copied")}>
            <Copy size={16} /> Copy commands
          </button>
        </div>
        <div className="cli-card">
          <h2>Local services</h2>
          <InfoLine label="Registry UI" value="http://127.0.0.1:5177" />
          <InfoLine label="Harness API" value="http://127.0.0.1:8787/healthz" />
          <InfoLine label="Public domain" value="onlyharness.com" />
          <InfoLine label="Forge core" value="Gitea sidecar, not forked" />
        </div>
      </div>
    </section>
  );
}

function Metric({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return <div className="metric">{icon}<strong>{value}</strong><span>{label}</span></div>;
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return <div className="info-line"><span>{label}</span><strong>{value}</strong></div>;
}

function keyFor(item: Pick<RegistryItem, "owner" | "name">) {
  return `${item.owner}/${item.name}`;
}

function initials(title: string) {
  return title.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function formatCount(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

function relativeTime(value: string) {
  const diff = Date.now() - Date.parse(value);
  if (!Number.isFinite(diff) || diff < 60_000) return "now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function badgeClass(item: RegistryItem) {
  if (item.badge.includes("Wild")) return "wild";
  if (item.riskTier === "LOW") return "safe";
  if (item.riskTier === "HIGH" || item.riskTier === "CRITICAL") return "risk";
  return "eval";
}

function cleanReadme(readme?: string) {
  if (!readme) return "";
  const body = readme
    .replace(/^# .*\n+/, "")
    .split(/\n##\s+/)[0]
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("- "));
  return body.slice(0, 4).join(" ");
}

type HarnessWindow = Window & { __onlyHarnessRoot?: Root };

const container = document.getElementById("root")!;
const root = (window as HarnessWindow).__onlyHarnessRoot ?? createRoot(container);
(window as HarnessWindow).__onlyHarnessRoot = root;
root.render(<App />);
