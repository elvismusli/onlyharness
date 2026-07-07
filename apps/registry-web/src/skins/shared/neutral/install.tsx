import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { compatibilityTargetsFor, targetDetail, targetLabel, targetTone } from "../../../core/compat";
import { apiUrl } from "../../../core/constants";
import { fmtContextCost, keyFor } from "../../../core/format";
import { useHarness } from "../../../core/store";
import type { CheckoutSession, CompatibilityTarget, HarnessDetail, HarnessPricing, RegistryItem } from "../../../core/types";

/*
 * Shared-neutral Install Center. This is the "serious" install surface rendered
 * identically in every skin (only the `--neutral-*` palette changes). It mirrors
 * the Win98 `InstallBody` field-for-field — the six install-target tabs, per-tab
 * setup <pre> + copy, the manual-checkout payment box, compatibility targets and
 * the trust sidebar — restyled onto the self-contained `.oh-neutral` token set.
 *
 * Pure consumer of `useHarness()`: the harness (`knownItems[key]`) and its detail
 * (`details[key]`, for pricing/version) come from the store, as do `copyText`,
 * `copiedTag`, `accessToken`, `refCode`, `recordHarnessEvent`, `openLogon`, `user`.
 * Directory ("link-only") harnesses drop the install/checkout loop for an
 * open-upstream shelf.
 */

const INSTALL_TABS = ["Claude Code", "Codex", "Cursor", "MCP", "CLI", "GitHub"] as const;
type InstallTab = (typeof INSTALL_TABS)[number];
const LOCAL_HH = "node packages/harness-cli/dist/hh.mjs";

/** One label/value line in a neutral trust box (mono value, hairline rows). */
function InfoLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="ohn-info">
      <span className="ohn-info-k">{label}</span>
      <span className="ohn-info-v">{value}</span>
    </div>
  );
}

export function NeutralInstall({ surfaceKey }: { surfaceKey?: string }) {
  const h = useHarness();
  const item = surfaceKey ? h.knownItems[surfaceKey] : undefined;
  const detail = item ? h.details[keyFor(item)] : undefined;

  const [tab, setTab] = useState<InstallTab>("Claude Code");
  const [checkout, setCheckout] = useState<CheckoutSession | undefined>();
  const [checkoutStatus, setCheckoutStatus] = useState("");
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  const target = item ? `${item.owner}/${item.name}` : "";
  const isDirectory = item?.contentType === "directory";
  const directoryUrl = item?.directory?.url ?? item?.forgeUrl;
  const shownSetup = installSetup(tab, item);
  const archive = item && isDirectory
    ? directoryUrl ?? "open <upstream-url>"
    : item
      ? `curl -s https://onlyharness.com/api/repos/${target}/archive`
      : "";
  const targets: CompatibilityTarget[] = compatibilityTargetsFor(item, detail);
  const pricing = detail?.manifest?.pricing;
  const paymentState = paymentSummary(item, detail);
  const installTarget = installTargetForTab(tab);
  const retryCommand = item ? `HH_TOKEN=<token> ${LOCAL_HH} install ${target} --target ${installTarget} --json` : "";

  const copied = h.copiedTag === "neutral-install";
  const paidCopied = h.copiedTag === "neutral-paid-install";

  /* reset the checkout panel whenever the selected harness changes */
  useEffect(() => {
    setCheckout(undefined);
    setCheckoutStatus("");
    setCheckoutBusy(false);
  }, [target]);

  function onCopy(text: string, evtTarget: string, tag: string) {
    if (item) h.recordHarnessEvent("copy", item, evtTarget);
    void h.copyText(text, "Install commands copied", tag);
  }

  // TODO: extract to core/useCheckout and dedupe with win98 InstallBody
  async function createCheckout() {
    if (!item || !pricing || isDirectory || pricing.model === "free") return;
    if (!h.accessToken) {
      h.openLogon("Log on to create a checkout session.");
      return;
    }
    setCheckoutBusy(true);
    setCheckoutStatus("");
    try {
      const response = await fetch(`${apiUrl}/billing/checkout`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${h.accessToken}`
        },
        body: JSON.stringify({
          owner: item.owner,
          repo: item.name,
          version: detail?.manifest?.version,
          ...(h.refCode ? { ref: h.refCode } : {})
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Checkout failed (${response.status})`);
      setCheckout(data as CheckoutSession);
      setCheckoutStatus("Checkout session created.");
    } catch (error) {
      setCheckoutStatus(error instanceof Error ? error.message : "Checkout failed");
    } finally {
      setCheckoutBusy(false);
    }
  }

  return (
    <div className="oh-neutral">
      <header className="ohn-head">
        <div className="ohn-owner">{isDirectory ? "Directory Shelf" : "Install Center"}</div>
        <h2 className="ohn-title">{item?.title ?? "Pick a harness"}</h2>
        <p className="ohn-promise">{item?.summary ?? "No harness selected."}</p>
      </header>

      {isDirectory ? (
        /* ---------- directory: link-only shelf (no run/eval/gate/checkout) ---------- */
        <div className="ohn-grid">
          <div className="ohn-col">
            <section className="ohn-box">
              <h4 className="ohn-box-title">Directory link</h4>
              <div className="ohn-shelf">
                <pre className="ohn-pre">{shownSetup}</pre>
                <div className="ohn-btnrow">
                  {directoryUrl && (
                    <a className="ohn-btn ohn-btn-primary" href={directoryUrl} target="_blank" rel="noreferrer">
                      Open directory ↗
                    </a>
                  )}
                  <button type="button" className="ohn-btn ohn-btn-secondary" disabled={!item} onClick={() => onCopy(archive, "archive", "neutral-install")}>
                    {copied ? "✓ Copied" : "Copy directory URL"}
                  </button>
                </div>
              </div>
            </section>

            <section className="ohn-box">
              <h4 className="ohn-box-title">Review before import</h4>
              <div className="ohn-targets">
                {targets.map((targetInfo) => (
                  <div className="ohn-target" key={targetLabel(targetInfo)}>
                    <span className={`ohn-badge ${targetTone(targetInfo)}`}>{targetInfo.status}</span>
                    <span><b>{targetLabel(targetInfo)}</b> · {targetDetail(targetInfo)}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside className="ohn-aside">
            <section className="ohn-box">
              <h4 className="ohn-box-title">Trust before import</h4>
              <InfoLine label="Content" value="link-only directory" />
              <InfoLine label="Standard" value={item?.standard ?? "select a harness"} />
              <InfoLine label="Source" value={directoryUrl ?? "upstream URL unavailable"} />
              {item?.directory?.itemCount !== undefined && <InfoLine label="Entries" value={String(item.directory.itemCount)} />}
            </section>
            <p className="ohn-fine">Directory entries are discovery indexes, not runnable harnesses. Review upstream source and licensing before importing anything.</p>
          </aside>
        </div>
      ) : (
        /* ---------- harness: install targets + payment + compatibility ---------- */
        <div className="ohn-grid">
          <div className="ohn-col">
            <section className="ohn-box">
              <div className="ohn-tabs" role="tablist">
                {INSTALL_TABS.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    role="tab"
                    aria-selected={entry === tab}
                    className="ohn-tab"
                    data-active={entry === tab ? "" : undefined}
                    onClick={() => setTab(entry)}
                  >
                    {entry}
                  </button>
                ))}
              </div>
              <h4 className="ohn-box-title" style={{ margin: "12px 0" }}>{tab} setup</h4>
              <pre className="ohn-pre">{shownSetup}</pre>
              <div className="ohn-btnrow">
                <button type="button" className="ohn-btn ohn-btn-primary" disabled={!item} onClick={() => onCopy(shownSetup, tab.toLowerCase().replaceAll(" ", "-"), "neutral-install")}>
                  {copied ? "✓ Copied" : "Copy shown setup"}
                </button>
                <button type="button" className="ohn-btn ohn-btn-secondary" disabled={!item} onClick={() => onCopy(archive, "archive", "neutral-install")}>
                  Copy archive curl
                </button>
              </div>
            </section>

            <section className="ohn-box">
              <h4 className="ohn-box-title">Payment</h4>
              <InfoLine label="State" value={paymentState.state} />
              <InfoLine label="Price" value={paymentState.price} />
              <InfoLine label="Provider" value={paymentState.provider} />
              {paymentState.canCheckout ? (
                <div className="ohn-pay-actions">
                  <button type="button" className="ohn-btn ohn-btn-primary" disabled={checkoutBusy} onClick={createCheckout}>
                    {checkoutBusy ? "⌛ Creating…" : h.accessToken ? "Create manual checkout" : "Log on for checkout"}
                  </button>
                  {checkout && (
                    <button type="button" className="ohn-btn ohn-btn-mono" onClick={() => onCopy(retryCommand, "paid-install", "neutral-paid-install")}>
                      {paidCopied ? "✓ Copied" : "Copy paid install"}
                    </button>
                  )}
                </div>
              ) : (
                <div className="ohn-note">{paymentState.next}</div>
              )}
              {checkout && (
                <div className="ohn-session">
                  <InfoLine label="Status" value={checkout.status} />
                  <InfoLine label="Provider ref" value={checkout.provider_ref} />
                  <a className="ohn-session-link" href={checkout.checkout_url} target="_blank" rel="noreferrer">{checkout.checkout_url}</a>
                  <div className="ohn-note">{checkout.next}</div>
                </div>
              )}
              {checkoutStatus && (
                <p className={`ohn-status${checkoutStatus.toLowerCase().includes("fail") ? " is-error" : ""}`}>{checkoutStatus}</p>
              )}
            </section>

            <section className="ohn-box">
              <h4 className="ohn-box-title">Compatibility targets</h4>
              <div className="ohn-targets">
                {targets.map((targetInfo) => (
                  <div className="ohn-target" key={targetLabel(targetInfo)}>
                    <span className={`ohn-badge ${targetTone(targetInfo)}`}>{targetInfo.status}</span>
                    <span><b>{targetLabel(targetInfo)}</b> · {targetDetail(targetInfo)}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside className="ohn-aside">
            <section className="ohn-box">
              <h4 className="ohn-box-title">Trust before install</h4>
              <InfoLine label="Eval" value={item ? `${item.evalScore ? item.evalScore.toFixed(2) : "unknown"} (${item.evalStatus})` : "select a harness"} />
              <InfoLine label="Risk" value={item ? `${item.riskTier} (${item.riskScore})` : "select a harness"} />
              <InfoLine label="Context" value={item ? fmtContextCost(item.contextCost) : "select a harness"} />
              <InfoLine label="Standard" value={item?.standard ?? "select a harness"} />
            </section>
            <p className="ohn-fine">Adapter files are local instructions. Run eval and gate before real use.</p>
          </aside>
        </div>
      )}
    </div>
  );
}

function installSetup(tab: InstallTab, item?: RegistryItem): string {
  if (!item) return "Select a harness to generate install commands.";
  const target = `${item.owner}/${item.name}`;
  const isDirectory = item.contentType === "directory";
  const directoryUrl = item.directory?.url ?? item.forgeUrl;
  if (isDirectory) return `open ${directoryUrl ?? "<upstream-url>"}\n# Link-only directory. Review upstream source and licensing before importing entries.`;
  const build = ["# npm package pending; build the local CLI first:", "npm run build -w onlyharness"];
  if (tab === "MCP") {
    return [
      ...build,
      `${LOCAL_HH} install ${target} --target cli --json`,
      `${LOCAL_HH} mcp-config ${item.name} --target claude-desktop --out mcp.json`,
      "claude mcp add --transport http onlyharness https://onlyharness.com/mcp",
      `# For registry pulls, call pull_harness with { "owner": "${item.owner}", "name": "${item.name}" }`
    ].join("\n");
  }
  if (tab === "GitHub") {
    return [
      `curl -s https://onlyharness.com/api/repos/${target}/archive > ${item.name}.archive.json`,
      "# Write files[] from the archive JSON into a harness directory.",
      "# Maintainers can publish verified git repos after eval/gate:",
      `${LOCAL_HH} publish git@github.com:acme/harnesses.git --path harnesses/${item.name} --name ${item.name} --json`
    ].join("\n");
  }
  const installTarget = installTargetForTab(tab);
  return [
    ...build,
    `${LOCAL_HH} install ${target} --target ${installTarget} --json`,
    `${LOCAL_HH} run ${item.name} --json`,
    `${LOCAL_HH} eval ${item.name} --json`,
    `${LOCAL_HH} gate --dir ${item.name} --json`
  ].join("\n");
}

function installTargetForTab(tab: InstallTab): "claude-code" | "codex" | "cursor" | "cli" {
  if (tab === "Claude Code") return "claude-code";
  if (tab === "Codex") return "codex";
  if (tab === "Cursor") return "cursor";
  return "cli";
}

function paymentSummary(item: RegistryItem | undefined, detail: HarnessDetail | undefined): { state: string; price: string; provider: string; canCheckout: boolean; next: string } {
  if (!item) return { state: "select a harness", price: "n/a", provider: "manual", canCheckout: false, next: "Select a harness first." };
  const pricing = detail?.manifest?.pricing;
  if (!pricing) return { state: "loading", price: "loading", provider: "manual", canCheckout: false, next: "Loading payment metadata." };
  if (pricing.model === "per_call") {
    return { state: "hosted unavailable", price: formatPrice(pricing), provider: "none", canCheckout: false, next: "Hosted execution is not live yet; checkout is disabled for per-call pricing." };
  }
  if (!pricing.model || pricing.model === "free") {
    return { state: "free", price: "free", provider: "none", canCheckout: false, next: "No checkout required." };
  }
  return { state: pricing.model, price: formatPrice(pricing), provider: "manual", canCheckout: true, next: "Create a manual checkout session, then retry install with HH_TOKEN after entitlement." };
}

function formatPrice(pricing: HarnessPricing): string {
  if (pricing.model === "free") return "free";
  const amount = pricing.amount_usd;
  if (typeof amount !== "number" || !Number.isFinite(amount)) return pricing.model ?? "unknown";
  return `${pricing.currency ?? "USD"} ${amount.toFixed(2)}${pricing.model ? ` · ${pricing.model}` : ""}`;
}
