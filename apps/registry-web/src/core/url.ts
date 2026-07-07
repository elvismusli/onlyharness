import type { CheckoutLinkState, RegistryItem } from "./types";

export function parseHarnessHash(hash: string): { owner: string; name: string } | undefined {
  const match = hash.match(/^#\/h\/([^/]+)\/([^/?#]+)(?:\?.*)?$/);
  if (!match) return undefined;
  return {
    owner: decodeURIComponent(match[1]),
    name: decodeURIComponent(match[2])
  };
}

export function parseStorefrontHash(hash: string): { handle: string } | undefined {
  const match = hash.match(/^#\/@([^/?#]+)(?:\?.*)?$/);
  if (!match) return undefined;
  return { handle: decodeURIComponent(match[1]).replace(/^@/, "").toLowerCase() };
}

export function parseCheckoutLocation(pathname: string, search: string): CheckoutLinkState | undefined {
  if (pathname.replace(/\/+$/, "") !== "/checkout") return undefined;
  const params = new URLSearchParams(search);
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

export function keyForCheckout(checkout: CheckoutLinkState): string {
  return [
    encodeURIComponent(checkout.owner),
    encodeURIComponent(checkout.repo),
    encodeURIComponent(checkout.providerRef || checkout.version || "latest")
  ].join("/");
}

export function setHarnessHash(item: RegistryItem) {
  const next = `#/h/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.name)}`;
  if (window.location.hash === next) return;
  window.history.replaceState(null, "", next);
}

export function refFromLocation(search: string, hash: string): string | undefined {
  const queryRef = new URLSearchParams(search).get("ref");
  if (queryRef) return queryRef;
  const hashQuery = hash.split("?")[1];
  return hashQuery ? new URLSearchParams(hashQuery).get("ref") ?? undefined : undefined;
}

export function initialRefCode(): string {
  return (
    refFromLocation(window.location.search, window.location.hash) ??
    localStorage.getItem("onlyharness.ref") ??
    ""
  );
}
