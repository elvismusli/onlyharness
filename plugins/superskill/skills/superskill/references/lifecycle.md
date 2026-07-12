# Lifecycle

Execution and pin state are independent.

`accepted -> downloading -> digest_verified -> ready -> loaded -> invoked -> outcome_success|outcome_failed|outcome_unknown`

Any nonterminal execution state may become `failed` with a safe reason code. Terminal outcome may only upgrade evidence for the same outcome to `user_confirmed`. Pin state is `none -> pinned -> removed`; installed/detected never means loaded or invoked.
