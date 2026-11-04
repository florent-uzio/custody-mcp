---
'@florent-uzio/custody-mcp': patch
---

The setup CLI now answers `--help` (or `-h`): `custody-mcp --help` lists every command, and `custody-mcp <command> --help` shows that command's usage without running it. An unknown command is now followed by the same usage list, and `remove-env` or `set-default` without a name shows its usage instead of `Unknown Environment "undefined"`.
