import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

const publicCopyFiles = [
  "README.md",
  "apps/registry-web/public/llms.txt",
  "AGENTS.md",
  "apps/registry-web/public/AGENTS.md",
  "apps/registry-web/src/skins/win98/explore.tsx",
  "apps/registry-web/src/skins/win98/detail.tsx",
  "apps/registry-web/src/core/useSocial.ts",
  "apps/registry-web/src/core/store.tsx",
  "apps/registry-web/src/skins/win98/windows.tsx"
] as const;

const superskillCopyFiles = collectSourceFiles("apps/registry-web/src/skins/superskill");
const allCopyFiles = [...publicCopyFiles, ...superskillCopyFiles];

const docs = Object.fromEntries(
  allCopyFiles.map((file) => [file, readFileSync(path.join(root, file), "utf8")])
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
check(docs["README.md"].includes("Server-side remix is a local draft flow with a real fork graph row"), "README must describe the server-side remix fork graph");
check(docs["apps/registry-web/public/llms.txt"].includes("Creates only a free unverified `local/{name}` copy"), "llms.txt must keep remix draft scope explicit");
check(docs["AGENTS.md"].includes("server-side fork graph for local remix drafts"), "AGENTS.md must scope the fork graph to local remix drafts");
check(docs["apps/registry-web/public/AGENTS.md"].includes("server-side fork graph for local remix drafts"), "Public AGENTS.md must scope the fork graph to local remix drafts");
check(docs["apps/registry-web/public/llms.txt"].includes("Copied fallback recipes do not count as forks"), "llms.txt must state fallback recipes do not count as forks");
check(docs["apps/registry-web/src/skins/win98/explore.tsx"].includes("Remix draft"), "Explore UI must label the action as a remix draft");
check(docs["apps/registry-web/src/skins/win98/detail.tsx"].includes("Remix draft"), "Detail UI must label the action as a remix draft");
check(docs["apps/registry-web/src/core/useSocial.ts"].includes("Remix draft fallback"), "Fallback dialog must label local recipe as remix draft fallback");
check(docs["README.md"].includes("Checkout URLs land on `/checkout`"), "README must document checkout URL landing state");
check(docs["apps/registry-web/public/llms.txt"].includes("The page never grants entitlement"), "llms.txt must state checkout page never grants entitlement");
check(docs["apps/registry-web/src/core/store.tsx"].includes("parseCheckoutLocation"), "Web UI must handle checkout_url deep links");
check(docs["apps/registry-web/src/skins/win98/windows.tsx"].includes("Manual checkout pending"), "Checkout UI must show manual pending state");
check(docs["apps/registry-web/src/skins/win98/windows.tsx"].includes("This page does not unlock files"), "Checkout UI must not imply entitlement was granted");

const superskillCopy = superskillCopyFiles.map((file) => docs[file]).join("\n");
const superskillTextCopy = superskillCopyFiles.filter((file) => /\.tsx?$/.test(file)).map((file) => docs[file]).join("\n");
for (const forbidden of ["2,140", "12.8k", "240 verified", "0 unchecked", "Outcome verified", "superskill.sh/get", "38s", "9/9", "100%", "guaranteed"]) {
  check(!superskillTextCopy.includes(forbidden), `SuperSkill UI must not contain unsupported claim: ${forbidden}`);
}
check(!superskillCopy.includes("HH_SUPERSKILL_TOKEN"), "SuperSkill browser source must not reference the internal CLI token");
check(!docs["apps/registry-web/src/skins/superskill/components/TaskPrompt.tsx"].includes("localStorage"), "Task prompt must not persist task text");
check(!docs["apps/registry-web/src/skins/superskill/components/TaskPrompt.tsx"].includes("fetch("), "Task prompt must hand off locally instead of calling recommendation transport");
check(docs["apps/registry-web/src/skins/superskill/pages/InstallHandoff.tsx"].includes("Copying a command only copies text"), "Install handoff must not turn copy into lifecycle state");
check(docs["README.md"].includes("12 exact immutable **candidates**") && docs["README.md"].includes("published and verified through a clean `npx` install"), "README must keep current SuperSkill supply and published CLI state honest");

console.log("Public copy check passed: remix/fork language stays honest");

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function collectSourceFiles(relativeRoot: string): string[] {
  const result: string[] = [];
  const visit = (relativeDir: string) => {
    for (const entry of readdirSync(path.join(root, relativeDir), { withFileTypes: true })) {
      const relative = path.posix.join(relativeDir, entry.name);
      if (entry.isDirectory()) visit(relative);
      else if (/\.(?:ts|tsx|css)$/.test(entry.name)) result.push(relative);
    }
  };
  visit(relativeRoot);
  return result.sort();
}
