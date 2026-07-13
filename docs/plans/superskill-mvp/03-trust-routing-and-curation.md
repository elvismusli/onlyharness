# 03 — Trust, routing and curation

## 1. Principle

SuperSkill MVP не обещает «безопасный resource». Он отвечает на более узкий вопрос:

> Может ли этот exact digest быть предложен для этой задачи, этому client и с этими
> permissions согласно internal-alpha policy прямо сейчас?

Ответ вычисляется до ranking. Popularity не заменяет eligibility.

## 2. Managed eligibility

### 2.1 Mandatory input checks

Approved release обязан иметь:

- curated ID;
- exact owner/name ref;
- semantic version;
- immutable snapshot;
- `delivery=free_archive` and `pricing.model=free`;
- canonical digest;
- known source URL;
- known non-`UNSPECIFIED` license;
- text-only artifact;
- valid native manifest;
- honest runtime metadata;
- declared permissions;
- static scan result;
- inferred capability diff;
- human review exact digest;
- compatibility smoke для Claude Code;
- compatibility smoke для Codex;
- review timestamp и optional expiry;
- limitations array, даже если пустой.

### 2.2 Internal-alpha hard blocks

Resource не eligible, если выполняется хотя бы одно:

- status `quarantined` или `revoked`;
- snapshot mutable/missing;
- digest mismatch;
- unknown/blocked license;
- symlink, binary, executable script, hook или package install step;
- `filesystem=unrestricted`;
- `network=unrestricted`;
- `credentials=persistent`;
- `externalSend=true`;
- `moneyMovement=true`;
- security `fail`;
- undeclared capability with severity `fail`;
- selected client compatibility `blocked` или отсутствует;
- selected client compatibility не `verified` или smoke expired;
- mandatory review expired;
- risk tier `CRITICAL`;
- artifact context exceeds 32k estimated tokens.

### 2.3 Allowed with explicit consent

MVP всегда требует activation consent. Дополнительно подчеркнуть:

- `shell=true`;
- `browser=true`;
- `userData=true`;
- `filesystem=workspace-write`;
- `credentials=runtime_injected`;
- new network allowlist hosts;
- security warning;
- permission baseline unknown.

Client sandbox/approval policy остаётся последним enforcement layer. SuperSkill не может
расширять sandbox или approvals пользователя самостоятельно.

### 2.4 Instruction-only policy

Допустимые content roots:

```text
harness.yaml
README.md
agents/**/*.md
prompts/**/*.md
runbooks/**/*.md
examples/**/*.md
evals/cases/**/*.{yaml,yml,json,md}
evals/promptfooconfig.yaml
```

`evals/promptfooconfig.yaml` — узкое исключение только для declarative evidence metadata.
Путь case-sensitive и должен byte-for-byte совпадать с
`harness.yaml#evals.promptfoo_config`; единственное допустимое значение manifest —
`evals/promptfooconfig.yaml`. Build парсит YAML fail-closed и допускает только top-level
`description`, `prompts` и `providers`: `prompts` обязаны ссылаться на существующие
локальные lowercase Markdown-файлы, а единственный provider обязан быть literal `echo`.
URL, commands, functions, plugins, exec и remote providers запрещены. Этот файл не
загружается в managed runtime или model context и не исполняется.

Поле `evals.command` в `harness.yaml` остаётся author-declared локальной командой. Managed
activation его не исполняет; наличие non-empty shell-shaped command требует публичной
attestation limitation с prefix `[EVAL_COMMAND_WARN]` и не является
compatibility/runtime proof.

`.harnesshub/results.json` может быть evidence input, но не загружается в model context.

Запрещены в managed artifact:

```text
scripts/
hooks/
bin/
src executable code
package.json install scripts
.mcp.json from third-party resource
binary files
symlinks
```

Сам SuperSkill plugin может иметь `.mcp.json`, потому что это reviewed first-party
distribution config, не candidate resource payload.

## 3. Evidence semantics

### `author_declared`

Автор описал expected behavior или score. Это useful metadata, но не proof.

### `static_checked`

Schema/scanner/digest выполнились без runtime execution.

### `compatibility_smoked`

Exact release был активирован через clean client setup и прошёл client-specific doctor.

### `human_reviewed`

Reviewer проверил artifact и минимум три representative tasks. Review должен фиксировать
limitations, а не только pass/fail.

### `independently_evaluated`

Outcome измерен не авторским declared score. Для MVP optional.

### Public rendering rule

Показывать named checks:

```text
Schema: pass
Static scan: pass
Permissions reviewed: pass
Claude Code activation: pass 2026-...
Codex activation: pass 2026-...
Human task review: 3 cases
Independent quality eval: not run
```

Не показывать общий `Safe` или `Verified quality` badge.

## 4. Static and inferred capability checks

### 4.1 Static rules

Расширить scanner следующими группами:

- literal secrets/tokens/private keys;
- prompt override/tool poisoning;
- hidden user deception instructions;
- pipe-to-shell/eval/base64 execution;
- secondary download/install;
- Unicode bidi/control characters;
- absolute sensitive paths;
- external URLs;
- shell command patterns;
- filesystem write/delete patterns;
- environment/credential access;
- external send/post/upload language;
- money/transfer/withdraw/card mutation language.

### 4.2 Inference mapping

| Detected content | Inferred capability |
|---|---|
| `curl`, HTTP URL, web fetch instructions | network |
| shell fenced blocks or command execution | shell |
| write/edit/remove/rename files | filesystem write |
| browser/playwright/chrome navigation | browser |
| env vars/API keys/tokens | credentials |
| email/post/message/upload/send | external send |
| customer/ticket/account data | user data |
| pay/charge/refund/withdraw/ledger mutation | money movement |

Diff result:

```ts
type CapabilityDiff = {
  declared: string[];
  inferred: Array<{
    capability: string;
    status: "detected" | "not_detected";
    evidence: Array<{ file: string; rule: string }>;
  }>;
  undeclared: Array<{
    capability: string;
    severity: "warn" | "fail";
    evidence: Array<{ file: string; rule: string }>;
  }>;
};
```

Public DTO содержит только capability/rule summary, не excerpts.
`not_detected` означает только отсутствие static signal и не доказывает, что действие
невозможно. Copy разделяет `declared false` и `static signal not detected`.

## 5. Curation workflow

### 5.1 Candidate intake

Для внутренней alpha resource попадает только из:

- существующего seed package;
- реально используемого командой workflow;
- explicitly licensed source, который команда имеет право package-ить.

253 browse-only external entries не являются intake queue автоматически.

### 5.2 Review steps

```text
candidate source
→ normalize instruction package
→ honest manifest
→ create version snapshot
→ compute digest
→ schema/static/capability checks
→ Claude Code activation smoke
→ Codex activation smoke
→ 3 human-reviewed tasks
→ write limitations
→ approve exact digest
→ regenerate managed index
```

### 5.3 Reviewer separation

Для internal alpha достаточно одного reviewer, если:

- reviewer не является автоматическим generator того же artifact;
- high-stakes review-only resources дополнительно проверяет второй человек/agent pass;
- attestation хранит primary и independent public-safe reviewer labels, timestamps,
  passing independent verdict и exact covered case IDs;
- support, incident, security и finance approval fail closed без второго pass, с тем же
  reviewer label или без покрытия всех human cases.

Никакого four-eyes approval UI в MVP.

### 5.4 Review freshness

- static/digest: valid until artifact digest changes;
- client activation smoke: 90 дней или client major compatibility change;
- human review: 180 дней или artifact digest changes;
- source/license: recheck при source change;
- security advisory: immediate quarantine until review.

Build fails approved item with expired mandatory check.

## 6. Initial catalog

### Existing 12 candidates

| Category | Resources |
|---|---|
| Research and strategy | deep-market-researcher, gtm-research-sprint, product-strategy-critic, founder-decision-memo |
| Repo and engineering | repo-truth-auditor, agent-harness-refactorer, incident-rca-commander |
| Safety and readiness | launch-readiness-reviewer, security-permission-auditor, finance-payment-safety-reviewer |
| Operations and support | support-triage-agent, data-quality-sentinel |

Все 12 сначала `candidate`. Старый registry presence не даёт approval.

### Additional 8

Источником должны быть реальные recurring workflows команды. Selection procedure:

1. Собрать 15–20 последних повторяемых задач команды.
2. Сгруппировать по JTBD.
3. Исключить задачи, уже покрытые 12 candidates.
4. Выбрать 8 с минимум тремя реальными примерами каждая.
5. Создать instruction package только после source/owner/license decision.

Число 20 является supply gate, но filler-resources запрещены.

## 7. Deterministic ranking

## 7.1 Task normalization

Server:

1. Unicode NFKC.
2. Lowercase.
3. Collapse whitespace.
4. Remove punctuation except `+`, `#`, `-` inside tokens.
5. Split words.
6. Remove small bilingual stopword set.
7. Keep unique tokens and original normalized phrase.

No stemming library in MVP. Curation aliases cover domain variants.

## 7.2 Candidate generation

Candidate enters scoring if any:

- exact intent phrase match;
- at least two task tokens overlap intent/outcome/title/summary;
- structured plugin hint references a job ID.

Exclusion phrase match removes candidate before scoring.

## 7.3 Score components

Total 100.

### Task fit — 40

- exact intent phrase: +18 max;
- intent token overlap: up to +12;
- outcome phrase/token match: up to +6;
- title/summary support: up to +4.

Token overlap:

```text
overlap = matched unique task tokens / max(1, unique task tokens)
points = round(overlap * component max)
```

### Selected-client compatibility — 15

- verified and fresh: 15;
- available/not smoked/missing/blocked: filtered for approved recommendations.

`available` разрешён только для candidate/debug detail и никогда не попадает в router.

### Exact-release trust — 15

- all mandatory checks pass, no warn: 15;
- mandatory pass with reviewed warnings: 10;
- any fail/expired: filtered.

### Evaluation evidence — 10

- independent eval: 10;
- human-reviewed task cases only: 6;
- author-declared only: 2;
- none: 0.

### Permission fit — 10

- no new powers compared only against installed managed refs: 10;
- readonly/allowlisted candidate permissions with incomplete client baseline: 7;
- shell/browser/user-data/runtime credentials: 3;
- baseline unknown: 2;
- hard block: filtered.

Unmanaged skills and client sandbox policy are never inferred from
`permissionsKnown:boolean`; response marks this part of delta `partial/unknown`.

### Currentness — 5

- review <=30 days: 5;
- <=90 days: 3;
- <=180 days: 1;
- expired: filtered.

### Context cost — 5

- <=4k: 5;
- <=8k: 3;
- <=16k: 1;
- >16k: 0;
- >32k: filtered.

## 7.4 Decision and confidence

Sort:

1. score descending;
2. lower risk score;
3. lower context tokens;
4. stable capability ID.

Decision:

- top score >=75 and gap to second >=10 → `recommend`;
- top score 55–74 or gap <10 → `needs_clarification`;
- top score <55 or no candidates → `no_safe_match`.

Confidence:

```text
scorePart = topScore / 100
gapPart = min(max(topScore - secondScore, 0), 20) / 20
confidence = round((scorePart * 0.7 + gapPart * 0.3) * 100) / 100
```

If only one candidate, `secondScore=0`, but confidence still capped at 0.9 during
internal alpha.

## 7.5 Explanation codes

Allowed `why.code` values:

```text
INTENT_EXACT
INTENT_OVERLAP
OUTCOME_MATCH
CLIENT_VERIFIED
TRUST_CHECKS_PASS
HUMAN_CASES
INDEPENDENT_EVAL
LOW_PERMISSION_DELTA
CURRENT_REVIEW
LOW_CONTEXT_COST
```

Free-form model-generated explanations are not used by server. Client may render these
codes with localized templates.

## 8. Router fixture suite

Staged suite:

- Stage A/PR-05 merge: minimum 30 cases for the initial 12 resources — 18 positive,
  5 ambiguous, 3 out-of-scope, 4 adversarial/exclusion/high-risk; every approved
  resource has at least one positive case;
- Stage B: minimum 60 cases, adding observed team failures and close alternatives;
- Stage C/final proof: minimum 100 cases — 60 positive, 20 ambiguous,
  10 out-of-scope, 10 adversarial/exclusion/high-risk.

Fixture:

```json
{
  "id": "market-001",
  "task": "Compare competitors with sources and assumptions separated",
  "client": "codex",
  "expectedDecision": "recommend",
  "allowedTop": ["market-research"],
  "forbidden": ["support-triage"],
  "expectedReasonCodes": ["INTENT_OVERLAP", "CLIENT_VERIFIED"]
}
```

Run every case for both clients unless case explicitly tests client incompatibility.

Gates:

- forbidden/revoked appearance: 0;
- positive top-1 >=70%;
- positive top-3 >=90%;
- ambiguous correctly non-confident >=80%;
- out-of-scope `no_safe_match` 100%;
- same catalog/context produces deterministic result.

The same gates apply at 30/60/100; sample counts grow without changing the 90% top-3
threshold. These are test gates, not public quality claims.

## 9. Quarantine and revoke

### Quarantine

Used when investigation/review pending. May include replacement. Existing pinned users
get warning; new activation blocked.

### Revoke

Used for confirmed unsafe/invalid release. Exact digest remains in index history for
doctor matching. Digest is also appended to persisted
`SUPERSKILL_REVOCATIONS_PATH`. Eligibility and exact release routes check this overlay
before catalog data, so a code/index rollback cannot re-enable it. New
recommendation/activation blocked, including pinned reuse; offline activation is denied.

Only supported operator path:

```bash
node scripts/superskill-revoke.ts \
  --digest sha256:<digest> \
  --capability <id> --ref <owner/name> --version <semver> \
  --reason <reason-code> --actor <team-label> \
  [--replacement <ref@version#digest>] \
  --dry-run|--apply
```

`--apply` takes an exclusive file lock, reloads/validates all JSONL, appends one line,
fsyncs file and parent directory, then reloads. Same event/alias is idempotent; same
digest under another tuple adds an alias; event-ID conflict fails closed. Manual
production JSONL editing is prohibited.

### Drill

Before alpha:

1. Pin test resource in Claude Code.
2. Pin same digest in isolated Codex home/project.
3. Mark curated release revoked.
4. Rebuild/redeploy index.
5. Verify no recommendation.
6. Verify cached activation start blocked.
7. Roll back to previous index release and verify activation remains blocked by tombstone.
8. Verify both doctors report affected digest.
9. Verify remove only touches managed files.

## 10. Trust/routing acceptance

- Eligibility executes before score.
- Score contains no heat, stars, installs or payment.
- Declared author score contributes at most 2/10 eval points.
- Both clients have explicit compatibility check.
- Exact digest status is rechecked before activation.
- Warning/unknown states are rendered honestly.
- All ranking math is covered by pure tests.
- Curated build fails closed on missing/expired evidence.
