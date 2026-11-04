# custody-mcp

An MCP server that lets you read from and act on Ripple Custody instances, as your own Custody user, from an AI client such as Claude Code.

> **For test and demo instances.** The server can Propose, Approve and Reject Intents that move real assets on the instance it points at. Use it with dev boxes, demo sandboxes and staging, not with production custody.

## Supported clients

The server speaks only the 2026-07-28 MCP protocol (the one `@mastra/mcp` 2.x serves over stdio). Claude Code works. A client that only speaks a 2025 protocol revision fails at `initialize` with `Unsupported protocol version`.

## Use it from your MCP client

The server runs with `npx`, so there is nothing to clone or build. In Claude Code, add it for all your projects with:

```sh
claude mcp add custody --scope user -- npx -y @florent-uzio/custody-mcp@latest
```

For other clients, add it to the client's MCP config:

```json
{
  "mcpServers": {
    "custody": {
      "command": "npx",
      "args": ["-y", "@florent-uzio/custody-mcp@latest"]
    }
  }
}
```

`@latest` makes `npx` check npm each time the client starts the server, so you get new releases on your next client restart instead of a copy cached by `npx`. To stay on one version, pin it instead, e.g. `@florent-uzio/custody-mcp@0.1.0`.

The server needs at least one **Environment**: a Ripple Custody instance together with the credentials of your Custody user on it. Set one up with the setup CLI below.

## Setup CLI

The same `custody-mcp` command, run with a subcommand, manages your Environments. With no subcommand it starts the MCP server.

| Command                                                   | What it does                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| `npx @florent-uzio/custody-mcp@latest add-env <name>`     | Sets up a new Environment, step by step.                             |
| `npx @florent-uzio/custody-mcp@latest list-envs`          | Shows every Environment and where its key is stored (never the key). |
| `npx @florent-uzio/custody-mcp@latest remove-env <name>`  | Removes an Environment from the config file.                         |
| `npx @florent-uzio/custody-mcp@latest set-default <name>` | Makes an Environment the one read tools use when a call names none.  |

Changes take effect straight away: the server re-reads the config file on every tool call, so you do not need to restart your AI client.

### `add-env <name>`

```sh
npx @florent-uzio/custody-mcp@latest add-env dev
```

It walks you through these steps:

1. Asks for the instance's **auth URL** and **API URL**.
2. Generates a new keypair, or imports yours (see the options below), and stores the private key.
3. Prints the **public key** in the format Custody expects. Register it for your Custody user, then press Enter.
4. Checks that the login works by calling Custody's "me" endpoint. If it fails (wrong URL, key not registered yet), nothing is saved and you can run `add-env` again.
5. Lists the domains your user belongs to and asks which one is the **Default domain** (Enter picks the first).
6. Asks for the **Access level**: `read` (the default), `propose` (read + Propose Intents) or `approve` (propose + Approve/Reject Intents).
7. Saves the Environment.

Options:

| Option                                      | Default    | What it does                                                                                          |
| ------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `--algorithm ed25519\|secp256k1\|secp256r1` | `ed25519`  | The algorithm of the keypair to generate.                                                             |
| `--import <pem-file>`                       |            | Uses an existing private key PEM instead of generating one, e.g. a key already registered in Custody. |
| `--store keychain\|file\|env`               | `keychain` | Where the private key is kept (see below).                                                            |

### Where private keys are kept

The config file never holds a private key, only a **Key reference** saying where it is (see [ADR-0002](docs/adr/0002-key-references-in-config.md)). So you can read, diff or share the config file without leaking a key.

| `--store`  | Key reference                       | Notes                                                                                                                                                                         |
| ---------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keychain` | `keychain:custody-mcp/<name>`       | The macOS Keychain (through the `security` tool).                                                                                                                             |
| `file`     | `file:<config dir>/keys/<name>.pem` | A PEM file next to the config file, readable only by you (`0600`). For machines without a Keychain.                                                                           |
| `env`      | `env:<VAR>`                         | Points at a key you have already exported in an env var: `add-env` asks for the var's name and reads the key from it. The env var must also be set where the MCP server runs. |

A key is read the first time its Environment is used, so a broken Key reference only affects that one Environment.

`remove-env` does not delete the private key: it prints where the key is, so you can delete it yourself if you no longer need it.

## Config file

Environments are saved in `~/.config/custody-mcp/config.json`. Set `CUSTODY_MCP_CONFIG` to use a file somewhere else, for example to keep separate sets of Environments.

```json
{
  "default": "dev",
  "environments": {
    "dev": {
      "authUrl": "https://auth.example.com/token",
      "apiUrl": "https://api.example.com",
      "publicKey": "MCowBQYDK2VwAyEA…",
      "keyReference": "keychain:custody-mcp/dev",
      "access": "read",
      "defaultDomainId": "…",
      "xrplNodes": { "<ledgerId>": "wss://repo-sandbox.ripplex.io:6006" }
    }
  }
}
```

The file is read on every tool call, so edits (by hand or by an agent with file access) apply without a restart.

### Explorer links

Results with a transaction hash or an address on an XRPL ledger (`listTransactions`, `getTransaction`, `listAccountAddresses`, `findAccountByAddress`) carry an `explorerUrl`. Ledgers on mainnet, testnet and devnet link to `livenet.xrpl.org`, `testnet.xrpl.org` and `devnet.xrpl.org` with nothing to configure. For an XRPL ledger on any other network, map its `ledgerId` (see `listLedgers`) to a node URL in `xrplNodes`, and links point to `custom.xrpl.org`. Without one, results simply have no `explorerUrl`.

### Zero-setup env vars

If `AUTH_URL`, `API_URL`, `PUBLIC_KEY` and `PRIVATE_KEY` are set (as in custody-mpt-demo), they are picked up as an extra Environment named `env`. Its Access level is `read` unless you set `CUSTODY_ACCESS` to `propose` or `approve`.

## Access levels and confirmations

Each Environment has an **Access level**, chosen in `add-env` (or with `CUSTODY_ACCESS` for the `env` Environment). It caps what the AI client can do through that Environment:

| Access level     | Allows                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `read` (default) | Reading: users (`getMe`, `listUsers`), domains, accounts, balances, Intents, transfers, transactions, Dry runs. |
| `propose`        | `read`, plus Proposing Intents (`proposeXrplIntent`, `proposeIntent`).                                          |
| `approve`        | `propose`, plus Approving and Rejecting Intents (`approveIntent`, `rejectIntent`).                              |

The Access level only limits this server. What your Custody user may do is still decided by Custody's own roles and policies.

### Guardrails

- Every propose, approve or reject call must name its Environment explicitly: a write never falls back to the default.
- A tool above an Environment's Access level is refused before anything is sent to Custody.
- Every Propose runs a Dry run first and proposes nothing if it fails.
- Every Approve or Reject asks you for confirmation in your client (see [ADR-0001](docs/adr/0001-approve-through-mcp.md)): the client shows a summary of the Intent, and nothing reaches Custody unless you accept. If your client cannot show a confirmation, the assistant is instructed to summarise the Intent and wait for your explicit "yes", and the result says that no in-client confirmation was shown.
- Proposing returns at once. `waitForIntent` follows an Intent for a bounded time; `Executed` means Custody accepted the order, not that it settled on the ledger.

## Development

```sh
npm ci
npm test          # unit tests, plus a check that the packed tarball installs and starts
npm run mcp       # the server from source, over stdio
```

### Smoke test against a real instance

`scripts/smoke.ts` is a manual end-to-end check, never run in CI: it proposes and approves a real (tiny) XRP Payment. It starts the server from source over stdio, with your own config file, and prints the backend version, runs reads, a Dry run, a Propose, `waitForIntent` and an Approve.

```sh
npx tsx scripts/smoke.ts --env devbox --account <r… sender> --destination <r… receiver> [--amount <drops>] [--approver devbox-2]
```

- `--env` needs Access level `approve`. The script first approves as the proposer and records whether Custody lets that approval count (self-approval).
- If it does not, pass `--approver`: a second Environment, for another Custody user with Access level `approve`, which then approves.
- Each Approve asks you to confirm in the terminal, as your client would.

### Releasing

Releases use [Changesets](https://github.com/changesets/changesets). Add a changeset with your change (`npx changeset`). On `main`, the release workflow opens a "Version Packages" PR; merging it publishes to npm with npm trusted publishing (no npm token in the repo). `npm publish` first runs the `prepublishOnly` guard: formatting, types and tests, including installing the packed tarball and starting it.
