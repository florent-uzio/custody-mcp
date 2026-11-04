---
'@florent-uzio/custody-mcp': patch
---

`add-env` now refuses `--import` together with `--store env`, instead of silently ignoring the imported file and reading the key from an env var.
