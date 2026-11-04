import type { DefineCustodyTool } from './define'

/** Read tools for the reference data of a Custody instance, which is the same in every domain. */
export const createReferenceTools = (defineCustodyTool: DefineCustodyTool) => ({
  listTickers: defineCustodyTool({
    id: 'listTickers',
    description:
      'List the tickers (assets) of the Custody instance, one page at a time, to resolve an asset name or symbol to its tickerId.',
    paged: true,
    input: {},
    run: async ({ custody, pageQuery }) => {
      const page = await custody.tickers.list(pageQuery)
      return {
        // The ticker's top-level fields are deprecated copies of `data`.
        tickers: page.items.map(({ data }) => ({
          id: data.id,
          ledgerId: data.ledgerId,
          kind: data.kind,
          name: data.name,
          symbol: data.symbol,
          decimals: data.decimals,
          lock: data.lock,
        })),
        nextCursor: page.nextStartingAfter,
      }
    },
  }),

  listLedgers: defineCustodyTool({
    id: 'listLedgers',
    description:
      'List the ledgers (blockchain networks) of the Custody instance, one page at a time, to resolve a network name to its ledgerId.',
    paged: true,
    input: {},
    run: async ({ custody, pageQuery }) => {
      const page = await custody.ledgers.list(pageQuery)
      return {
        ledgers: page.items.map(({ data }) => ({ id: data.id, alias: data.alias, type: data.parameters.type })),
        nextCursor: page.nextStartingAfter,
      }
    },
  }),
})
