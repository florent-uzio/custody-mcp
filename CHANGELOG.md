# @florent-uzio/custody-mcp

## 0.1.2

### Patch Changes

- 934b4cb: The "No Environment configured" error and the server instructions now say `npx @florent-uzio/custody-mcp@latest add-env <name>`, matching the README, so `npx` runs the latest release instead of a cached copy.

## 0.1.1

### Patch Changes

- 6bc10a8: README: add the `claude mcp add` command, and use `@latest` in every `npx` command so `npx` picks up new releases instead of a cached copy.

## 0.1.0

### Minor Changes

- d2f9c00: First release: read from Ripple Custody, and Propose, Approve and Reject Intents, as your own Custody user from an MCP client. Includes the `add-env`, `list-envs`, `remove-env` and `set-default` setup commands.
