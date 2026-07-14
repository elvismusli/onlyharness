import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

const publicCopyFiles = [
  "README.md",
  "apps/registry-web/public/llms.txt",
  "apps/registry-web/index.html",
  "apps/registry-web/public/favicon.svg",
  "apps/registry-web/public/og-card.svg",
  "apps/registry-web/public/og-card.html",
  "apps/registry-web/public/manifest.webmanifest",
  "AGENTS.md",
  "apps/registry-web/public/AGENTS.md",
  "apps/registry-web/src/core/superskill-route.ts",
  "apps/registry-web/src/skins/win98/explore.tsx",
  "apps/registry-web/src/skins/win98/detail.tsx",
  "apps/registry-web/src/core/useSocial.ts",
  "apps/registry-web/src/core/store.tsx",
  "apps/registry-web/src/core/useSelectedShowroomCapabilities.ts",
  "apps/registry-web/src/core/share-url.ts",
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

check(docs["README.md"].includes("old OnlyHarness UI and host are compatibility-only"), "README must describe the legacy product as compatibility-only");
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
check(!superskillCopy.includes("https://onlyharness.com"), "SuperSkill browser source must use the canonical superskill.sh origin");
check(!docs["apps/registry-web/src/skins/superskill/pages/Landing.tsx"].includes("Exact runtime:"), "SuperSkill homepage must not expose the legacy package coordinate as branding");
check(!docs["apps/registry-web/src/skins/superskill/pages/WorkspacesPage.tsx"].includes('placeholder="onlyharness:'), "SuperSkill workspace UI must not teach legacy resource coordinates in visible placeholders");
for (const file of ["apps/registry-web/index.html", "apps/registry-web/public/favicon.svg", "apps/registry-web/public/og-card.svg", "apps/registry-web/public/og-card.html", "apps/registry-web/public/manifest.webmanifest"] as const) {
  check(!/OnlyHarness|onlyharness/.test(docs[file]), `${file} must not contain legacy human-facing branding`);
}
check(docs["apps/registry-web/index.html"].includes('rel="canonical" href="https://superskill.sh/"'), "SuperSkill index must expose the canonical website URL");
check(docs["apps/registry-web/index.html"].includes('href="/manifest.webmanifest"'), "SuperSkill index must expose the real web manifest");
check(!docs["apps/registry-web/index.html"].includes("Pixelify Sans") && !docs["apps/registry-web/index.html"].includes("VT323"), "SuperSkill index must not load legacy skin fonts globally");
check(docs["apps/registry-web/src/skins/superskill/pages/Landing.tsx"].includes("installer.installUrl"), "SuperSkill landing must show the universal URL itself");
check(docs["apps/registry-web/src/core/share-url.ts"].includes("/r/") && docs["apps/registry-web/src/core/share-url.ts"].includes("/c/"), "SuperSkill share helpers must use crawler-visible paths");
check(!docs["apps/registry-web/src/skins/superskill/components/TaskPrompt.tsx"].includes("localStorage"), "Task prompt must not persist task text");
check(!docs["apps/registry-web/src/skins/superskill/components/TaskPrompt.tsx"].includes("fetch("), "Task prompt must hand off locally instead of calling recommendation transport");
check(docs["apps/registry-web/src/skins/superskill/pages/InstallHandoff.tsx"].includes("Copying a command only copies text"), "Install handoff must not turn copy into lifecycle state");
check(docs["apps/registry-web/src/core/superskill-route.ts"].includes('name: "docs"') && docs["apps/registry-web/src/core/superskill-route.ts"].includes('name: "agent-guide"'), "SuperSkill must expose HTML docs and agent-guide routes");
check(docs["apps/registry-web/src/skins/superskill/components/SuperSkillHeader.tsx"].includes('name: "docs"') && docs["apps/registry-web/src/skins/superskill/components/SuperSkillHeader.tsx"].includes('name: "agent-guide"'), "SuperSkill header must use HTML documentation routes");
check(docs["apps/registry-web/src/skins/superskill/pages/DocsPage.tsx"].includes("superskillRuntime") && docs["apps/registry-web/src/skins/superskill/pages/AgentGuidePage.tsx"].includes("superskillRuntime"), "SuperSkill HTML docs must read the generated runtime contract");
check(docs["apps/registry-web/public/llms.txt"].includes("https://superskill.sh/#/superskill/docs") && docs["apps/registry-web/public/AGENTS.md"].includes("https://superskill.sh/#/superskill/agent-guide"), "Raw public docs must link to browser-safe SuperSkill documentation");
check(docs["apps/registry-web/src/core/useSelectedShowroomCapabilities.ts"].includes("/showroom/selected"), "Selected skill shelf must use its separate public-safe endpoint");
check(docs["apps/registry-web/src/skins/superskill/components/SelectedSkillCard.tsx"].includes("not an approval, trust badge, or managed activation claim"), "Selected skill cards must keep review-pending status explicit");
check(!docs["apps/registry-web/src/skins/superskill/components/SelectedSkillCard.tsx"].includes("Client handoff"), "Selected skill cards must not expose managed client handoff");
check(docs["README.md"].includes("selected_unreviewed") && docs["README.md"].includes("cannot be recommended or activated"), "README must separate selected discovery from approved managed use");
check(docs["README.md"].includes("12 exact immutable **candidates**") && docs["README.md"].includes("published and verified through a clean `npx` install"), "README must keep current SuperSkill supply and published CLI state honest");
for (const file of ["AGENTS.md", "apps/registry-web/public/AGENTS.md"] as const) {
  check(!docs[file].includes("The web app is OnlyHarness 98"), `${file} must not identify the SuperSkill human surface as OnlyHarness`);
  check(!docs[file].includes("plugins/onlyharness"), `${file} must not recommend the stale legacy plugin validation path`);
  check(docs[file].includes("Win98, Modern and Fans are legacy compatibility skins"), `${file} must scope legacy skins away from superskill.sh`);
}

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
