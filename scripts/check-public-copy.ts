import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

const publicCopyFiles = [
  "README.md",
  "apps/registry-web/public/llms.txt",
  "AGENTS.md",
  "apps/registry-web/public/AGENTS.md",
  "apps/registry-web/src/explore.tsx",
  "apps/registry-web/src/detail.tsx",
  "apps/registry-web/src/main.tsx",
  "apps/registry-web/src/windows.tsx"
] as const;

const docs = Object.fromEntries(
  publicCopyFiles.map((file) => [file, readFileSync(path.join(root, file), "utf8")])
);

for (const [file, text] of Object.entries(docs)) {
  for (const phrase of [
    "forkable AI-agent harnesses",
    "read the thread, fork",
    "Fork/remix"
  ]) {
    check(!text.includes(phrase), `${file} must not promise a real fork graph with "${phrase}"`);
  }
}

check(docs["README.md"].includes("create local remix drafts"), "README must describe remix as local drafts");
check(docs["README.md"].includes("Server-side remix is a local draft flow"), "README must state server-side remix is not a fork graph");
check(docs["apps/registry-web/public/llms.txt"].includes("Creates only a free unverified `local/{name}` copy"), "llms.txt must keep remix draft scope explicit");
check(docs["AGENTS.md"].includes("not a fork graph"), "AGENTS.md must state remixes are not a fork graph");
check(docs["apps/registry-web/public/AGENTS.md"].includes("not a fork graph"), "Public AGENTS.md must state remixes are not a fork graph");
check(docs["apps/registry-web/src/explore.tsx"].includes("Remix draft"), "Explore UI must label the action as a remix draft");
check(docs["apps/registry-web/src/detail.tsx"].includes("Remix draft"), "Detail UI must label the action as a remix draft");
check(docs["apps/registry-web/src/main.tsx"].includes("Remix draft fallback"), "Fallback dialog must label local recipe as remix draft fallback");
check(docs["README.md"].includes("Checkout URLs land on `/checkout`"), "README must document checkout URL landing state");
check(docs["apps/registry-web/public/llms.txt"].includes("The page never grants entitlement"), "llms.txt must state checkout page never grants entitlement");
check(docs["apps/registry-web/src/main.tsx"].includes("parseCheckoutLocation"), "Web UI must handle checkout_url deep links");
check(docs["apps/registry-web/src/windows.tsx"].includes("Manual checkout pending"), "Checkout UI must show manual pending state");
check(docs["apps/registry-web/src/windows.tsx"].includes("This page does not unlock files"), "Checkout UI must not imply entitlement was granted");

console.log("Public copy check passed: remix/fork language stays honest");

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
