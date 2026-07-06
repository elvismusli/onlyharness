# M4.3 Bounties Detail

Date: 2026-07-06. Scope: local implementation only, no production deploy.

## Contract

Bounties are customer-funded requests for a delivered harness. The bounty table has the plan-required statuses:

`open -> claimed -> delivered -> paid`

Rules:

- `paid` is never a DB-only flag. A bounty can become `paid` only after a linked M4.2 `gate_escrow` purchase is captured.
- Acceptance is through a signed `hh gate --receipt` for the delivered harness.
- The receipt used for acceptance must match the delivered receipt hash and must pass the target harness/version.
- The linked escrow purchase must match the delivered target, bounty amount and currency.
- One escrow purchase can be linked to only one bounty.
- Bounty state must not grant archive access, entitlements, or provider settlement by itself.

## API

- `POST /bounties`
  - Authenticated customer creates an `open` bounty.
  - Body: `{ title, spec, budget_usd, currency? }`.
- `GET /bounties`
  - Lists bounties, newest first.
- `POST /bounties/{id}/claim`
  - Authenticated builder claims an `open` bounty.
  - Idempotent for the same claimant.
- `POST /bounties/{id}/deliver`
  - Claimant submits `{ harness, version, receipt }`.
  - Receipt must verify and have `verdict=passed`.
  - Bounty becomes `delivered`.
- `POST /bounties/{id}/accept`
  - Customer submits `{ provider_ref, receipt }`.
  - Captures the linked `gate_escrow` purchase through M4.2.
  - Bounty becomes `paid` only if capture returns `captured` or `already_captured`.
  - Stores `payment_purchase_id`, `escrow_provider_ref`, and `accepted_receipt_hash` after capture.

## Money Boundary

The current implementation does not create a bounty-specific checkout. For M4.3 local flow, the customer funds the delivered harness through the existing `gate_escrow` checkout and then accepts the bounty with the captured receipt.

This keeps money semantics honest:

- bounties track work state;
- purchases/entitlements track payment state;
- payout tooling remains draft/manual only.
- API consumers should treat linked purchase/capture evidence as the payment source of truth; bounty `paid` is a derived work-state marker.

## Verification

Required before commit:

- Unit tests for create, claim, deliver and accept.
- Smoke flow: create bounty -> claim -> deliver with signed passing receipt -> create gate escrow checkout for the delivered harness -> accept -> bounty `paid`.
- Negative checks: non-customer cannot accept, failing delivery receipt is rejected, underfunded escrow is rejected, one escrow cannot pay multiple bounties, and `paid` cannot happen without escrow capture.
