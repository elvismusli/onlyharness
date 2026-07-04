import { readFileSync } from "node:fs";
import path from "node:path";

const baseUrl = process.env.GITEA_BASE_URL ?? "http://127.0.0.1:3000";
const org = process.env.GITEA_ORG ?? "harnesses";
const proofRepo = process.env.GITEA_PROOF_REPO ?? "deep-market-researcher";
const proofPath = path.resolve(import.meta.dirname, "../data/gitea-proof.json");
const proof = JSON.parse(readFileSync(proofPath, "utf8")) as { pullRequest: string; branch: string; statusContext?: string };
const prNumber = Number(proof.pullRequest.match(/\/pulls\/(\d+)$/)?.[1]);

if (!Number.isInteger(prNumber)) {
  throw new Error(`Cannot parse proof PR number from ${proof.pullRequest}`);
}

const version = await fetchJson<{ version: string }>("/api/v1/version");
const repos = await fetchJson<Array<{ name: string }>>(`/api/v1/orgs/${org}/repos`);
const names = repos.map((repo) => repo.name).sort();

const required = [
  "harness-template",
  "agent-harness-refactorer",
  "deep-market-researcher",
  "finance-payment-safety-reviewer",
  "founder-decision-memo",
  "gtm-research-sprint",
  "product-strategy-critic",
  "repo-truth-auditor",
  "support-triage-agent"
];

const missing = required.filter((name) => !names.includes(name));
if (missing.length) {
  throw new Error(`Missing Gitea repos: ${missing.join(", ")}`);
}

const pr = await fetchJson<{
  number: number;
  state: string;
  title: string;
  head?: { ref?: string; sha?: string; repo?: { full_name?: string } };
  base?: { ref?: string; sha?: string };
}>(`/api/v1/repos/${org}/${proofRepo}/pulls/${prNumber}`);
if (pr.state !== "open" || pr.head?.ref !== proof.branch || pr.base?.ref !== "main") {
  throw new Error(`Proof PR is not in expected state: ${JSON.stringify(pr)}`);
}

const runs = await fetchJson<{ workflow_runs?: Array<{
  id: number;
  event: string;
  status: string;
  conclusion?: string;
  head_sha?: string;
  html_url?: string;
}> }>(`/api/v1/repos/${org}/${proofRepo}/actions/runs`);
const workflowRuns = runs.workflow_runs ?? [];
const pushRun = workflowRuns.find((run) => run.event === "push" && run.head_sha === pr.base?.sha);
const prRun = workflowRuns.find((run) => run.event === "pull_request" && run.head_sha === pr.head?.sha);
const headRepo = pr.head?.repo?.full_name ?? `harness/${proofRepo}`;
const commitStatuses = await fetchJson<Array<{ state?: string; status?: string; context?: string; description?: string }>>(
  `/api/v1/repos/${headRepo}/statuses/${pr.head?.sha}`
);
const sidecarStatus = commitStatuses.find((status) => status.context === (proof.statusContext ?? "harnesshub/sidecar-gate"));

if (pushRun?.status !== "completed" || pushRun.conclusion !== "success") {
  throw new Error(`Latest base push run is not successful: ${JSON.stringify(pushRun)}`);
}
if (prRun && (prRun.status !== "completed" || prRun.conclusion !== "success")) {
  throw new Error(`Proof PR run is not successful: ${JSON.stringify(prRun)}`);
}
if ((sidecarStatus?.state ?? sidecarStatus?.status) !== "success") {
  throw new Error(`Proof PR sidecar status is not successful: ${JSON.stringify(sidecarStatus)}`);
}

console.log(JSON.stringify({
  gitea: baseUrl,
  version: version.version,
  repos: names.length,
  actions: {
    pushRun: { id: pushRun.id, status: pushRun.status, conclusion: pushRun.conclusion },
    prRun: prRun ? { id: prRun.id, status: prRun.status, conclusion: prRun.conclusion } : null,
    sidecarStatus: { context: sidecarStatus.context, state: sidecarStatus.state ?? sidecarStatus.status }
  },
  proofPr: {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    head: pr.head?.ref,
    base: pr.base?.ref
  }
}, null, 2));

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: process.env.GITEA_TOKEN ? { Authorization: `token ${process.env.GITEA_TOKEN}` } : undefined
  });
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}
