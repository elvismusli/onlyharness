# M4.4 Hosted Endpoints Decision

Date: 2026-07-06. Scope: decision record only, no runner build in this slice.

## Decision

Do not build first-party hosted execution endpoints in the current M4 rollout.

Keep OnlyHarness focused on registry, local install/run, paid archive access, x402 purchase, gate escrow, and bounty acceptance. Hosted execution remains partner-first/manual until author demand proves the need for a first-party runner.

## Why

Hosted endpoints change the product risk profile:

- arbitrary harness execution requires sandboxing, quotas, secrets isolation, network controls, abuse handling, and uptime;
- per-call billing needs metering, idempotency keys, replay protection, refunds, and customer-visible invocation receipts;
- money state must stay provider-backed, not inferred from API invocation rows;
- current demand signal is not enough to justify building runner infrastructure before creator requests are proven.

## Current Contract

- There is no public hosted `/run` or per-call execution endpoint.
- `hh run` is local execution only.
- MCP `pull_harness` and HTTP archive endpoints deliver files after entitlement; they do not execute author code server-side.
- `pricing.model=per_call` returns HTTP 409 with `code=HOSTED_EXECUTION_NOT_AVAILABLE`; it must not create checkout sessions, x402 requirements, archive entitlements, or files until a hosted or partner-backed execution path exists.

## Build Trigger

Revisit build-vs-partner when at least one of these is true:

- three paying creators ask for hosted execution, with concrete workloads and pricing;
- a bounty or paid harness cannot be delivered as local files without unacceptable buyer friction;
- a partner path cannot satisfy security, metering, and agent-first API requirements.

## If We Build Later

Create a separate implementation plan before code. Minimum scope:

- `hosted_endpoints`, `endpoint_deployments`, and `endpoint_invocations` tables;
- signed deployment provenance from a verified harness version;
- isolated runner with CPU/memory/time/network limits and no ambient secrets;
- idempotent invocation API with customer-supplied idempotency key;
- per-call settlement through x402 or the existing payment provider port;
- invocation receipts that separate execution result from payment settlement;
- OpenAPI/MCP docs that expose hosted execution only after runtime smoke passes.

## Verification

This slice is complete when docs and agent-facing discovery explicitly say hosted execution is not live yet, and runtime smoke proves `per_call` archive/checkout fail closed with `HOSTED_EXECUTION_NOT_AVAILABLE`.
