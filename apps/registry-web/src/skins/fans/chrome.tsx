import { useEffect } from "react";

import { useHarness } from "../../core/store";
import type { DialogSpec } from "../../core/types";
import { Btn } from "./primitives";

/**
 * Fans chrome — the skin-agnostic `useHarness()` chrome state rendered in the
 * Fans idiom (soft blue-tinted modals + a friendly toast) so remix / logoff /
 * copy interactions are actually visible on the Fans page:
 *
 * - `dialog` → a scrim + white rounded modal with an OK (running `dialog.onOk`)
 *   and an optional Cancel. Escape / scrim-click / OK all close it.
 * - `copyFallback` → the clipboard-unavailable modal with a readonly textarea the
 *   user can select + copy manually; dismiss calls `dismissFallback`.
 * - `flash` → a small bottom toast.
 *
 * Rendered once at the skin root so it overlays every Fans surface.
 */
export function FansChrome() {
  const h = useHarness();

  /* Escape closes whichever overlay is up (dialog first, then fallback). */
  useEffect(() => {
    if (!h.dialog && !h.copyFallback) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (h.dialog) h.closeDialog();
      else if (h.copyFallback) h.dismissFallback();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [h.dialog, h.copyFallback, h]);

  return (
    <>
      {h.dialog && (
        <div className="fac-scrim" role="presentation" onClick={h.closeDialog}>
          <div
            className={h.dialog.resourceUse ? "fac-modal fac-modal-wide" : "fac-modal"}
            role="dialog"
            aria-modal="true"
            aria-label={h.dialog.title}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="fac-modal-head">
              {h.dialog.icon && <span className="fac-modal-icon" aria-hidden>{h.dialog.icon}</span>}
              <h2 className="fac-modal-title">{h.dialog.title}</h2>
            </div>
            {h.dialog.resourceUse ? (
              <FansResourceUse
                resourceUse={h.dialog.resourceUse}
                copiedTag={h.copiedTag}
                onCopy={(value, label, tag) => h.copyText(value, label, tag)}
              />
            ) : (
              <p className="fac-modal-body">{h.dialog.body}</p>
            )}
            <div className="fac-modal-actions">
              {h.dialog.onOk ? (
                <>
                  <Btn variant="outline" onClick={h.closeDialog}>Cancel</Btn>
                  <Btn variant="primary" onClick={() => { h.dialog?.onOk?.(); h.closeDialog(); }}>OK</Btn>
                </>
              ) : (
                <Btn variant="primary" onClick={h.closeDialog}>OK</Btn>
              )}
            </div>
          </div>
        </div>
      )}

      {h.copyFallback && (
        <div className="fac-scrim" role="presentation" onClick={h.dismissFallback}>
          <div
            className="fac-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Copy manually"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="fac-modal-head">
              <span className="fac-modal-icon" aria-hidden>📋</span>
              <h2 className="fac-modal-title">Copy manually</h2>
            </div>
            <p className="fac-modal-body">{h.copyFallback.label}</p>
            <textarea
              className="fac-fallback"
              readOnly
              value={h.copyFallback.text}
              onFocus={(event) => event.currentTarget.select()}
              autoFocus
            />
            <div className="fac-modal-actions">
              <Btn variant="primary" onClick={h.dismissFallback}>Done</Btn>
            </div>
          </div>
        </div>
      )}

      {h.flash && (
        <div className="fac-toast" role="status" aria-live="polite">
          {h.flash}
        </div>
      )}
    </>
  );
}

function FansResourceUse({ resourceUse, copiedTag, onCopy }: {
  resourceUse: NonNullable<DialogSpec["resourceUse"]>;
  copiedTag: string;
  onCopy: (value: string, label: string, tag: string) => void;
}) {
  return (
    <div className="fac-resource-use">
      {resourceUse.note && <p className="fac-resource-note">{resourceUse.note}</p>}
      <div className="fac-resource-list">
        {resourceUse.rows.map((row) => {
          const copyable = !row.muted;
          return (
            <div className="fac-resource-row" key={row.label}>
              <span className="fac-resource-label">{row.label}</span>
              <code className={row.muted ? "fac-resource-value muted" : "fac-resource-value"}>{row.value}</code>
              <Btn
                variant="outline"
                disabled={!copyable}
                onClick={() => copyable && onCopy(row.value, row.copyLabel, row.copyTag)}
              >
                {copiedTag === row.copyTag ? "Copied" : "Copy"}
              </Btn>
            </div>
          );
        })}
      </div>
    </div>
  );
}
