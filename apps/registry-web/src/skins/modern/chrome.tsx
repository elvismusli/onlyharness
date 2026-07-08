import { useEffect } from "react";

import { useHarness } from "../../core/store";
import type { DialogSpec } from "../../core/types";
import { Btn } from "./primitives";

/**
 * Neutral Modern chrome — the skin-agnostic `useHarness()` chrome state rendered
 * in the Modern idiom so remix/logoff/copy interactions are actually visible
 * here (the Win98 skin renders the same state as 98-style dialogs):
 *
 * - `dialog` → a scrim + surface card modal with an OK (running `dialog.onOk`)
 *   and an optional Cancel. Escape / scrim-click / OK all close it.
 * - `copyFallback` → the clipboard-unavailable modal with a readonly textarea the
 *   user can select + copy manually; dismiss calls `dismissFallback`.
 * - `flash` → a small bottom toast.
 *
 * Rendered once, above the surface router, so it overlays every Modern surface.
 */
export function ModernChrome() {
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
        <div className="ohc-scrim" role="presentation" onClick={h.closeDialog}>
          <div
            className={h.dialog.resourceUse ? "ohc-modal ohc-modal-wide" : "ohc-modal"}
            role="dialog"
            aria-modal="true"
            aria-label={h.dialog.title}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="ohc-modal-head">
              {h.dialog.icon && <span className="ohc-modal-icon" aria-hidden>{h.dialog.icon}</span>}
              <h2 className="ohc-modal-title">{h.dialog.title}</h2>
            </div>
            {h.dialog.resourceUse ? (
              <ModernResourceUse
                resourceUse={h.dialog.resourceUse}
                copiedTag={h.copiedTag}
                onCopy={(value, label, tag) => h.copyText(value, label, tag)}
              />
            ) : (
              <p className="ohc-modal-body">{h.dialog.body}</p>
            )}
            <div className="ohc-modal-actions">
              {h.dialog.onOk ? (
                <>
                  <Btn variant="ghost" onClick={h.closeDialog}>Cancel</Btn>
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
        <div className="ohc-scrim" role="presentation" onClick={h.dismissFallback}>
          <div
            className="ohc-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Copy manually"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="ohc-modal-head">
              <span className="ohc-modal-icon" aria-hidden>📋</span>
              <h2 className="ohc-modal-title">Copy manually</h2>
            </div>
            <p className="ohc-modal-body">{h.copyFallback.label}</p>
            <textarea
              className="ohc-fallback"
              readOnly
              value={h.copyFallback.text}
              onFocus={(event) => event.currentTarget.select()}
              autoFocus
            />
            <div className="ohc-modal-actions">
              <Btn variant="primary" onClick={h.dismissFallback}>Done</Btn>
            </div>
          </div>
        </div>
      )}

      {h.flash && (
        <div className="ohc-toast" role="status" aria-live="polite">
          {h.flash}
        </div>
      )}
    </>
  );
}

function ModernResourceUse({ resourceUse, copiedTag, onCopy }: {
  resourceUse: NonNullable<DialogSpec["resourceUse"]>;
  copiedTag: string;
  onCopy: (value: string, label: string, tag: string) => void;
}) {
  return (
    <div className="ohc-resource-use">
      {resourceUse.note && <p className="ohc-resource-note">{resourceUse.note}</p>}
      <div className="ohc-resource-list">
        {resourceUse.rows.map((row) => {
          const copyable = !row.muted;
          return (
            <div className="ohc-resource-row" key={row.label}>
              <span className="ohc-resource-label">{row.label}</span>
              <code className={row.muted ? "ohc-resource-value muted" : "ohc-resource-value"}>{row.value}</code>
              <Btn
                variant="secondary"
                size="sm"
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
