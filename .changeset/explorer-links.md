---
'@florent-uzio/custody-mcp': minor
---

Add Explorer links: `listTransactions`, `getTransaction`, `listAccountAddresses` and `findAccountByAddress` now return an `explorerUrl` for transactions and addresses on XRPL ledgers. Mainnet, testnet and devnet ledgers link to `livenet.xrpl.org`, `testnet.xrpl.org` and `devnet.xrpl.org` with no setup, based on the networkId Custody reports. For a custom network, set the optional `xrplNodes` (`{ "<ledgerId>": "wss://host:port" }`) on an Environment in the config file, and links point to `custom.xrpl.org`.
