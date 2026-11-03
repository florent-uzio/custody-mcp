# Config stores key references, never private keys

Environments are kept in `~/.config/custody-mcp/config.json`, but each one points at its private key (`keychain:`, `file:`, `env:`) instead of embedding it, so the config file can be read, diffed or shared without leaking a key, and the macOS Keychain is the default store written by `add-env`. Keys are resolved lazily on an Environment's first use, so one broken reference does not stop the server. The four `AUTH_URL`/`API_URL`/`PUBLIC_KEY`/`PRIVATE_KEY` env vars remain supported as a single Environment named `env` for zero-setup use.

## Considered Options

- **Env vars only, one MCP server entry per instance** (the original handoff) — simple, but switching instances means editing client config and private keys sit in plain text in it.
- **PEM inline in the config file** — rejected: turns a convenience file into a secret.
