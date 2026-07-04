import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const seedRoot = path.join(root, "seed-harnesses");
const templateRoot = path.join(root, "templates/harness-template");
const tmpRoot = path.join(root, "data/gitea-push");

const baseUrl = process.env.GITEA_BASE_URL ?? "http://127.0.0.1:3000";
const username = process.env.GITEA_USERNAME ?? "harness";
const password = process.env.GITEA_PASSWORD ?? "harnesshub";
const token = process.env.GITEA_TOKEN;
const org = process.env.GITEA_ORG ?? "harnesses";

if (!token) {
  throw new Error("GITEA_TOKEN is required. Generate one with: docker compose -f infra/docker-compose.yml exec -T -u git gitea gitea admin user generate-access-token --config /data/gitea/conf/app.ini --username harness --token-name harnesshub-local --scopes all");
}

const authHeaders = {
  Authorization: `token ${token}`,
  "Content-Type": "application/json"
};

await ensureGiteaReady();
await ensureOrg();

rmSync(tmpRoot, { recursive: true, force: true });
mkdirSync(tmpRoot, { recursive: true });

const repos = readdirSync(seedRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({ name: entry.name, source: path.join(seedRoot, entry.name), template: false }))
  .sort((a, b) => a.name.localeCompare(b.name));
repos.unshift({ name: "harness-template", source: templateRoot, template: true });

for (const repo of repos) {
  await ensureRepo(repo.name, repo.template);
  pushRepo(repo.name, repo.source);
}

console.log(`Bootstrapped ${repos.length} harness repos into ${baseUrl}/${org}`);

async function ensureGiteaReady() {
  const response = await fetch(`${baseUrl}/api/v1/version`);
  if (!response.ok) throw new Error(`Gitea API not ready: ${response.status}`);
  const body = await response.json() as { version: string };
  console.log(`Gitea ${body.version} ready at ${baseUrl}`);
}

async function ensureOrg() {
  const existing = await fetch(`${baseUrl}/api/v1/orgs/${org}`, { headers: authHeaders });
  if (existing.ok) return;
  const created = await fetch(`${baseUrl}/api/v1/orgs`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      username: org,
      full_name: "Harness.Hub Seed Harnesses",
      description: "Local MVP organization containing forkable agent harness repositories.",
      visibility: "public"
    })
  });
  if (!created.ok && created.status !== 409) {
    throw new Error(`Failed to create org ${org}: ${created.status} ${await created.text()}`);
  }
}

async function ensureRepo(repo: string, template: boolean) {
  const existing = await fetch(`${baseUrl}/api/v1/repos/${org}/${repo}`, { headers: authHeaders });
  if (existing.ok) return;
  const created = await fetch(`${baseUrl}/api/v1/orgs/${org}/repos`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      name: repo,
      description: `Harness.Hub seed harness: ${repo}`,
      private: false,
      auto_init: false,
      default_branch: "main",
      template
    })
  });
  if (!created.ok && created.status !== 409) {
    throw new Error(`Failed to create repo ${repo}: ${created.status} ${await created.text()}`);
  }
}

function pushRepo(repo: string, source: string) {
  const target = path.join(tmpRoot, repo);
  cpSync(source, target, { recursive: true, force: true });
  rmSync(path.join(target, ".git"), { recursive: true, force: true });

  run("git", ["init", "-b", "main"], target);
  run("git", ["config", "user.name", "Harness Hub Local"], target);
  run("git", ["config", "user.email", "harness@example.local"], target);
  run("git", ["add", "."], target);
  run("git", ["commit", "-m", `Seed ${repo}`], target);

  const remote = `${baseUrl.replace("http://", `http://${encodeURIComponent(username)}:${encodeURIComponent(token)}@`)}/${org}/${repo}.git`;
  run("git", ["remote", "add", "origin", remote], target);
  run("git", ["push", "-u", "origin", "main", "--force"], target);
}

function run(cmd: string, args: string[], cwd: string) {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Command failed in ${cwd}: ${cmd} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  }
}
