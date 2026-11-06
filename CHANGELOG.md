# @florent-uzio/custody-mcp

## 0.4.0

### Minor Changes

- 6538088: Upgrade custody.js to 3.0.0. `proposeXrplIntent` and `dryRunXrplIntent` take an XLS-68 `sponsorship`, and `proposeXrplIntent` supports the `SponsorshipSetAsSponsor` and `SponsorshipSetAsSponsee` operations. New Batch (v1.1) tools: `dryRunBatchIntent`, `signBatchSigner`, `getBatchSignature` and `proposeBatchIntent`.

## 0.3.0

### Minor Changes

- 7025b39: Add `decryptConfidentialInboxBalance` and `getConfidentialInboxDecryption`, which decrypt the inbox (CB_IN) balance of a confidential MPT for a Custody account. They use a Custody internal API that a public API is expected to replace.

### Patch Changes

- 1d84473: `proposeIntent` now words a failed Dry run the way `proposeXrplIntent` does (`Dry run failed, intent not proposed: …`), so both Propose tools fail alike.

## 0.2.0

### Minor Changes

- 2cf9694: Add Explorer links: `listTransactions`, `getTransaction`, `listAccountAddresses` and `findAccountByAddress` now return an `explorerUrl` for transactions and addresses on XRPL ledgers. Mainnet, testnet and devnet ledgers link to `livenet.xrpl.org`, `testnet.xrpl.org` and `devnet.xrpl.org` with no setup, based on the networkId Custody reports. For a custom network, set the optional `xrplNodes` (`{ "<ledgerId>": "wss://host:port" }`) on an Environment in the config file, and links point to `custom.xrpl.org`.
- ef1854c: `listEnvironments` now shows each Environment's `xrplNodes`, so an agent can see which custom XRPL networks already have a node URL before editing the config file.
- b6422cb: Add the read-only `listUsers` tool, which lists the users of a domain (id, alias, public key, roles, login ids), one page at a time. Until now only `getMe` returned a user, and only the Environment's own.

### Patch Changes

- 3f0f2a9: The setup CLI now answers `--help` (or `-h`): `custody-mcp --help` lists every command, and `custody-mcp <command> --help` shows that command's usage without running it. An unknown command is now followed by the same usage list, and `remove-env` or `set-default` without a name shows its usage instead of `Unknown Environment "undefined"`.
- a31e940: `add-env` now refuses `--import` together with `--store env`, instead of silently ignoring the imported file and reading the key from an env var.

## 0.1.2

### Patch Changes

- 934b4cb: The "No Environment configured" error and the server instructions now say `npx @florent-uzio/custody-mcp@latest add-env <name>`, matching the README, so `npx` runs the latest release instead of a cached copy.

## 0.1.1

### Patch Changes

- 6bc10a8: README: add the `claude mcp add` command, and use `@latest` in every `npx` command so `npx` picks up new releases instead of a cached copy.

## 0.1.0

### Minor Changes

- d2f9c00: First release: read from Ripple Custody, and Propose, Approve and Reject Intents, as your own Custody user from an MCP client. Includes the `add-env`, `list-envs`, `remove-env` and `set-default` setup commands.
