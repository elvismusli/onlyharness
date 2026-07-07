import { useState } from "react";

import { apiUrl } from "./constants";
import type { OrgWorkspace, RegistryItem } from "./types";

export type UseOrgWorkspaceOptions = {
  /** Merge the org's private harnesses into the shared registry cache. */
  cacheItems: (items: RegistryItem[]) => void;
  onFlash?: (msg: string) => void;
};

export type UseOrgWorkspaceResult = {
  networkOrg: string;
  setNetworkOrg: (value: string) => void;
  networkToken: string;
  setNetworkToken: (value: string) => void;
  networkStatus: string;
  networkBusy: boolean;
  orgWorkspace: OrgWorkspace | undefined;
  loadOrgWorkspace: () => Promise<void>;
  orgHeadersForOwner: (owner: string) => Record<string, string>;
};

/**
 * Skin-agnostic organization / Network-Neighborhood logic extracted from the
 * Win98 `App()`.
 *
 * Owns the org connection form state (`networkOrg`, initialised from
 * `localStorage`, plus `networkToken`), the request status/busy flags
 * (`networkStatus`, `networkBusy`), and the loaded workspace (`orgWorkspace`).
 * `loadOrgWorkspace` fetches `/orgs/{slug}/workspace` with the org bearer token
 * (`networkToken`, NOT the auth access token), persists the resolved slug, and
 * merges the org-private items into the registry via injected `cacheItems`.
 * `orgHeadersForOwner` supplies the same org bearer header to the registry when
 * a request owner matches the connected org slug. Endpoints, status strings and
 * error handling are preserved exactly from the host component.
 */
export function useOrgWorkspace(opts: UseOrgWorkspaceOptions): UseOrgWorkspaceResult {
  const { cacheItems } = opts;

  const [networkOrg, setNetworkOrg] = useState(() => localStorage.getItem("hh:networkOrg") ?? "acme");
  const [networkToken, setNetworkToken] = useState("");
  const [networkStatus, setNetworkStatus] = useState("");
  const [networkBusy, setNetworkBusy] = useState(false);
  const [orgWorkspace, setOrgWorkspace] = useState<OrgWorkspace | undefined>();

  function orgHeadersForOwner(owner: string): Record<string, string> {
    const slug = owner.startsWith("@") ? owner.slice(1) : "";
    if (!slug || slug !== networkOrg.replace(/^@/, "").trim().toLowerCase() || !networkToken) return {};
    return { Authorization: `Bearer ${networkToken}` };
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
      cacheItems(workspace.items ?? []);
      setNetworkStatus(`Loaded ${workspace.items.length} private harnesses · ${workspace.audit.length} audit rows`);
    } catch (error) {
      setNetworkStatus(error instanceof Error ? error.message : "Org workspace failed");
    } finally {
      setNetworkBusy(false);
    }
  }

  return {
    networkOrg,
    setNetworkOrg,
    networkToken,
    setNetworkToken,
    networkStatus,
    networkBusy,
    orgWorkspace,
    loadOrgWorkspace,
    orgHeadersForOwner
  };
}
