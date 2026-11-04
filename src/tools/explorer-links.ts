import type { CustodyClient } from '../custody'
import type { Environment } from '../environments'

// The XRPL networks with a public explorer, by the networkId Custody reports for an XRPL ledger (ADR-0003).
const KNOWN_EXPLORERS: Record<number, string> = {
  0: 'https://livenet.xrpl.org',
  1: 'https://testnet.xrpl.org',
  2: 'https://devnet.xrpl.org',
}

/** Builds Explorer links (see GLOSSARY.md); returns undefined when the explorer cannot be resolved. */
export type ExplorerLinks = {
  transaction: (ledgerId: string, hash: string | undefined) => Promise<string | undefined>
  address: (ledgerId: string, address: string) => Promise<string | undefined>
}

/**
 * Explorer links for one Custody client. Each ledger's networkId is read from Custody once and kept,
 * while node URLs come from the Environment of each call, so a config edit applies at once.
 */
export const createExplorerLinks = (custody: CustodyClient) => {
  // null: not an XRPL ledger. A failed read is not kept, so the next call tries again.
  const networkIds = new Map<string, Promise<number | null>>()

  const networkIdOf = (ledgerId: string) => {
    let networkId = networkIds.get(ledgerId)
    if (networkId === undefined) {
      networkId = Promise.resolve()
        .then(() => custody.ledgers.get({ ledgerId }))
        .then(({ data }) => (data.parameters.type === 'XRPL' ? data.parameters.networkId : null))
      networkIds.set(ledgerId, networkId)
      networkId.catch(() => networkIds.delete(ledgerId))
    }
    return networkId
  }

  const explorerOf = async (environment: Environment, ledgerId: string) => {
    // A link is a convenience: failing to read the ledger must not fail the tool call.
    const networkId = await networkIdOf(ledgerId).catch(() => null)
    if (networkId === null) {
      return undefined
    }
    const known = KNOWN_EXPLORERS[networkId]
    if (known !== undefined) {
      return known
    }
    const node = environment.xrplNodes?.[ledgerId]
    return node === undefined ? undefined : `https://custom.xrpl.org/${new URL(node).host}`
  }

  return (environment: Environment): ExplorerLinks => ({
    transaction: async (ledgerId, hash) => {
      const explorer = hash === undefined ? undefined : await explorerOf(environment, ledgerId)
      return explorer && `${explorer}/transactions/${hash}`
    },
    address: async (ledgerId, address) => {
      const explorer = await explorerOf(environment, ledgerId)
      return explorer && `${explorer}/accounts/${address}`
    },
  })
}

/** Spread into a result: adds `explorerUrl` only when there is one. */
export const explorerUrlField = (explorerUrl: string | undefined) => (explorerUrl === undefined ? {} : { explorerUrl })
