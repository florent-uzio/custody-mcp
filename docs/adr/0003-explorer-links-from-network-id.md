# Explorer links come from Custody's networkId, node URLs only for custom networks

Explorer links (see GLOSSARY.md) are built by this server, not by the agent, and only for XRPL ledgers. Each XRPL ledger in Custody already reports its `networkId`, so networks 0, 1 and 2 map straight to `livenet.xrpl.org`, `testnet.xrpl.org` and `devnet.xrpl.org` with nothing to configure. For any other network, an Environment can optionally map a Custody `ledgerId` to a node URL (`xrplNodes`), and links point at `custom.xrpl.org/<host:port>`. When a ledger is on a known network, the known explorer wins over any configured node URL, so a stray entry can't produce wrong links. With no way to resolve the explorer, the result simply has no link. The env-var Environment `env` gets links for known networks only.

## Considered Options

- **One wss URL per Environment, matched against the public-servers list**: rejected. A Custody instance can hold several XRPL ledgers (e.g. mainnet and testnet), the same network is reachable through many URLs, and the list changes over time.
- **Give the agent the explorer base and let it assemble links**: rejected, because it invites wrong paths and invented links.
- **An MCP tool to write the config**: rejected. It would let an agent change an Environment's access level (see ADR-0001). Agents with file access edit the config directly, since it is re-read on every call.
