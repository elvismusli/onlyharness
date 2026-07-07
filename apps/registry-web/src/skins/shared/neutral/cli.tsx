import { useHarness } from "../../../core/store";
import { keyFor } from "../../../core/format";

/*
 * Shared-neutral CLI terminal — the "serious" command surface rendered
 * identically in every skin (only the `--neutral-*` palette changes). Mirrors the
 * Win98 `CliBody` fake terminal: the OnlyHarness CLI banner, the
 * `hh install → run → eval && gate → publish → doctor` loop with OK lines and a
 * blinking cursor, plus a "Copy commands" button wired to `copyText`. Directory
 * ("link-only") harnesses drop the run/eval/gate loop for an open-upstream note.
 *
 * Pure consumer of `useHarness()`: the selected harness (`knownItems[key]`) drives
 * the pull command; copy state comes from `copyText`/`copiedTag`.
 */

export function NeutralCli({ surfaceKey }: { surfaceKey?: string }) {
  const h = useHarness();
  const item = surfaceKey ? h.knownItems[surfaceKey] : undefined;

  const pull = item?.cliCommand ?? "hh install harnesses/deep-market-researcher";
  const isDirectory = item?.contentType === "directory";
  const commands = isDirectory
    ? `${pull}\n# link-only directory: review upstream source and licensing before importing entries`
    : `${pull}\nhh run --input examples/input.md\nhh eval && hh gate\nhh publish`;

  const copied = h.copiedTag === "neutral-cli";

  function copyCommands() {
    if (item) h.recordHarnessEvent("copy", item, "cli");
    void h.copyText(commands, "CLI commands copied", "neutral-cli");
  }

  return (
    <div className="oh-neutral">
      <div className="ohn-term">
        <div className="ohn-term-bar">
          <span className="ohn-term-dot" style={{ background: "#ff5f57" }} />
          <span className="ohn-term-dot" style={{ background: "#febc2e" }} />
          <span className="ohn-term-dot" style={{ background: "#28c840" }} />
          <span className="ohn-term-label">hh — OnlyHarness CLI</span>
        </div>
        <div className="ohn-term-body">
          <span className="ohn-term-dim">OnlyHarness CLI [Version 0.98]{"\n"}Season 4 — Wild West. Remix responsibly.{"\n\n"}</span>
          <span className="ohn-term-prompt">$ </span><span className="ohn-term-cmd">{pull}</span>{"\n"}
          {isDirectory ? (
            <span className="ohn-term-dim">{"  "}link-only directory: no run/eval/gate loop{"\n\n"}</span>
          ) : (
            <>
              <span className="ohn-term-prompt">$ </span><span className="ohn-term-cmd">hh run --input examples/input.md</span>{"\n"}
              <span className="ohn-term-ok">{"  "}run ok · sample output written{"\n"}</span>
              <span className="ohn-term-prompt">$ </span><span className="ohn-term-cmd">hh eval &amp;&amp; hh gate</span>{"\n"}
              <span className="ohn-term-ok">{"  "}eval ok · gate ok{"\n"}</span>
              <span className="ohn-term-prompt">$ </span><span className="ohn-term-cmd">hh publish</span>{"\n\n"}
            </>
          )}
          <span className="ohn-term-prompt">$ </span><span className="ohn-term-cmd">hh doctor</span>{"\n"}
          <span className="ohn-term-dim">
            {"  "}registry ui ....... http://127.0.0.1:5177 </span><span className="ohn-term-ok">[OK]</span><span className="ohn-term-dim">{"\n"}
            {"  "}harness api ....... http://127.0.0.1:8787 </span><span className="ohn-term-ok">[OK]</span><span className="ohn-term-dim">{"\n"}
            {"  "}forge ............. gitea sidecar </span><span className="ohn-term-ok">[OK]</span><span className="ohn-term-dim">{"\n\n"}
          </span>
          <span className="ohn-term-prompt">$ </span><span className="ohn-term-cursor" />
        </div>
      </div>
      <div className="ohn-term-foot">
        <button type="button" className="ohn-btn ohn-btn-primary" onClick={copyCommands}>
          {copied ? "✓ Copied" : "Copy commands"}
        </button>
        <span className="ohn-term-foot-note">The interface is friendly; the command line stays exact.</span>
      </div>
    </div>
  );
}
