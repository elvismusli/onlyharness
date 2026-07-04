import { appendFileSync, cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const tmpRoot = path.join(root, "data/gitea-proof");
const baseUrl = process.env.GITEA_BASE_URL ?? "http://127.0.0.1:3000";
const token = process.env.GITEA_TOKEN;
const username = process.env.GITEA_USERNAME ?? "harness";
const sourceOwner = process.env.GITEA_ORG ?? "harnesses";
const repo = process.env.GITEA_PROOF_REPO ?? "deep-market-researcher";
const headOwner = process.env.GITEA_PROOF_HEAD_OWNER ?? sourceOwner;
const seedSource = path.join(root, "seed-harnesses", repo);
const branch = process.env.GITEA_PROOF_BRANCH ?? `proof-semantic-review-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
const statusContext = "harnesshub/sidecar-gate";

if (!token) throw new Error("GITEA_TOKEN is required");

const headers = {
  Authorization: `token ${token}`,
  "Content-Type": "application/json"
};

await request("POST", `/api/v1/repos/${sourceOwner}/${repo}/forks`, {});

rmSync(tmpRoot, { recursive: true, force: true });
mkdirSync(tmpRoot, { recursive: true });

const remote = `${baseUrl.replace("http://", `http://${encodeURIComponent(username)}:${encodeURIComponent(token)}@`)}/${headOwner}/${repo}.git`;
run("git", ["clone", remote, repo], tmpRoot);

const worktree = path.join(tmpRoot, repo);
run("git", ["checkout", "-B", branch], worktree);
syncSeedIntoWorktree(seedSource, worktree);
appendFileSync(
  path.join(worktree, "agents/critic.md"),
  `\nProof change ${new Date().toISOString()}: tighten critique output and require explicit eval evidence before merge.\n`
);
run("git", ["config", "user.name", "Harness Hub Local"], worktree);
run("git", ["config", "user.email", "harness@example.local"], worktree);
run("git", ["add", "."], worktree);
run("git", ["commit", "-m", "Proof semantic review change"], worktree);
run("git", ["push", "-u", "origin", branch, "--force"], worktree);

const pr = await request("POST", `/api/v1/repos/${sourceOwner}/${repo}/pulls`, {
  title: `Proof semantic review change ${branch}`,
  body: "Local MVP proof PR: fork, branch, prompt change, push and PR creation through Gitea.",
  head: headOwner === sourceOwner ? branch : `${headOwner}:${branch}`,
  base: "main"
});
const headSha = pr?.head?.sha ?? git(["rev-parse", "HEAD"], worktree).trim();
const prUrl = pr?.html_url ?? `${baseUrl}/${sourceOwner}/${repo}/pulls`;
const prNumber = pr?.number;

try {
  run("npm", ["exec", "--", "hh", "validate", "--strict", worktree], root);
  run("npm", ["exec", "--", "hh", "eval", worktree], root);
  run("npm", ["exec", "--", "hh", "gate", "--dir", worktree, "--results", ".harnesshub/results.json"], root);
  await setCommitStatus(headOwner, repo, headSha, "success", "Harness.Hub local sidecar gate passed", prUrl);
} catch (error) {
  await setCommitStatus(headOwner, repo, headSha, "failure", "Harness.Hub local sidecar gate failed", prUrl);
  throw error;
}
if (typeof prNumber === "number") {
  await closeOlderProofPulls(prNumber);
}

const proof = {
  gitea: baseUrl,
  source: `${baseUrl}/${sourceOwner}/${repo}`,
  fork: `${baseUrl}/${username}/${repo}`,
  pullRequest: prUrl,
  branch,
  headOwner,
  headSha,
  statusContext,
  createdAt: new Date().toISOString()
};

writeFileSync(path.join(root, "data/gitea-proof.json"), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof, null, 2));

async function request(method: string, urlPath: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if (response.ok) return response.status === 204 ? undefined : response.json();
  if (response.status === 409 || response.status === 422) {
    const text = await response.text();
    if (urlPath.includes("/forks")) return undefined;
    if (urlPath.includes("/pulls")) {
      const pulls = await fetch(`${baseUrl}/api/v1/repos/${sourceOwner}/${repo}/pulls?state=open`, { headers });
      const list = await pulls.json() as Array<{ html_url?: string; head?: { ref?: string } }>;
      return list.find((item) => item.head?.ref === branch) ?? list[0];
    }
    console.warn(`Ignoring existing resource for ${urlPath}: ${text}`);
    return undefined;
  }
  throw new Error(`${method} ${urlPath} failed: ${response.status} ${await response.text()}`);
}

async function setCommitStatus(owner: string, repoName: string, sha: string, state: "success" | "failure", description: string, targetUrl: string) {
  const response = await fetch(`${baseUrl}/api/v1/repos/${owner}/${repoName}/statuses/${sha}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      state,
      context: statusContext,
      description,
      target_url: targetUrl
    })
  });
  if (!response.ok) {
    throw new Error(`POST /statuses/${sha} failed: ${response.status} ${await response.text()}`);
  }
}

async function closeOlderProofPulls(currentNumber: number) {
  const response = await fetch(`${baseUrl}/api/v1/repos/${sourceOwner}/${repo}/pulls?state=open`, { headers });
  if (!response.ok) return;
  const pulls = await response.json() as Array<{ number?: number; title?: string }>;
  for (const pull of pulls) {
    if (pull.number === currentNumber || !pull.title?.startsWith("Proof ")) continue;
    await fetch(`${baseUrl}/api/v1/repos/${sourceOwner}/${repo}/pulls/${pull.number}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ state: "closed" })
    });
  }
}

function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Command failed in ${cwd}: ${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  }
}

function git(args: string[], cwd: string) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Git command failed in ${cwd}: git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function syncSeedIntoWorktree(source: string, worktree: string) {
  for (const entry of readdirSync(worktree, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    rmSync(path.join(worktree, entry.name), { recursive: true, force: true });
  }
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    cpSync(path.join(source, entry.name), path.join(worktree, entry.name), { recursive: true, force: true });
  }
}
