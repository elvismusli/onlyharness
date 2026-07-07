import { useRef, useState } from "react";

type CopyFallback = { label: string; text: string };

export type UseClipboardResult = {
  copyText: (text: string, label: string, tag?: string) => void;
  copiedTag: string;
  copyFallback: CopyFallback | null;
  dismissFallback: () => void;
};

/**
 * Skin-agnostic clipboard logic extracted from the Win98 `App()`.
 *
 * Owns the `copiedTag` "just copied" flash tag (auto-clears after 1.6s) and the
 * `copyFallback` state that drives the clipboard-unavailable modal. On a
 * successful copy it invokes `opts.onFlash(label)` so the host skin can surface
 * its own toast; the fallback notice is flashed the same way.
 */
export function useClipboard(opts?: { onFlash?: (msg: string) => void }): UseClipboardResult {
  const [copiedTag, setCopiedTag] = useState("");
  const [copyFallback, setCopyFallback] = useState<CopyFallback | null>(null);
  const copiedTimer = useRef(0);

  function markCopied(tag: string) {
    setCopiedTag(tag);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopiedTag(""), 1600);
  }

  async function copyText(text: string, label: string, tag = "") {
    try {
      await writeClipboard(text);
      opts?.onFlash?.(label);
      if (tag) markCopied(tag);
    } catch {
      setCopyFallback({ label, text });
      opts?.onFlash?.("Clipboard unavailable — command shown");
    }
  }

  async function writeClipboard(text: string) {
    if (copyWithSelection(text)) return;
    await navigator.clipboard.writeText(text);
  }

  function copyWithSelection(text: string) {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.left = "-9999px";
    field.style.top = "0";
    document.body.appendChild(field);
    field.focus();
    field.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      document.body.removeChild(field);
    }
  }

  return {
    copyText,
    copiedTag,
    copyFallback,
    dismissFallback: () => setCopyFallback(null)
  };
}
