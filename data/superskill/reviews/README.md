# SuperSkill review attestations

Only exact-digest `superskill.review.v1` attestations belong here. A candidate is not
approved merely because it exists in the managed catalog. Approval requires fresh
Claude Code and Codex compatibility smokes plus at least three human-reviewed cases.
Author, release-cutter and reviewer identities must use immutable public numeric
`github-id:<digits>` actor IDs with the current GitHub handle as a display label. Catalog promotion loads the
exact review packet and fails closed if attestation authorship drifts or the reviewer
actor matches the author or release cutter.
