# GitHub Mirror Rollout Progress

Updated: 2026-07-07 19:39:31 WITA

## Current status

- Mirror namespace: `overclawswarm`
- Catalog resources: 253
- OnlyHarness resource pages: 253/253 expose `open_onlyharness`
- Hosted OnlyHarness archives: 251/253
- Hosted archive bytes: 3,312,617,339
- Ready GitHub forks: 28
- Remaining GitHub forks: 225
- Public catalog behavior:
  - `Use` opens the OnlyHarness resource dialog/page, not GitHub;
  - resources with a local archive expose `download_archive` from `https://onlyharness.com/api/resources/{id}/archive`;
  - upstream attribution remains visible as `open_upstream`, but it is secondary provenance;
  - rate-limit failed attempts are not exposed in the public catalog.

State files:

- Public catalog: `data/resources/verified-2026-07.json`
- Local mirror state: `data/resources/mirrors-overclawswarm.json`
- Hosted archive manifest: `data/resources/archives/archives.json`
- Production hosted archives: `/var/lib/onlyharness/resource-archives/*.tar.gz`
- Do not keep `.tar.gz` archives in the local repo. `data/resources/archives/*.tar.gz` is ignored and excluded from deploy/build context.

## Hosted archive exceptions

These two resources are not hosted by the current archive path because the
default-branch tarballs exceed the 250MB safety limit:

- `github:aaif-goose/goose` (~320MB)
- `github:iofficeai/aionui` (~475MB)

Handle them later with object storage/streaming import instead of bundling them
into the app image. The API reads hosted archives from `RESOURCE_ARCHIVE_DIR`;
production uses `/var/lib/onlyharness/resource-archives`.

## Ready mirrors

| Resource | OnlyHarness mirror | Upstream |
| --- | --- | --- |
| `github:anthropics/claude-code` | `https://github.com/overclawswarm/oh-anthropics-claude-code` | `https://github.com/anthropics/claude-code` |
| `github:anthropics/skills` | `https://github.com/overclawswarm/oh-anthropics-skills` | `https://github.com/anthropics/skills` |
| `github:anthropics/claude-plugins-official` | `https://github.com/overclawswarm/oh-anthropics-claude-plugins-official` | `https://github.com/anthropics/claude-plugins-official` |
| `github:anthropics/claude-plugins-community` | `https://github.com/overclawswarm/oh-anthropics-claude-plugins-community` | `https://github.com/anthropics/claude-plugins-community` |
| `github:anthropics/claude-cookbooks` | `https://github.com/overclawswarm/oh-anthropics-claude-cookbooks` | `https://github.com/anthropics/claude-cookbooks` |
| `github:anthropics/claude-agent-sdk-python` | `https://github.com/overclawswarm/oh-anthropics-claude-agent-sdk-python` | `https://github.com/anthropics/claude-agent-sdk-python` |
| `github:anthropics/claude-agent-sdk-typescript` | `https://github.com/overclawswarm/oh-anthropics-claude-agent-sdk-typescript` | `https://github.com/anthropics/claude-agent-sdk-typescript` |
| `github:anthropics/claude-code-action` | `https://github.com/overclawswarm/oh-anthropics-claude-code-action` | `https://github.com/anthropics/claude-code-action` |
| `github:anthropics/claude-code-security-review` | `https://github.com/overclawswarm/oh-anthropics-claude-code-security-review` | `https://github.com/anthropics/claude-code-security-review` |
| `github:anthropics/prompt-eng-interactive-tutorial` | `https://github.com/overclawswarm/oh-anthropics-prompt-eng-interactive-tutorial` | `https://github.com/anthropics/prompt-eng-interactive-tutorial` |
| `github:anthropics/claude-quickstarts` | `https://github.com/overclawswarm/oh-anthropics-claude-quickstarts` | `https://github.com/anthropics/claude-quickstarts` |
| `github:shubhamsaboo/awesome-llm-apps` | `https://github.com/overclawswarm/oh-shubhamsaboo-awesome-llm-apps` | `https://github.com/Shubhamsaboo/awesome-llm-apps` |
| `github:punkpeye/awesome-mcp-servers` | `https://github.com/overclawswarm/oh-punkpeye-awesome-mcp-servers` | `https://github.com/punkpeye/awesome-mcp-servers` |
| `github:composiohq/awesome-claude-skills` | `https://github.com/overclawswarm/oh-composiohq-awesome-claude-skills` | `https://github.com/ComposioHQ/awesome-claude-skills` |
| `github:voltagent/awesome-openclaw-skills` | `https://github.com/overclawswarm/oh-voltagent-awesome-openclaw-skills` | `https://github.com/VoltAgent/awesome-openclaw-skills` |
| `github:hesreallyhim/awesome-claude-code` | `https://github.com/overclawswarm/oh-hesreallyhim-awesome-claude-code` | `https://github.com/hesreallyhim/awesome-claude-code` |
| `github:sickn33/antigravity-awesome-skills` | `https://github.com/overclawswarm/oh-sickn33-antigravity-awesome-skills` | `https://github.com/sickn33/antigravity-awesome-skills` |
| `github:patrickjs/awesome-cursorrules` | `https://github.com/overclawswarm/oh-patrickjs-awesome-cursorrules` | `https://github.com/PatrickJS/awesome-cursorrules` |
| `github:github/awesome-copilot` | `https://github.com/overclawswarm/oh-github-awesome-copilot` | `https://github.com/github/awesome-copilot` |
| `github:hesamsheikh/awesome-openclaw-usecases` | `https://github.com/overclawswarm/oh-hesamsheikh-awesome-openclaw-usecases` | `https://github.com/hesamsheikh/awesome-openclaw-usecases` |
| `github:voltagent/awesome-agent-skills` | `https://github.com/overclawswarm/oh-voltagent-awesome-agent-skills` | `https://github.com/VoltAgent/awesome-agent-skills` |
| `github:voltagent/awesome-claude-code-subagents` | `https://github.com/overclawswarm/oh-voltagent-awesome-claude-code-subagents` | `https://github.com/VoltAgent/awesome-claude-code-subagents` |
| `github:travisvn/awesome-claude-skills` | `https://github.com/overclawswarm/oh-travisvn-awesome-claude-skills` | `https://github.com/travisvn/awesome-claude-skills` |
| `github:yzfly/awesome-mcp-zh` | `https://github.com/overclawswarm/oh-yzfly-awesome-mcp-zh` | `https://github.com/yzfly/Awesome-MCP-ZH` |
| `github:heilcheng/awesome-agent-skills` | `https://github.com/overclawswarm/oh-heilcheng-awesome-agent-skills` | `https://github.com/heilcheng/awesome-agent-skills` |
| `github:appcypher/awesome-mcp-servers` | `https://github.com/overclawswarm/oh-appcypher-awesome-mcp-servers` | `https://github.com/appcypher/awesome-mcp-servers` |
| `github:wong2/awesome-mcp-servers` | `https://github.com/overclawswarm/oh-wong2-awesome-mcp-servers` | `https://github.com/wong2/awesome-mcp-servers` |
| `github:obra/superpowers` | `https://github.com/overclawswarm/oh-obra-superpowers` | `https://github.com/obra/superpowers` |

## Rate-limit interrupted attempts

These are not public product failures. They were attempted after the GitHub API
core quota reached zero and should be retried first:

- `github:jaw9c/awesome-remote-mcp-servers`
- `github:jamesmurdza/awesome-ai-devtools`
- `github:filipecalegario/awesome-vibe-coding`
- `github:davepoon/buildwithclaude`
- `github:rohitg00/awesome-claude-code-toolkit`
- `github:composiohq/awesome-claude-plugins`
- `github:multica-ai/andrej-karpathy-skills`

## Continue later

Use the stored token env locally, then run a chunk after GitHub rate limit reset:

```bash
source /Users/elvismusli/.config/onlyharness/overclawswarm.env
npx tsx scripts/mirror-resource-catalog.ts --minimal-api --auth-login overclawswarm --limit-new 55 --interval-ms 1500 --poll-attempts 1 --poll-ms 1000
npx tsx scripts/mirror-resource-catalog.ts --apply-state-only
ssh hetzner-root "cd /opt/onlyharness && RESOURCE_ARCHIVE_DIR=/var/lib/onlyharness/resource-archives RESOURCE_ARCHIVE_MAX_BYTES=250000000 npx tsx scripts/sync-resource-archives.ts --missing-only --limit 25"
ssh hetzner-root "cd /opt/onlyharness && RESOURCE_ARCHIVE_DIR=/var/lib/onlyharness/resource-archives npx tsx scripts/mirror-resource-catalog.ts --apply-state-only"
```

After every chunk:

```bash
npm run check
npm run smoke
npm run smoke:mcp
npm run build
SSH_TARGET=hetzner-root DEPLOY_MODE=system-caddy scripts/deploy-production.sh
```

When all 253 are ready, run one slower metadata pass if needed:

```bash
source /Users/elvismusli/.config/onlyharness/overclawswarm.env
npx tsx scripts/mirror-resource-catalog.ts --refresh-ready --sync-existing --limit 25 --interval-ms 5000
```
