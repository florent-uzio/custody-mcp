---
'@florent-uzio/custody-mcp': minor
---

Support `ConfidentialMPTSend` inside a Batch. The new `buildConfidentialSendLeg` tool has Custody compute the proofs of a send, and its `operation` is pasted into a Batch entry for `dryRunBatchIntent`, `signBatchSigner` and `proposeBatchIntent`.
