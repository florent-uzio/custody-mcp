---
'@florent-uzio/custody-mcp': minor
---

Upgrade custody.js to 3.0.0. `proposeXrplIntent` and `dryRunXrplIntent` take an XLS-68 `sponsorship`, and `proposeXrplIntent` supports the `SponsorshipSetAsSponsor` and `SponsorshipSetAsSponsee` operations. New Batch (v1.1) tools: `dryRunBatchIntent`, `signBatchSigner`, `getBatchSignature` and `proposeBatchIntent`.
