import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { HarnessStore } from "./core/store";
import { SkinProvider } from "./skins/SkinProvider";

type HarnessWindow = Window & { __harnessHub98Root?: Root };

const container = document.getElementById("root")!;
const root = (window as HarnessWindow).__harnessHub98Root ?? createRoot(container);
(window as HarnessWindow).__harnessHub98Root = root;
// Store wraps the skin provider so switching skins later preserves useHarness() state.
root.render(
  <HarnessStore>
    <SkinProvider />
  </HarnessStore>
);
