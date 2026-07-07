import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { Win98Skin } from "./skins/win98";

type HarnessWindow = Window & { __harnessHub98Root?: Root };

const container = document.getElementById("root")!;
const root = (window as HarnessWindow).__harnessHub98Root ?? createRoot(container);
(window as HarnessWindow).__harnessHub98Root = root;
root.render(<Win98Skin />);
