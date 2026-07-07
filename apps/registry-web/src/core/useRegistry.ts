import { useEffect, useMemo, useState } from "react";

import { apiUrl, JOB_FILTERS } from "./constants";
import { keyFor } from "./format";
import type { HarnessDetail, RegistryItem, ResourceItem } from "./types";
import type { ResourceTab } from "./resource-tabs";

export type ResourceCounts = { externalSeed: number; internal: number; total: number };

const EMPTY_STARRED: Record<string, boolean> = {};

/**
 * Skin-agnostic registry/resource data logic extracted from the Win98 `App()`.
 *
 * Owns the discovery data (`allItems`, `resourceItems`, `leaderboard`), the
 * per-harness detail cache (`details`), the `knownItems` deep-link lookup cache,
 * and the discovery query controls (`query`, `sort`, `jobFilter`, `resourceTab`,
 * `refreshTick`). The three fetch effects, `loadDetail`, and the derived
 * projections (`items`, `visibleResources`, `jobs`, `totals`, `topItem`,
 * `leader`) all live here.
 *
 * Only registry/resource data lives here. Social state (`starred`) and org
 * headers (`orgHeadersForOwner`) extract in later tasks, so they are injected
 * via `opts`: `items`/`jobs`/`totals` read `opts.starred ?? {}` for the starred
 * filter, starred job count, and the +1-per-star totals bonus, and `loadDetail`
 * takes its request headers from `opts.orgHeadersForOwner`.
 */
export function useRegistry(opts?: {
  starred?: Record<string, boolean>;
  orgHeadersForOwner?: (owner: string) => Record<string, string>;
}) {
  const starred = opts?.starred ?? EMPTY_STARRED;

  const [allItems, setAllItems] = useState<RegistryItem[]>([]);
  const [resourceItems, setResourceItems] = useState<ResourceItem[]>([]);
  const [resourceCounts, setResourceCounts] = useState<ResourceCounts>({ externalSeed: 0, internal: 0, total: 0 });
  const [resourceTab, setResourceTab] = useState<ResourceTab>("All");
  const [leaderboard, setLeaderboard] = useState<RegistryItem[]>([]);
  const [details, setDetails] = useState<Record<string, HarnessDetail>>({});
  const [knownItems, setKnownItems] = useState<Record<string, RegistryItem>>({});
  const [query, setQuery] = useState("");
  const [jobFilter, setJobFilter] = useState("all");
  const [sort, setSort] = useState("trending");
  const [refreshTick, setRefreshTick] = useState(0);

  /* ---------- effects ---------- */

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

  const jobs = useMemo(() => computeJobs(allItems, starred), [allItems, starred]);

  const totals = useMemo(() => computeTotals(allItems, starred), [allItems, starred]);

  const leader = leaderboard[0];
  const topItem = items[0] ?? allItems[0] ?? leader;

  /* ---------- helpers ---------- */

  function cacheItem(item: RegistryItem) {
    const key = keyFor(item);
    setKnownItems((current) => (current[key] ? current : { ...current, [key]: item }));
  }

  function cacheItems(list: RegistryItem[]) {
    setKnownItems((current) => {
      const next = { ...current };
      for (const item of list) next[keyFor(item)] = item;
      return next;
    });
  }

  function prependItem(item: RegistryItem) {
    const key = keyFor(item);
    setKnownItems((current) => ({ ...current, [key]: item }));
    setAllItems((current) => [item, ...current.filter((entry) => keyFor(entry) !== key)]);
  }

  function loadDetail(item: RegistryItem) {
    const key = keyFor(item);
    if (!details[key]) {
      fetch(`${apiUrl}/repos/${item.owner}/${item.name}/harness`, {
        headers: opts?.orgHeadersForOwner?.(item.owner) ?? {}
      })
        .then((response) => response.json())
        .then((data) => setDetails((current) => ({ ...current, [key]: data })))
        .catch(() => undefined);
    }
  }

  function bumpRefresh() {
    setRefreshTick((tick) => tick + 1);
  }

  function refresh() {
    setDetails({});
    setRefreshTick((tick) => tick + 1);
  }

  return {
    allItems,
    resourceItems,
    resourceCounts,
    resourceTab,
    setResourceTab,
    leaderboard,
    details,
    knownItems,
    query,
    setQuery,
    jobFilter,
    setJobFilter,
    sort,
    setSort,
    items,
    visibleResources,
    jobs,
    totals,
    leader,
    topItem,
    cacheItem,
    cacheItems,
    prependItem,
    loadDetail,
    bumpRefresh,
    refresh
  };
}

/* ---------- pure derivations (exported for unit tests) ---------- */

export function computeJobs(allItems: RegistryItem[], starred: Record<string, boolean>): Array<{ label: string; count: number }> {
  const counts = JOB_FILTERS.map((label) => ({ label, count: allItems.filter((item) => item.job === label || item.outcome === label).length }));
  return [...counts, { label: "starred", count: allItems.filter((item) => starred[keyFor(item)]).length }];
}

export function computeTotals(allItems: RegistryItem[], starred: Record<string, boolean>): { stars: number; forks: number; threads: number; indexed: number } {
  return {
    stars: allItems.reduce((sum, item) => sum + item.stars + (starred[keyFor(item)] ? 1 : 0), 0),
    forks: allItems.reduce((sum, item) => sum + item.forks, 0),
    threads: allItems.reduce((sum, item) => sum + item.threads, 0),
    indexed: allItems.length
  };
}
