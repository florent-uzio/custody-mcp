# XRPL Intents go through custody.js, not the raw Propose path

The server has two ways to Propose. `proposeIntent` and `dryRunIntent` take a raw `v0_*` payload and build the request themselves: they find the Environment user's id in the domain, then run the Dry run and the Propose. `proposeXrplIntent` and `dryRunXrplIntent` instead call custody.js (`xrpl.proposeIntent` with `dryRun: true`, and `xrpl.dryRunIntent`). Behind those calls, custody.js validates the `Account` address, checks the Custody instance supports the operation type, resolves the Custody account, domain, ledger and author from the address, and builds the transaction order and its `payloadId`. custody.js does not expose that build step on its own, so routing XRPL Intents through the raw path would mean copying it here. The two paths stay separate. What they share is kept consistent instead: one domain membership check (`tools/author.ts`), and a failed Dry run worded the same way (`Dry run failed, intent not proposed: …`).

## Considered Options

- **One Propose path, with XRPL tools building a raw payload** (suggested by an architecture review): rejected. It would duplicate custody.js's address resolution, operation support check and transaction order building, and drift from it as custody.js changes.
- **Dry-run with `xrpl.dryRunIntent`, then propose with its returned `intentId`/`payloadId`**: rejected. It costs a second address resolution, and custody.js recommends `dryRun: true` so the request proposed is exactly the one that passed.
