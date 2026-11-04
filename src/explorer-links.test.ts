import { describe, expect, it, vi } from 'vitest'
import type { CustodyClient } from './custody'
import { createCustodyMcpServer } from './server'
import { callTool, configFile, DEV, fakeCustody } from './testing'

const HASH = 'ABC123'
const ADDRESS = 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY'

/** Custody's signed ledger record, as `ledgers.get` returns it. */
const ledger = (id: string, parameters: object) => ({
  data: { id, alias: id, parameters },
  signature: 'SIG',
  signingKey: 'SIGNING KEY',
})

const LEDGERS: Record<string, ReturnType<typeof ledger>> = {
  'xrpl-mainnet': ledger('xrpl-mainnet', { type: 'XRPL', networkId: 0 }),
  'xrpl-testnet': ledger('xrpl-testnet', { type: 'XRPL', networkId: 1 }),
  'xrpl-devnet': ledger('xrpl-devnet', { type: 'XRPL', networkId: 2 }),
  'xrpl-sandbox': ledger('xrpl-sandbox', { type: 'XRPL', networkId: 21337 }),
  ethereum: ledger('ethereum', { type: 'Ethereum' }),
}

const ledgers = () => ({ get: vi.fn(async ({ ledgerId }: { ledgerId: string }) => LEDGERS[ledgerId]) })

const options = (custody: CustodyClient, xrplNodes?: Record<string, string>) => ({
  env: {
    DEV_KEY: 'DEV KEY',
    CUSTODY_MCP_CONFIG: configFile({
      environments: { dev: { ...DEV, keyReference: 'env:DEV_KEY', defaultDomainId: 'domain-1', xrplNodes } },
    }),
  },
  connect: () => custody,
})

const transactionOn = (ledgerId: string) => ({
  id: 'transaction-1',
  ledgerId,
  registeredAt: '2026-01-01T00:02:00Z',
  ledgerTransactionData: { ledgerStatus: 'Confirmed', ledgerTransactionId: HASH, statusLastUpdatedAt: '2026-01-01' },
  relatedAccounts: [],
  relatedTransactions: [],
})

const explorerUrlOfListedTransaction = async (ledgerId: string, xrplNodes?: Record<string, string>) => {
  const transactions = async () => ({ count: 1, items: [transactionOn(ledgerId)] })
  const output = (await callTool(
    options(fakeCustody({ transactions: { transactions }, ledgers: ledgers() }), xrplNodes),
    'listTransactions',
  )) as { transactions: { explorerUrl?: string }[] }
  return output.transactions[0].explorerUrl
}

describe('Explorer links', () => {
  it.each([
    ['xrpl-mainnet', 'https://livenet.xrpl.org'],
    ['xrpl-testnet', 'https://testnet.xrpl.org'],
    ['xrpl-devnet', 'https://devnet.xrpl.org'],
  ])('links a transaction on %s to the public explorer, with nothing configured', async (ledgerId, explorer) => {
    expect(await explorerUrlOfListedTransaction(ledgerId)).toBe(`${explorer}/transactions/${HASH}`)
  })

  it('links a transaction on a custom network to the custom explorer of its configured node', async () => {
    const url = await explorerUrlOfListedTransaction('xrpl-sandbox', {
      'xrpl-sandbox': 'wss://repo-sandbox.ripplex.io:6006',
    })

    expect(url).toBe(`https://custom.xrpl.org/repo-sandbox.ripplex.io:6006/transactions/${HASH}`)
  })

  it('gives no link on a custom network with no configured node', async () => {
    expect(await explorerUrlOfListedTransaction('xrpl-sandbox')).toBeUndefined()
  })

  it('keeps the public explorer of a known network even when a node is configured for its ledger', async () => {
    const url = await explorerUrlOfListedTransaction('xrpl-testnet', { 'xrpl-testnet': 'wss://my-node.example:51233' })

    expect(url).toBe(`https://testnet.xrpl.org/transactions/${HASH}`)
  })

  it('gives no link on a ledger that is not XRPL', async () => {
    expect(await explorerUrlOfListedTransaction('ethereum')).toBeUndefined()
  })

  it('still returns the result, without a link, when the ledger cannot be read', async () => {
    const transactions = async () => ({ count: 1, items: [transactionOn('xrpl-testnet')] })
    const get = async () => {
      throw new Error('Forbidden')
    }

    const output = await callTool(
      options(fakeCustody({ transactions: { transactions }, ledgers: { get } })),
      'listTransactions',
    )

    expect(output).toMatchObject({ transactions: [{ id: 'transaction-1', ledgerTransactionId: HASH }] })
    expect((output as { transactions: object[] }).transactions[0]).not.toHaveProperty('explorerUrl')
  })

  it('reads each ledger from Custody once, across calls', async () => {
    const transactions = async () => ({
      count: 2,
      items: [transactionOn('xrpl-testnet'), transactionOn('xrpl-testnet')],
    })
    const custody = fakeCustody({ transactions: { transactions }, ledgers: ledgers() })
    const server = createCustodyMcpServer(options(custody))

    await server.executeTool('listTransactions', {})
    await server.executeTool('listTransactions', {})

    expect(custody.ledgers.get).toHaveBeenCalledTimes(1)
  })

  it('links one transaction in full', async () => {
    const transaction = async () => transactionOn('xrpl-testnet')

    const output = await callTool(
      options(fakeCustody({ transactions: { transaction }, ledgers: ledgers() })),
      'getTransaction',
      {
        transactionId: 'transaction-1',
      },
    )

    expect(output).toMatchObject({ explorerUrl: `https://testnet.xrpl.org/transactions/${HASH}` })
  })

  it('links the addresses of an account', async () => {
    const addresses = async () => ({
      count: 1,
      items: [{ id: 'address-1', ledgerId: 'xrpl-devnet', address: ADDRESS, scope: 'Internal' }],
    })

    const output = await callTool(
      options(fakeCustody({ accounts: { addresses }, ledgers: ledgers() })),
      'listAccountAddresses',
      {
        accountId: 'account-1',
      },
    )

    expect(output).toMatchObject({ addresses: [{ explorerUrl: `https://devnet.xrpl.org/accounts/${ADDRESS}` }] })
  })

  it('links the address an account was found by', async () => {
    const findByAddress = async () => ({
      address: ADDRESS,
      ledgerId: 'xrpl-mainnet',
      domainId: 'domain-3',
      accountId: 'account-1',
    })

    const output = await callTool(
      options(fakeCustody({ accounts: { findByAddress }, ledgers: ledgers() })),
      'findAccountByAddress',
      {
        address: ADDRESS,
      },
    )

    expect(output).toMatchObject({ account: { explorerUrl: `https://livenet.xrpl.org/accounts/${ADDRESS}` } })
  })

  it('rejects a configured node that is not a WebSocket URL', async () => {
    const output = await explorerCallWithNode('https://repo-sandbox.ripplex.io:6006')

    expect(output).toMatchObject({ error: expect.stringContaining('xrplNodes') })
  })
})

const explorerCallWithNode = (node: string) =>
  callTool(options(fakeCustody({ ledgers: ledgers() }), { 'xrpl-sandbox': node }), 'listTransactions')
