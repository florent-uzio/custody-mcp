import { describe, expect, it, vi } from 'vitest'
import { callTool, devOptions as options, fakeCustody, metadata, signed } from '../testing'

describe('read tools for reference data', () => {
  describe('listTickers', () => {
    it('lists the tickers of the Custody instance, compactly, with the next cursor', async () => {
      const data = {
        id: 'ticker-xrp',
        ledgerId: 'xrpl-testnet',
        kind: 'Native',
        name: 'XRP',
        decimals: 6,
        symbol: 'XRP',
        ledgerDetails: { type: 'XRPL', properties: { type: 'Native' } },
        lock: 'Unlocked',
        metadata,
      }
      // Custody repeats the ticker's fields at the top level, deprecated, around the signed data.
      const list = vi.fn(async () => ({
        count: 1,
        nextStartingAfter: 'ticker-xrp',
        items: [{ id: 'ticker-xrp', name: 'XRP (deprecated copy)', data, signature: 'SIG' }],
      }))

      const output = await callTool(options(fakeCustody({ tickers: { list } })), 'listTickers', {
        limit: 50,
        cursor: 'ticker-btc',
      })

      expect(output).toEqual({
        environment: 'dev',
        tickers: [
          {
            id: 'ticker-xrp',
            ledgerId: 'xrpl-testnet',
            kind: 'Native',
            name: 'XRP',
            symbol: 'XRP',
            decimals: 6,
            lock: 'Unlocked',
          },
        ],
        nextCursor: 'ticker-xrp',
      })
      expect(list).toHaveBeenCalledWith({ limit: 50, startingAfter: 'ticker-btc' })
    })
  })
  describe('listLedgers', () => {
    it('lists the ledgers of the Custody instance, compactly, with the next cursor', async () => {
      const list = vi.fn(async () => ({
        count: 1,
        nextStartingAfter: 'xrpl-testnet',
        items: [
          signed({
            id: 'xrpl-testnet',
            alias: 'XRPL Testnet',
            parameters: { type: 'XRPL', nativeTickerSymbol: 'XRP', nativeTickerName: 'XRP', networkId: 1 },
            metadata,
          }),
        ],
      }))

      const output = await callTool(options(fakeCustody({ ledgers: { list } })), 'listLedgers')

      expect(output).toEqual({
        environment: 'dev',
        ledgers: [{ id: 'xrpl-testnet', alias: 'XRPL Testnet', type: 'XRPL' }],
        nextCursor: 'xrpl-testnet',
      })
      expect(list).toHaveBeenCalledWith({ limit: 20, startingAfter: undefined })
    })
  })
})
