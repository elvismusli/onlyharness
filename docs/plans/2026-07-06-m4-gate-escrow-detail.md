# M4.2 Gate Escrow Detail

Date: 2026-07-06. Scope: local implementation only, no production deploy.

## Contract

`pricing.model: gate_escrow` is a paid harness mode where payment is reserved before archive delivery and captured only after a valid passing gate receipt.

State machine:

| Current | Input | Next | Entitlement |
| --- | --- | --- | --- |
| `pending` | provider confirms payment | `reserved` | create `escrow_reserved`, expires in 72h |
| `reserved` | valid receipt with `verdict=passed` before expiry | `captured` | replace `escrow_reserved` with `one_time` |
| `reserved` | valid receipt with `verdict=failed` before expiry | `refunded` | remove `escrow_reserved` |
| `reserved` | explicit timeout after expiry | `refunded` | remove `escrow_reserved` |

One-time and subscription purchases must keep their existing behavior. x402 purchases for `gate_escrow` must reserve, not grant a paid entitlement immediately.

## Receipt Rules

Receipt submission must verify the same `onlyharness.gate_receipt.v1` signature used by `POST /receipts`, then match:

- `payload.harness === owner/repo`
- `payload.version === purchase.version`
- `payload.resultsHash` is stored as evidence through the receipt hash

Invalid shape/signature, wrong harness, or wrong version must not mutate money state.

## API

- `POST /billing/escrow/receipt`
  - Authenticated buyer only.
  - Body: `{ provider_ref, receipt }`.
  - Mutates only that buyer's reserved `gate_escrow` purchase.
  - Returns `captured` for pass receipts and `refunded` for fail receipts.
- `POST /billing/escrow/timeout`
  - Authenticated buyer only.
  - Body: `{ provider_ref }`.
  - Refunds only after `escrow_expires_at`.

Both endpoints are idempotent for already-final purchases.

## Journal

Every transition is recorded in the existing unified events table/local log:

- `escrow_reserved`
- `escrow_captured`
- `escrow_refunded`

Events stay privacy-safe: owner/repo/version/subject/target/client only, no prompts, paths, receipt body, keys or provider secrets.

## Verification

Required before commit:

- API unit tests for reserve/capture/refund/timeout pure behavior.
- CLI/API smoke covers `gate_escrow`: checkout -> webhook reserve -> archive allowed -> signed pass receipt -> captured; fail receipt -> refunded; timeout -> refunded.
- Existing one-time manual, x402 and receipt verification smokes remain green.
