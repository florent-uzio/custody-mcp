import { describe, expect, it, vi } from 'vitest'
import { callTool, devServerOptions, fakeCustody, recordMetadata, signed } from '../testing'

describe('read tools for transfers and transactions', () => {
  const transfer = {
    id: 'transfer-1',
    transactionId: 'transaction-1',
    tickerId: 'ticker-xrp',
    quarantined: false,
    quarantineStatus: 'Skipped',
    senders: [{ domainId: 'domain-1', accountId: 'account-1', type: 'Account' }],
    recipient: { address: 'rBOB', addressDetails: { address: 'rBOB' }, type: 'Address' },
    value: '10000000',
    kind: 'Transfer',
    registeredAt: '2026-01-01T00:02:00Z',
    metadata: { ledgerData: { type: 'XRPL' } },
  }

  describe('listTransfers', () => {
    it('lists the transfers of the Default domain, compactly, with the next cursor', async () => {
      const transfers = vi.fn(async () => ({ count: 1, nextStartingAfter: 'transfer-1', items: [transfer] }))

      const output = await callTool(devServerOptions(fakeCustody({ transactions: { transfers } })), 'listTransfers')

      expect(output).toEqual({
        environment: 'dev',
        domainId: 'domain-1',
        transfers: [
          {
            id: 'transfer-1',
            kind: 'Transfer',
            tickerId: 'ticker-xrp',
            value: '10000000',
            senders: [{ domainId: 'domain-1', accountId: 'account-1', type: 'Account' }],
            recipient: { address: 'rBOB', addressDetails: { address: 'rBOB' }, type: 'Address' },
            transactionId: 'transaction-1',
            quarantineStatus: 'Skipped',
            registeredAt: '2026-01-01T00:02:00Z',
          },
        ],
        nextCursor: 'transfer-1',
      })
      expect(transfers).toHaveBeenCalledWith({ domainId: 'domain-1' }, { limit: 20, startingAfter: undefined })
    })

    it('narrows the list to the transfers of one account in another domain', async () => {
      const transfers = vi.fn(async () => ({ count: 0, items: [] }))

      const output = await callTool(devServerOptions(fakeCustody({ transactions: { transfers } })), 'listTransfers', {
        domainId: 'domain-9',
        accountId: 'account-1',
      })

      expect(output).toEqual({ environment: 'dev', domainId: 'domain-9', transfers: [] })
      expect(transfers).toHaveBeenCalledWith(
        { domainId: 'domain-9' },
        { limit: 20, startingAfter: undefined, accountId: 'account-1' },
      )
    })
  })
  describe('getTransfer', () => {
    it('returns one transfer in full', async () => {
      const get = vi.fn(async () => transfer)

      const output = await callTool(devServerOptions(fakeCustody({ transactions: { transfer: get } })), 'getTransfer', {
        transferId: 'transfer-1',
      })

      expect(output).toEqual({ environment: 'dev', domainId: 'domain-1', transfer })
      expect(get).toHaveBeenCalledWith({ domainId: 'domain-1', transferId: 'transfer-1' })
    })
  })
  describe('listTransactionOrders', () => {
    const order = signed({
      id: 'order-1',
      domainId: 'domain-1',
      accountId: 'account-1',
      ledgerId: 'xrpl-testnet',
      parameters: { type: 'XRPL', operation: { type: 'Payment', amount: '10000000' } },
      metadata: recordMetadata,
    })

    it('lists the transaction orders an Intent produced, compactly, with the next cursor', async () => {
      const orders = vi.fn(async () => ({ count: 1, nextStartingAfter: 'order-1', items: [order] }))

      const output = await callTool(
        devServerOptions(fakeCustody({ transactions: { orders } })),
        'listTransactionOrders',
        {
          intentId: 'intent-1',
        },
      )

      expect(output).toEqual({
        environment: 'dev',
        domainId: 'domain-1',
        transactionOrders: [
          {
            id: 'order-1',
            accountId: 'account-1',
            ledgerId: 'xrpl-testnet',
            type: 'XRPL',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
        nextCursor: 'order-1',
      })
      expect(orders).toHaveBeenCalledWith(
        { domainId: 'domain-1' },
        { limit: 20, startingAfter: undefined, intentId: 'intent-1' },
      )
    })

    it('lists every transaction order of the domain when given no Intent', async () => {
      const orders = vi.fn(async () => ({ count: 0, items: [] }))

      await callTool(devServerOptions(fakeCustody({ transactions: { orders } })), 'listTransactionOrders', { limit: 3 })

      expect(orders).toHaveBeenCalledWith({ domainId: 'domain-1' }, { limit: 3, startingAfter: undefined })
    })
  })
  describe('listTransactions', () => {
    const transaction = {
      id: 'transaction-1',
      ledgerId: 'xrpl-testnet',
      orderReference: { id: 'order-1', domainId: 'domain-1' },
      relatedAccounts: [{ domainId: 'domain-1', accountId: 'account-1' }],
      processing: { status: 'Completed' },
      registeredAt: '2026-01-01T00:02:00Z',
      ledgerTransactionData: {
        ledgerStatus: 'Confirmed',
        ledgerTransactionId: 'ABC123',
        statusLastUpdatedAt: '2026-01-01T00:03:00Z',
      },
      relatedTransactions: [],
    }

    it('lists the transactions a transaction order produced, compactly, with the next cursor', async () => {
      const transactions = vi.fn(async () => ({ count: 1, nextStartingAfter: 'transaction-1', items: [transaction] }))

      const output = await callTool(
        devServerOptions(fakeCustody({ transactions: { transactions } })),
        'listTransactions',
        {
          transactionOrderId: 'order-1',
        },
      )

      expect(output).toEqual({
        environment: 'dev',
        domainId: 'domain-1',
        transactions: [
          {
            id: 'transaction-1',
            ledgerId: 'xrpl-testnet',
            transactionOrderId: 'order-1',
            processingStatus: 'Completed',
            ledgerStatus: 'Confirmed',
            ledgerTransactionId: 'ABC123',
            registeredAt: '2026-01-01T00:02:00Z',
          },
        ],
        nextCursor: 'transaction-1',
      })
      expect(transactions).toHaveBeenCalledWith(
        { domainId: 'domain-1' },
        { limit: 20, startingAfter: undefined, 'orderReference.Id': 'order-1' },
      )
    })

    it('omits the ledger fields of a transaction not yet sent to the ledger', async () => {
      const { ledgerTransactionData: _, ...preparing } = { ...transaction, processing: { status: 'Preparing' } }
      const transactions = vi.fn(async () => ({ count: 1, items: [preparing] }))

      const output = await callTool(
        devServerOptions(fakeCustody({ transactions: { transactions } })),
        'listTransactions',
      )

      expect(output).toEqual({
        environment: 'dev',
        domainId: 'domain-1',
        transactions: [
          {
            id: 'transaction-1',
            ledgerId: 'xrpl-testnet',
            transactionOrderId: 'order-1',
            processingStatus: 'Preparing',
            registeredAt: '2026-01-01T00:02:00Z',
          },
        ],
      })
    })

    it('narrows the list to the transactions of one account in another domain, one page after a cursor', async () => {
      const transactions = vi.fn(async () => ({ count: 0, items: [] }))

      const output = await callTool(
        devServerOptions(fakeCustody({ transactions: { transactions } })),
        'listTransactions',
        {
          domainId: 'domain-9',
          accountId: 'account-1',
          limit: 5,
          cursor: 'transaction-0',
        },
      )

      expect(output).toEqual({ environment: 'dev', domainId: 'domain-9', transactions: [] })
      expect(transactions).toHaveBeenCalledWith(
        { domainId: 'domain-9' },
        { limit: 5, startingAfter: 'transaction-0', accountId: 'account-1' },
      )
    })
  })
  describe('getTransaction', () => {
    it('returns one transaction in full, with its processing and ledger status', async () => {
      const transaction = {
        id: 'transaction-1',
        ledgerId: 'xrpl-testnet',
        orderReference: { id: 'order-1', domainId: 'domain-1' },
        relatedAccounts: [{ domainId: 'domain-1', accountId: 'account-1' }],
        processing: { status: 'Completed' },
        registeredAt: '2026-01-01T00:02:00Z',
        ledgerTransactionData: {
          ledgerStatus: 'Confirmed',
          ledgerTransactionId: 'ABC123',
          statusLastUpdatedAt: '2026-01-01T00:03:00Z',
        },
        relatedTransactions: [],
      }
      const get = vi.fn(async () => transaction)

      const output = await callTool(
        devServerOptions(fakeCustody({ transactions: { transaction: get } })),
        'getTransaction',
        {
          transactionId: 'transaction-1',
          domainId: 'domain-9',
        },
      )

      expect(output).toEqual({ environment: 'dev', domainId: 'domain-9', transaction })
      expect(get).toHaveBeenCalledWith({ domainId: 'domain-9', transactionId: 'transaction-1' })
    })
  })
})
