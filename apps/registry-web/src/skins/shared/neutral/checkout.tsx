import type { ReactNode } from "react";

import { apiUrl } from "../../../core/constants";
import { useHarness } from "../../../core/store";

/*
 * Shared-neutral Manual Checkout handoff — the "serious" money surface rendered
 * identically in every skin (only the `--neutral-*` palette changes). Mirrors the
 * Win98 `CheckoutBody` field-for-field: the empty "Checkout link unavailable"
 * state, the pending / needs-checkout header tags, the Payment-handoff box
 * (Harness / Version / Status / Provider ref + operator-settled note + Open
 * Install Center + Copy retry command), and a right panel with the retry-command
 * <pre> plus a read-only receipt-check <pre>.
 *
 * Pure consumer of `useHarness()`: the deep-linked checkout link comes from
 * `checkoutLinks[surface.key]`, the harness + its version resolve via
 * `knownItems`/`details`, and `refCode`, `copyText`/`copiedTag`, `openInstall`
 * drive the header/actions. This page never unlocks files — it only hands off to
 * the operator-settled manual-payment flow. `apiUrl` builds the receipt read.
 */

const LOCAL_HH = "node packages/harness-cli/dist/hh.mjs";

/** One label/value line in a neutral box (mono value, hairline rows). */
function InfoLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="ohn-info">
      <span className="ohn-info-k">{label}</span>
      <span className="ohn-info-v">{value}</span>
    </div>
  );
}

export function NeutralCheckout({ surfaceKey }: { surfaceKey?: string }) {
  const h = useHarness();
  const checkout = surfaceKey ? h.checkoutLinks[surfaceKey] : undefined;
  const harnessKey = checkout ? `${checkout.owner}/${checkout.repo}` : undefined;
  const item = harnessKey ? h.knownItems[harnessKey] : undefined;
  const detail = harnessKey ? h.details[harnessKey] : undefined;

  const copied = h.copiedTag === "neutral-checkout-retry";

  if (!checkout) {
    return (
      <div className="oh-neutral">
        <header className="ohn-head">
          <div className="ohn-owner">Manual Checkout</div>
          <h2 className="ohn-title">Checkout link unavailable</h2>
          <p className="ohn-promise">Open a checkout URL with owner, repo and provider_ref query parameters.</p>
        </header>
        <div className="ohn-empty">
          Manual checkout is reached from a <code>/checkout?owner=…&amp;repo=…&amp;provider_ref=…</code> deep-link or a
          checkout session created in the Install Center. This page does not unlock files.
        </div>
      </div>
    );
  }

  const target = `${checkout.owner}/${checkout.repo}`;
  const version = checkout.version ?? detail?.manifest?.version ?? "latest";
  const hasProviderRef = Boolean(checkout.providerRef);
  const retryCommand = `HH_TOKEN=<token> ${LOCAL_HH} install ${target}${version && version !== "latest" ? ` --version ${version}` : ""} --json`;
  const receiptCommand = checkout.providerRef
    ? `curl -H "Authorization: Bearer <HH_TOKEN>" "${apiUrl.replace(/\/$/, "")}/billing/receipt?provider_ref=${encodeURIComponent(checkout.providerRef)}"`
    : "";

  function copyRetry() {
    void h.copyText(retryCommand, "Retry command copied", "neutral-checkout-retry");
  }

  return (
    <div className="oh-neutral">
      <header className="ohn-head">
        <div className="ohn-owner">Manual Checkout</div>
        <h2 className="ohn-title">{hasProviderRef ? "Manual checkout pending" : "Manual checkout required"}</h2>
        <p className="ohn-promise">
          {hasProviderRef
            ? `${item?.title ?? target} is waiting for manual provider confirmation. This page does not unlock files.`
            : `${item?.title ?? target} needs a checkout session before manual payment. This page does not unlock files.`}
        </p>
        <div className="ohn-tagrow">
          <span className="ohn-tag warn">{hasProviderRef ? "pending" : "needs checkout"}</span>
          <span className="ohn-tag">manual provider</span>
          {h.refCode && <span className="ohn-tag safe">ref {h.refCode}</span>}
        </div>
      </header>

      <div className="ohn-grid">
        <div className="ohn-col">
          <section className="ohn-box">
            <h4 className="ohn-box-title">Payment handoff</h4>
            <InfoLine label="Harness" value={target} />
            <InfoLine label="Version" value={version} />
            <InfoLine label="Status" value={hasProviderRef ? "pending" : "not created"} />
            <InfoLine label="Provider ref" value={checkout.providerRef ?? "missing"} />
            <div className="ohn-note">
              {hasProviderRef
                ? "Manual checkout is operator-settled. Entitlement appears only after the payment webhook marks this provider ref paid."
                : "Open Install Center, log on, and create a manual checkout session before sending payment."}
            </div>
            <div className="ohn-pay-actions">
              <button type="button" className="ohn-btn ohn-btn-primary" disabled={!item} onClick={() => h.openInstall(item)}>
                Open Install Center
              </button>
              <button type="button" className="ohn-btn ohn-btn-mono" onClick={copyRetry}>
                {copied ? "✓ Copied" : "Copy retry command"}
              </button>
            </div>
          </section>
        </div>

        <aside className="ohn-aside">
          <section className="ohn-box">
            <h4 className="ohn-box-title">Retry after entitlement</h4>
            <pre className="ohn-pre">{retryCommand}</pre>
          </section>
          {receiptCommand && (
            <section className="ohn-box">
              <h4 className="ohn-box-title">Read-only receipt check</h4>
              <pre className="ohn-pre">{receiptCommand}</pre>
            </section>
          )}
          <p className="ohn-fine">Receipt reads status only. It never settles payment or grants access.</p>
        </aside>
      </div>
    </div>
  );
}
