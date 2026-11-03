# custody-mcp

An MCP server that lets you read from and act on Ripple Custody instances, as your own Custody user, from an AI client such as Claude Code or Claude Desktop.

## Use it from your MCP client

Add the server to your client's MCP config. It runs with `npx`, so there is nothing to clone or build:

```json
{
  "mcpServers": {
    "custody": {
      "command": "npx",
      "args": ["-y", "@florent-uzio/custody-mcp"]
    }
  }
}
```

The server needs at least one **Environment**: a Ripple Custody instance together with the credentials of your Custody user on it. Set one up with the setup CLI below.

## Setup CLI

The same `custody-mcp` command, run with a subcommand, manages your Environments. With no subcommand it starts the MCP server.

| Command                                            | What it does                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| `npx @florent-uzio/custody-mcp add-env <name>`     | Sets up a new Environment, step by step.                             |
| `npx @florent-uzio/custody-mcp list-envs`          | Shows every Environment and where its key is stored (never the key). |
| `npx @florent-uzio/custody-mcp remove-env <name>`  | Removes an Environment from the config file.                         |
| `npx @florent-uzio/custody-mcp set-default <name>` | Makes an Environment the one read tools use when a call names none.  |

Changes take effect straight away: the server re-reads the config file on every tool call, so you do not need to restart your AI client.

### `add-env <name>`

```sh
npx @florent-uzio/custody-mcp add-env dev
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
      "defaultDomainId": "…"
    }
  }
}
```

### Zero-setup env vars

If `AUTH_URL`, `API_URL`, `PUBLIC_KEY` and `PRIVATE_KEY` are set (as in custody-mpt-demo), they are picked up as an extra Environment named `env`. Its Access level is `read` unless you set `CUSTODY_ACCESS` to `propose` or `approve`.

## Guardrails

- Every propose, approve or reject call must name its Environment explicitly: a write never falls back to the default.
- A tool above an Environment's Access level is refused before anything is sent to Custody.
- Every Propose runs a Dry run first and proposes nothing if it fails.
- Every Approve or Reject asks you for confirmation in your client (see [ADR-0001](docs/adr/0001-approve-through-mcp.md)).
