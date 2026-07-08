import { useState } from "react";
import { apiUrl } from "./constants";

export type UsePublishResult = {
  importName: string;
  setImportName: (value: string) => void;
  importMarkdown: string;
  setImportMarkdown: (value: string) => void;
  importStatus: string;
  importBusy: boolean;
  submitImport: () => Promise<void>;
};

/**
 * Skin-agnostic publish/import logic extracted from the Win98 `App()`.
 *
 * Owns the quick markdown scaffold form state (`importName`, `importMarkdown`) and the
 * `importStatus`/`importBusy` UI state around the publish call. `submitImport`
 * gates on `requireUser`, POSTs the markdown to `/imports/markdown-to-harness`,
 * and on success closes the publish window, resets the registry filters, bumps
 * the refresh token and shows the success dialog — all via injected callbacks so
 * the host skin keeps ownership of its window manager and chrome.
 */
export function usePublish(opts: {
  requireUser: (note: string) => boolean;
  accessToken?: string;
  setQuery: (q: string) => void;
  setJobFilter: (j: string) => void;
  bumpRefresh: () => void;
  closePublish: () => void;
  showDialog: (spec: { title: string; icon: string; body: string; cancel?: boolean; onOk?: () => void }) => void;
}): UsePublishResult {
  const [importName, setImportName] = useState("customer-research-pipeline");
  const [importMarkdown, setImportMarkdown] = useState("# Customer Research Pipeline\n\nResearch target users, synthesize pains, critique assumptions, produce a decision memo with unresolved fields marked.");
  const [importStatus, setImportStatus] = useState("");
  const [importBusy, setImportBusy] = useState(false);

  async function submitImport() {
    if (!opts.requireUser("Log on to publish a resource.")) return;
    setImportBusy(true);
    setImportStatus("");
    try {
      const response = await fetch(`${apiUrl}/imports/markdown-to-harness`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.accessToken}`
        },
        body: JSON.stringify({ name: importName, markdown: importMarkdown })
      });
      const result = await response.json();
      if (!response.ok) {
        setImportStatus(result.error ?? "Publish failed.");
        return;
      }
      opts.closePublish();
      opts.setQuery("");
      opts.setJobFilter("all");
      opts.bumpRefresh();
      const warnings = Array.isArray(result.warnings) && result.warnings.length ? `\n\n${result.warnings.join("\n")}` : "";
      const next = typeof result.next === "string" ? `\n\n${result.next}` : "";
      opts.showDialog({ title: "Markdown scaffold published", icon: "📦", body: `${result.item.title} is live as a markdown-derived scaffold.${warnings}${next}` });
    } catch {
      setImportStatus("Publish failed: the harness API is unreachable.");
    } finally {
      setImportBusy(false);
    }
  }

  return {
    importName,
    setImportName,
    importMarkdown,
    setImportMarkdown,
    importStatus,
    importBusy,
    submitImport
  };
}
